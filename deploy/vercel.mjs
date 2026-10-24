// Publishes the website (web/dist) to Vercel, with the API forwarded to the hosted system.
//
// Vercel serves the pages, scripts, media and the prover files; every call to /api/... and
// /x/<chain>/api/... is forwarded to the container that runs the loanbooks, guardians and
// relayer (Render, deploy/Dockerfile). The share image links (__SITE__) point at the Vercel
// address.
//
//   API_ORIGIN=https://hypothec.onrender.com SITE_URL=https://hypothec-five.vercel.app node deploy/vercel.mjs
//
// Needs `vercel` signed in (npx vercel login) and web/dist built (node web/build.mjs).
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const API = (process.env.API_ORIGIN || '').replace(/\/$/, '')
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '')
if (!/^https:\/\//.test(API) || !/^https:\/\//.test(SITE)) {
  console.error('set API_ORIGIN and SITE_URL (https://…)')
  process.exit(1)
}

const DIST = join(import.meta.dirname, '..', 'web', 'dist')
// A folder named "hypothec": Vercel names the project after it.
const out = join(tmpdir(), 'hypothec')
rmSync(out, { recursive: true, force: true })
cpSync(DIST, out, { recursive: true })

for (const f of readdirSync(out).filter((f) => f.endsWith('.html'))) {
  const p = join(out, f)
  writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__SITE__', SITE))
}

writeFileSync(join(out, 'vercel.json'), JSON.stringify({
  cleanUrls: false,
  rewrites: [
    { source: '/api/:path*', destination: `${API}/api/:path*` },
    { source: '/x/:path*', destination: `${API}/x/:path*` },
  ],
  headers: [
    { source: '/assets/zk/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
    { source: '/assets/media/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
  ],
}, null, 2))

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const args = ['--yes', 'vercel', 'deploy', out, '--prod', '--yes']
console.log(`deploying ${out} -> Vercel (API ${API})`)
execFileSync(npx, args, { stdio: 'inherit', shell: process.platform === 'win32' })
rmSync(out, { recursive: true, force: true })
