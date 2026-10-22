// TEST ONLY. A private borrow through the real screens (headless Chrome, the stand-in wallet
// of test/signer.ts): Private on in the Borrow dialog, a one-time key accepts through the
// relayer, the test wallet locks the ZEC, the dollars land as a private note in the vault,
// a little is added for the interest, and the loan is repaid from the private balance with a
// proof made in the page. On Robinhood Chain testnet (?chain=robinhood) by default.
//   node test/e2e-private.mjs
// Needs: e2e/stack.sh (NETWORK=test), both serve.ts and api.ts (Robinhood as the peer), and
// test/signer.ts started with HYPOTHEC_CHAIN=robinhood.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHAIN = process.env.CHAIN ?? 'robinhood'
const APP = 'http://127.0.0.1:7910'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'hypothec-e2e-private')
mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------- browser -- */

const port = 9400 + Math.floor(Math.random() * 500)
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=1440,1200',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, 'about:blank',
])
let target
for (let i = 0; i < 100 && !target; i++) {
  await sleep(200)
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page') } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let n = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id) }
const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false })
// The stand-in wallet, present before any page script runs.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const role = new URLSearchParams(location.search).get('wallet') || (location.pathname.includes('desk') ? 'lender' : 'borrower')
  window.ethereum = {
    isTestWallet: true,
    request: async ({ method, params }) => {
      const r = await fetch('http://127.0.0.1:7920/?as=' + role, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      const j = await r.json()
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e }
      return j.result
    },
    on() {}, removeListener() {},
  }
})()` })

// Waits for the page to be usable (its wallet button there and the first state painted):
// a fresh profile can take several seconds on the web fonts.
async function goto(page) {
  await send('Page.navigate', { url: `${APP}/${page}` })
  for (let i = 0; i < 80; i++) {
    await sleep(250)
    const ready = await evaluate(`document.readyState !== 'loading' && !!document.querySelector('[data-app="wallet"]')`).catch(() => false)
    if (ready) break
  }
  await sleep(2500)
}
async function click(selector) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
  if (!ok) throw new Error(`nothing to click at ${selector}`)
}
const setValue = (selector, v) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
const toastText = () => evaluate(`(() => { const t = document.querySelector('[data-app="toast"]'); return t && !t.hidden ? t.textContent : '' })()`)
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'))
  console.log(`   shot ${name}.png`)
}
async function connect() {
  await click('[data-app="wallet"]')
  await sleep(1500)
}

/* --------------------------------------------------------------- state -- */

const state = async () => (await fetch(`${APP}/x/${CHAIN}/api/state`)).json()
const seenErrors = new Set()
async function until(what, f, timeoutMs = 300_000) {
  const end = Date.now() + timeoutMs
  let lastToast = ''
  for (;;) {
    const s = await state()
    if (await f(s)) return s
    const t = await toastText().catch(() => '')
    if (t && t !== lastToast) console.log(`   page says: ${t}`)
    lastToast = t
    const failed = s.jobs.find((j) => j.error && !seenErrors.has(j.id))
    if (failed) {
      seenErrors.add(failed.id)
      throw new Error(`${failed.name} failed: ${failed.error}`)
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(3000)
  }
}
let step = 0
const say = (s) => console.log(`\n== ${++step}. ${s}`)
const loansOf = (s) => s.loans.filter((l) => l.basket === s.baskets[s.baskets.length - 1]?.id)
const idle = (s, name) => s.jobs.filter((j) => j.name === name).every((j) => j.done)

/* ---------------------------------------------------------------- flow -- */

const ZEC_BACK = process.env.ZEC_BACK ?? 'utest1yjp5pvfak0ay4zds4eka35ce8sk43lr8nhqsf69nxne79evplwv952ldv2fucwu83nns3x0rxdxvr3m33s0jh67gjrqqzalwvvrf893z'
const AMOUNT = process.env.AMOUNT ?? '1'
const latest = (s) => s.baskets[s.baskets.length - 1]
const mineLoans = (s) => s.loans.filter((l) => l.basket === latest(s)?.id)

try {
  say(`The borrower opens Markets on ${CHAIN}, turns Private on and asks ${AMOUNT}`)
  await goto(`markets.html?chain=${CHAIN}`)
  await connect()
  await until('the desks', async (s) => s.desks.length > 0)
  await click('.tr [data-open="borrow"]')
  await sleep(2500)
  await setValue('[data-input="amount"]', AMOUNT)
  await sleep(800)
  const priv = await evaluate(`(() => { const w = document.querySelector('[data-app="priv-wrap"]'); const c = document.querySelector('[data-input="private"]'); return { shown: !!w && !w.hidden, on: !!c && c.checked } })()`)
  console.log(`   private switch: ${JSON.stringify(priv)}`)
  if (!priv.shown || !priv.on) throw new Error('the Private switch is not on')
  await shot('p1-dialog')
  await click('[data-app="borrow-dialog"] [data-act="borrower/request"]')
  let s = await until('the private request', async (x) => latest(x)?.shielded === true, 60_000)
  const borrower = latest(s).borrower
  console.log(`   borrower on the loan chain: ${borrower} (a one-time key, not the wallet)`)

  say('The desks answer; the borrower accepts privately (the relayer submits)')
  await until('the offers', async (x) => mineLoans(x).length && mineLoans(x).every((l) => l.onchain.status === 'Offered'), 180_000)
  await goto('loan.html')
  await setValue('[data-input="zec-payout"]', ZEC_BACK)
  await shot('p2-accept')
  await click('[data-step="accept"]:not([hidden]) [data-act="borrower/accept"]')
  s = await until('the private acceptance on chain', async (x) => mineLoans(x).every((l) => l.accepted && l.onchain.status !== 'Offered'), 240_000)
  console.log(`   payout to: ${mineLoans(s).map((l) => l.onchain.payoutTo).join(', ')} (the vault)`)

  say('Vaults made, desks fund, the test wallet locks the ZEC (testnet: ~10 confirmations)')
  await until('the lock screen', async (x) => mineLoans(x).every((l) => l.onchain.status === 'Funded' && l.vault), 600_000)
  await goto('loan.html')
  await shot('p3-lock')
  await click('[data-act="borrower/lock"]')
  s = await until('the loan running (guardians confirmed, payout into the vault)', async (x) => mineLoans(x).every((l) => l.onchain.status === 'Active'), 45 * 60_000)
  console.log(`   shielded: ${mineLoans(s).map((l) => l.shielded).join(', ')}`)

  say('The private balance opens with a signature and shows the payout note')
  await goto('loan.html')
  await click('[data-act="private/open"]')
  await sleep(8000)
  const bal = await evaluate(`document.querySelector('[data-app="priv-balance"]')?.textContent`)
  console.log(`   private balance: ${bal}`)
  await shot('p4-private')

  say('A little is added from the wallet for the interest, then the loan is repaid privately')
  await setValue('[data-input="priv-add"]', '0.2')
  await click('[data-act="private/add"]')
  await sleep(20_000)
  console.log(`   private balance: ${await evaluate(`document.querySelector('[data-app="priv-balance"]')?.textContent`)}`)
  await click('[data-act="borrower/repay-all"]')
  s = await until('the loan repaid from the vault', async (x) => mineLoans(x).every((l) => ['Repaid'].includes(l.onchain.status) || l.loanbookStatus === 'Released'), 10 * 60_000)
  await shot('p5-repaid')
  console.log(`\nPRIVATE BORROW: OK  (borrower ${borrower}, ${mineLoans(s).length} loan${mineLoans(s).length === 1 ? '' : 's'})`)
} catch (e) {
  console.error(`\nFAILED: ${e.message}`)
  await shot('p-failed').catch(() => undefined)
  process.exitCode = 1
} finally {
  chrome.kill()
  ws.close()
}
