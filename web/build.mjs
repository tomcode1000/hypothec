import { mkdir, writeFile, copyFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { FAVICON, OUT } from './chrome.mjs'
import { pages } from './pages.mjs'

/*
  Writes dist/: every page, the stylesheet, the script, the favicon, and the wallet
  module bundled with viem into one file (assets/wallet.js), so no page loads code from
  outside at runtime. `node build.mjs`
*/

await mkdir(join(OUT, 'assets'), { recursive: true })
for (const f of ['hypothec.css', 'app.js', 'og.png', 'icon-512.png', 'apple-touch-180.png']) await copyFile(join(import.meta.dirname, 'assets', f), join(OUT, 'assets', f))
// The hero and footer videos (no sound) and their still frames.
await mkdir(join(OUT, 'assets', 'media'), { recursive: true })
for (const f of await readdir(join(import.meta.dirname, 'assets', 'media'))) await copyFile(join(import.meta.dirname, 'assets', 'media', f), join(OUT, 'assets', 'media', f))
await writeFile(join(OUT, 'assets', 'favicon.svg'), FAVICON)
await build({
  entryPoints: [join(import.meta.dirname, 'wallet', 'wallet.mjs')],
  outfile: join(OUT, 'assets', 'wallet.js'),
  bundle: true,
  format: 'iife',
  globalName: 'HypothecWallet',
  minify: true,
  target: 'es2020',
  legalComments: 'eof',
  logLevel: 'warning',
})
const all = pages()
for (const [name, html] of Object.entries(all)) await writeFile(join(OUT, name), html)
console.log(`built ${Object.keys(all).length} pages and the wallet bundle into ${OUT}`)
