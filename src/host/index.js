// dsh-workbench host half.
//
// One job: own real PTY sessions for a human, and expose them over a
// WebSocket that is fenced by the harness's own browser trust boundary.
//
// Security posture, in order of importance:
//   1. The socket is authenticated with `ctx.connection.requestRejection`,
//      the same Host/Origin fence plus signed browser cookie that protects
//      `/api`. A request without a valid browser session is refused before
//      any session is created.
//   2. The check FAILS CLOSED. If the connection service is missing we refuse
//      the upgrade rather than degrading to an unauthenticated shell socket.
//   3. This plugin registers no model-facing tool. The DSH agent has no handle
//      to these sessions, so there is an explicit boundary before the model
//      could ever drive a human terminal.
//   4. We never return the process environment to the client and never log it.

import { createRequire } from 'node:module'

import { WorkbenchRegistry } from './session.js'

const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws')

/** Cordis plugin name; must match the row id in cordis.patch.yml. */
export const name = 'workbench'

/** Hard dependency: without the web server there is nothing to serve on. */
export const inject = ['webServer']

/** Upgrade path. Deliberately outside `/api`, which the connection row owns. */
export const WS_PATH = '/x/workbench/ws'

/** Largest inbound client message we accept (input bursts, not uploads). */
const MAX_PAYLOAD_BYTES = 1024 * 1024

/**
 * Apply the harness browser trust fence to an upgrade request.
 * @returns 0 when the request may proceed, otherwise the HTTP status to send.
 */
function authorizeUpgrade(ctx, request) {
  const connection = ctx.get('connection')

  if (connection === undefined || typeof connection.requestRejection !== 'function') {
    // Fail closed: an unauthenticated remote shell is never an acceptable
    // fallback, so refuse instead of guessing at a weaker policy.
    return 403
  }

  try {
    const rejection = connection.requestRejection({ headers: request.headers })
    return rejection === undefined ? 0 : rejection
  } catch {
    return 403
  }
}

function refuse(socket, status) {
  const reason = status === 401 ? 'Unauthorized' : 'Forbidden'
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    )
  } catch {
    // The peer may already be gone.
  }
  socket.destroy()
}

/** Send one JSON event if the socket is still open. */
function send(socket, event) {
  if (socket.readyState !== 1) return
  try {
    socket.send(JSON.stringify(event))
  } catch {
    // A closed socket is not an error worth propagating.
  }
}

function sendFailure(socket, message, error) {
  send(socket, {
    t: 'error',
    id: typeof message.id === 'string' ? message.id : null,
    requestId: message.requestId ?? null,
    code: typeof error?.code === 'string' ? error.code : 'WORKBENCH_ERROR',
    message: String(error?.message ?? error),
  })
}

/**
 * Host plugin entry point.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  const registry = new WorkbenchRegistry({
    defaultCwd: process.cwd(),
    onEvent: (event) => broadcast(event),
  })

  const sockets = new Set()
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_PAYLOAD_BYTES,
  })

  function broadcast(event) {
    const payload = JSON.stringify(event)
    for (const socket of sockets) {
      if (socket.readyState !== 1) continue
      try {
        socket.send(payload)
      } catch {
        // Ignore and let the close handler clean up.
      }
    }
  }

  function handleMessage(socket, raw) {
    let message
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
    } catch {
      return
    }
    if (message === null || typeof message !== 'object') return

    const id = typeof message.id === 'string' ? message.id : null

    try {
      switch (message.t) {
        case 'hello':
          send(socket, registry.bootstrap())
          return

        case 'spawn': {
          const session = registry.spawn({
            presetId: message.presetId,
            projectId: message.projectId,
            cwd: message.cwd,
            customCommand: message.customCommand,
            cols: message.cols,
            rows: message.rows,
          })
          send(socket, { t: 'spawned', session, requestId: message.requestId ?? null })
          return
        }

        case 'attach': {
          if (id === null) return
          const data = registry.read(id)
          if (data === null) {
            send(socket, { t: 'error', id, message: 'no such session' })
            return
          }
          send(socket, { t: 'attached', id, data })
          return
        }

        case 'input':
          if (id !== null) registry.write(id, String(message.data ?? ''))
          return

        case 'resize':
          if (id !== null) registry.resize(id, message.cols, message.rows)
          return

        case 'kill':
          if (id !== null) registry.kill(id)
          return

        case 'remove':
          if (id !== null) registry.remove(id)
          return

        case 'restart': {
          if (id === null) return
          const session = registry.restart(id, message)
          send(socket, { t: 'spawned', session, requestId: message.requestId ?? null })
          return
        }

        case 'addProject': {
          const project = registry.addProject(message.path, message.name)
          send(socket, { t: 'project', project })
          return
        }

        case 'removeProject':
          if (id !== null) registry.removeProject(id)
          return

        case 'projectInfo': {
          if (id === null) return
          const requestId = message.requestId ?? null
          Promise.resolve(registry.projectInfo(id)).then(
            (info) => { send(socket, { t: 'projectInfo', id, info, requestId }) },
            () => { send(socket, { t: 'projectInfo', id, info: null, requestId }) },
          )
          return
        }

        case 'fileList': {
          const requestId = message.requestId ?? null
          Promise.resolve(registry.listProjectFiles(message.projectId, message.path)).then(
            (result) => { send(socket, { t: 'fileList', result, requestId }) },
            (error) => { sendFailure(socket, message, error) },
          )
          return
        }

        case 'fileRead': {
          const requestId = message.requestId ?? null
          Promise.resolve(registry.readProjectFile(message.projectId, message.path)).then(
            (result) => { send(socket, { t: 'fileRead', result, requestId }) },
            (error) => { sendFailure(socket, message, error) },
          )
          return
        }

        case 'fileWrite': {
          const requestId = message.requestId ?? null
          Promise.resolve(registry.writeProjectFile(
            message.projectId,
            message.path,
            message.content,
            message.expectedVersion,
          )).then(
            (result) => { send(socket, { t: 'fileWrite', result, requestId }) },
            (error) => { sendFailure(socket, message, error) },
          )
          return
        }

        default:
          return
      }
    } catch (error) {
      sendFailure(socket, message, error)
    }
  }

  wss.on('connection', (socket) => {
    sockets.add(socket)
    send(socket, registry.bootstrap())

    socket.on('message', (raw) => handleMessage(socket, raw))
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => sockets.delete(socket))
  })

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.registerUpgrade({
      path: WS_PATH,
      handler: (request, socket, head) => {
        const status = authorizeUpgrade(ctx, request)
        if (status !== 0) {
          refuse(socket, status)
          return
        }
        wss.handleUpgrade(request, socket, head, (upgraded) => {
          wss.emit('connection', upgraded, request)
        })
      },
    })

    return () => {
      disposeRoute()
      for (const socket of sockets) {
        try {
          socket.close()
        } catch {
          // Already closed.
        }
      }
      sockets.clear()
      try {
        wss.close()
      } catch {
        // Already closed.
      }
      registry.dispose()
    }
  })
}
