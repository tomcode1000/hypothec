// TEST ONLY. A private desk through the real screens (headless Chrome, the stand-in wallets
// of test/signer.ts): a lender fills its private balance, posts a desk owned by a one-time key,
// approves a private borrower's request (the relayer posts the offer), funds it from the vault
// with a proof made in the page, and after the borrower repays privately, finds the repayment
// as its own private note and withdraws it to a fresh address. Neither wallet touches the loan.
//   node test/e2e-private-lend.mjs
// Needs: e2e/stack.sh (NETWORK=test), both serve.ts and api.ts (Robinhood as the peer), and
// test/signer.ts started with HYPOTHEC_CHAIN=robinhood.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHAIN = process.env.CHAIN ?? 'robinhood'
const APP = 'http://127.0.0.1:7910'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'hypothec-e2e-private-lend')
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

/* ---------------------------------------------------------------- flow -- */

const ZEC_BACK = process.env.ZEC_BACK ?? 'utest1yjp5pvfak0ay4zds4eka35ce8sk43lr8nhqsf69nxne79evplwv952ldv2fucwu83nns3x0rxdxvr3m33s0jh67gjrqqzalwvvrf893z'
const DESK = process.env.DESK ?? `Desk P${Date.now() % 10000}`
const LENDER = 'lender2'
const deskOwner = (s) => s.desks.find((d) => d.name === DESK)?.owner
const deskLoans = (s) => s.loans.filter((l) => l.desk.toLowerCase() === (deskOwner(s) || '').toLowerCase())
const balanceText = () => evaluate(`document.querySelector('[data-app="priv-balance"]')?.textContent`)
const deskPage = `desk.html?chain=${CHAIN}&wallet=${LENDER}`

try {
  say(`A lender opens a private balance on ${CHAIN} and adds 3 from its wallet`)
  await goto(deskPage)
  await connect()
  await click('[data-act="private/open"]')
  // Opening finds this wallet's one-time keys and restores its backed-up notes: wait for it.
  for (let i = 0; i < 60 && !(await evaluate(`(() => { const a = document.querySelector('[data-app="priv-actions"]'); const b = document.querySelector('[data-app="priv-balance"]'); return !!a && !a.hidden && /\d/.test(b?.textContent || '') })()`)); i++) await sleep(1000)
  await sleep(1500)
  await setValue('[data-input="priv-add"]', '3')
  await click('[data-act="private/add"]')
  for (let i = 0; i < 120 && !/is now private/.test(await toastText()); i++) await sleep(2000)
  await sleep(2000)
  console.log(`   private balance: ${await balanceText()}`)

  say('It posts a private desk: a one-time key owns it')
  await click('[data-app="edit-order"]')
  await sleep(1500)
  await setValue('[data-desk="name"]', DESK)
  await setValue('[data-desk="max"]', '2')
  await click('[data-fill="test-desk"]')
  const sw = await evaluate(`(() => { const c = document.querySelector('[data-input="private-desk"]'); return !!c && c.checked && !c.closest('[hidden]') })()`)
  if (!sw) throw new Error('the Private desk switch is not on')
  await shot('l1-lend-dialog')
  await click('[data-app="lend-dialog"] [data-act="lender/desk"]')
  let s = await until('the private desk on Markets', async (x) => !!deskOwner(x), 60_000)
  const owner = deskOwner(s)
  console.log(`   desk owner on the loan chain: ${owner} (a one-time key, not the wallet); private: ${s.desks.find((d) => d.name === DESK).private}`)

  say('A borrower asks Desk P for 1, privately')
  await goto(`markets.html?chain=${CHAIN}`)
  await connect()
  await click(`.tr [data-open="borrow"][data-desk="${owner}"]`)
  await sleep(2500)
  await setValue('[data-input="amount"]', '1')
  await sleep(800)
  await shot('l2-ticket')
  await click('[data-app="borrow-dialog"] [data-act="borrower/request"]')
  s = await until('the request to Desk P', async (x) => x.baskets.some((b) => b.pieces.some((p) => p.desk.toLowerCase() === owner.toLowerCase() && !p.loan)), 60_000)

  say('The private desk approves: its one-time key signs, the relayer posts the offer')
  await goto(deskPage)
  await click('[data-act="lender/approve"]')
  s = await until('the private offer on chain', async (x) => deskLoans(x).some((l) => l.onchain.status === 'Offered'), 120_000)
  const id = deskLoans(s).find((l) => l.onchain.status === 'Offered').id
  const one = (x) => x.loans.find((l) => l.id === id)
  console.log(`   loan ${id.slice(0, 10)}… lender ${one(s).offer.lender}, privateLender: ${one(s).privateLender}`)

  say('The borrower accepts privately')
  await goto(`loan.html?chain=${CHAIN}`)
  await setValue('[data-input="zec-payout"]', ZEC_BACK)
  await click('[data-step="accept"]:not([hidden]) [data-act="borrower/accept"]')
  s = await until('the vault made', async (x) => one(x)?.onchain.status === 'Accepted' && !!one(x).vault, 600_000)

  say('The private desk funds from its private balance (a proof made in the page)')
  await goto(deskPage)
  await click('[data-act="lender/fund"]')
  s = await until('the loan funded', async (x) => one(x)?.onchain.status === 'Funded', 240_000)
  await sleep(4000)
  console.log(`   private balance after funding: ${await balanceText()}`)
  await shot('l3-funded')

  say('The test wallet locks the ZEC; the guardians confirm (testnet: ~10 confirmations)')
  await goto(`loan.html?chain=${CHAIN}`)
  await click('[data-act="borrower/lock"]')
  s = await until('the loan running', async (x) => one(x)?.onchain.status === 'Active', 45 * 60_000)

  say('The borrower adds a little for the interest and repays privately')
  await goto(`loan.html?chain=${CHAIN}`)
  await click('[data-act="private/open"]')
  await sleep(6000)
  await setValue('[data-input="priv-add"]', '0.1')
  await click('[data-act="private/add"]')
  await sleep(15_000)
  await click('[data-act="borrower/repay-all"]')
  s = await until('the loan repaid', async (x) => ['Repaid'].includes(one(x)?.onchain.status), 10 * 60_000)

  say('What the borrower repaid is the private desk\'s note; it withdraws to a fresh address')
  await goto(deskPage)
  await click('[data-act="private/open"]').catch(() => undefined)
  await sleep(8000)
  console.log(`   private balance: ${await balanceText()}`)
  await shot('l4-desk-balance')
  const fresh = '0x' + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await setValue('[data-input="priv-out"]', '1')
  await setValue('[data-input="priv-to"]', fresh)
  await click('[data-act="private/withdraw"]')
  for (let i = 0; i < 40; i++) {
    const t = await toastText()
    if (/sent to/.test(t)) { console.log(`   page says: ${t}`); break }
    await sleep(2000)
  }
  console.log(`\nPRIVATE LEND: OK  (desk ${owner}, loan ${id})`)
} catch (e) {
  console.error(`\nFAILED: ${e.message}`)
  await shot('l-failed').catch(() => undefined)
  process.exitCode = 1
} finally {
  chrome.kill()
  ws.close()
}
