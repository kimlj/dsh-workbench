// Wraps a bundled CJS body in the module-loader registration the shell expects.
//
// Kept separate from build.mjs so the wrap step is pure filesystem work: it
// never spawns a process, so it runs even under a sandbox that refuses piped
// child stdio.
//
// Direct run:
//   node wrap.mjs            reads lib/client.body.js, writes lib/client.js

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Must equal the package name: the loader keys the browser module by it. */
export const MODULE_ID = 'dsh-workbench'

/**
 * Wrap one bundled CJS body as a lazy module-loader factory.
 * @param body - esbuild CJS output text.
 */
export function wrapBundle(body) {
  return `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(MODULE_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body}
\t\treturn module.exports;
\t}
});
`
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const body = await readFile(resolve(here, 'lib/client.body.js'), 'utf8')
  const wrapped = wrapBundle(body)
  await writeFile(resolve(here, 'lib/client.js'), wrapped, 'utf8')
  console.log(`wrapped lib/client.js — ${wrapped.length} bytes`)
}
