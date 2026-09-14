// Builds the browser half into the artifact dsh-client-modules serves.
//
// Run this from an ordinary terminal: `npm run build`.
//
// Under a sandbox that refuses piped child stdio (esbuild's service spawn fails
// with EPERM), use the equivalent two-step instead, which touches no pipes:
//
//   node_modules/@esbuild/win32-x64/esbuild.exe src/client/index.jsx \
//     --bundle --format=cjs --platform=browser --target=chrome110 \
//     --jsx=automatic --loader:.css=text \
//     --external:react --external:react/jsx-runtime --external:react-dom \
//     --external:react-dom/client --external:@deepseek-ai/cordis \
//     --external:@deepseek-ai/dsh-client-store \
//     --external:@deepseek-ai/dsh-client-ui-slots \
//     --external:@deepseek-ai/dsh-client-ui-primitives \
//     --external:@deepseek-ai/dsh-client-ui-dockkit \
//     --outfile=lib/client.body.js
//   node wrap.mjs
//
// Everything is bundled except the frozen baseline table the shell seeds, which
// must stay external so the plugin shares the page's single React and Cordis
// instances.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { wrapBundle } from './wrap.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** The seed table the shell freezes before any plugin runs. */
const BASELINE_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const result = await build({
  absWorkingDir: here,
  entryPoints: ['src/client/index.jsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome110'],
  jsx: 'automatic',
  external: BASELINE_MODULES,
  loader: { '.css': 'text' },
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
  write: false,
})

const wrapped = wrapBundle(result.outputFiles[0].text)

await mkdir(resolve(here, 'lib'), { recursive: true })
await writeFile(resolve(here, 'lib/client.js'), wrapped, 'utf8')

console.log(`built lib/client.js — ${wrapped.length} bytes`)
