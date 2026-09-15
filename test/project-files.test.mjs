import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ProjectFileError, ProjectFileService } from '../src/host/project-files.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-files-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'TODO.md'), '# Todo\n')
  await writeFile(join(root, 'src', 'index.js'), 'export const value = 1\n')
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'node_modules', 'hidden.js'), 'hidden\n')
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return { root, service: new ProjectFileService(id => id === 'project' ? root : null) }
}

test('lists directories lazily and omits dependency metadata trees', async (t) => {
  const { service } = await fixture(t)
  const listing = await service.list('project', '')
  assert.deepEqual(listing.entries, [
    { name: 'src', path: 'src', dir: true },
    { name: 'TODO.md', path: 'TODO.md', dir: false },
  ])
  assert.deepEqual((await service.list('project', 'src')).entries, [
    { name: 'index.js', path: 'src/index.js', dir: false },
  ])
})

test('reads, version-checks, and saves UTF-8 text', async (t) => {
  const { service } = await fixture(t)
  const opened = await service.read('project', 'TODO.md')
  assert.equal(opened.content, '# Todo\n')
  const saved = await service.write('project', 'TODO.md', '# Done\n', opened.version)
  assert.notEqual(saved.version, opened.version)
  assert.equal((await service.read('project', 'TODO.md')).content, '# Done\n')
})

test('refuses an overwrite after an external modification', async (t) => {
  const { root, service } = await fixture(t)
  const opened = await service.read('project', 'TODO.md')
  await writeFile(join(root, 'TODO.md'), '# Changed elsewhere\n')
  await assert.rejects(
    service.write('project', 'TODO.md', '# Workbench edit\n', opened.version),
    error => error instanceof ProjectFileError && error.code === 'EXTERNAL_MODIFICATION',
  )
})

test('rejects traversal, absolute paths, and unknown projects', async (t) => {
  const { root, service } = await fixture(t)
  const outside = join(root, '..', 'outside.txt')
  await writeFile(outside, 'outside')
  t.after(async () => { await rm(outside, { force: true }) })
  await assert.rejects(
    service.read('project', '../outside.txt'),
    error => error instanceof ProjectFileError && error.code === 'OUTSIDE_ROOT',
  )
  await assert.rejects(
    service.read('project', outside),
    error => error instanceof ProjectFileError && error.code === 'OUTSIDE_ROOT',
  )
  await assert.rejects(
    service.list('missing', ''),
    error => error instanceof ProjectFileError && error.code === 'UNKNOWN_PROJECT',
  )
})

test('rejects non-UTF-8 file content', async (t) => {
  const { root, service } = await fixture(t)
  await writeFile(join(root, 'binary.dat'), Buffer.from([0xff, 0xfe, 0xfd]))
  await assert.rejects(
    service.read('project', 'binary.dat'),
    error => error instanceof ProjectFileError && error.code === 'BINARY_FILE',
  )
})
