// TEST ONLY. Drives the real screens in headless Chrome through a whole borrow, with the
// stand-in wallet (test/signer.ts) injected as window.ethereum: borrower pages get the
// test borrower's wallet, desk pages the test lender's (or the second test lender's, with
// ?wallet=lender2 in the page address, read only by this stand-in). Every click is a real
// click on the page; the wallet prompts are answered by the signer. Screenshots go to SHOTS.
//   node test/e2e-web.mjs repay|liquidate|topup|deadline|basket
//   basket: two desks' orders fill one borrow (D16); both pieces locked together, then
//   repaid and released one by one.
// Needs: e2e/stack.sh (fresh), serve.ts all --fresh, test/signer.ts, and api.ts started with
// HYPOTHEC_DESK_AGENTS=0 (this test clicks through every desk step itself).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PATH = process.argv[2] ?? 'repay'
const APP = 'http://127.0.0.1:7910'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'hypothec-e2e-web')
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

const state = async () => (await fetch(`${APP}/api/state`)).json()
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

// The desks this run opens: [page wallet, name, rate %, order USDC, term].
const DESKS = PATH === 'basket'
  ? [['lender', 'Desk A', '9', '3'], ['lender2', 'Desk B', '12', '5']]
  : [['lender', 'Desk A', '12', '10', PATH === 'deadline' ? ['10', '60'] : null]]
const AMOUNT = process.env.AMOUNT ?? (PATH === 'basket' ? '5' : '4')

try {
  for (const [wallet, name, apr, max, term] of DESKS) {
    say(`A lender connects a wallet on Markets and posts an order: ${name}, ${apr}% APR, up to ${max} USDC${term ? ', 10 minutes' : ''}`)
    await goto(`markets.html?wallet=${wallet}`)
    await connect()
    await click('[data-open="lend"]')
    await sleep(800)
    await setValue('[data-desk="name"]', name)
    await click('[data-fill="test-desk"]')
    await setValue('[data-desk="apr"]', apr)
    await setValue('[data-desk="max"]', max)
    if (term) {
      await setValue('[data-desk="term"]', term[0])
      await setValue('[data-desk="term-unit"]', term[1])
    }
    await shot(`w0-open-${wallet}`)
    await click('[data-act="lender/desk"]')
    await until(`${name} to be listed`, async (s) => s.desks.some((d) => d.name === name))
  }

  say(`Borrower connects a wallet on Markets, clicks Borrow on the cheapest desk and asks for ${AMOUNT} USDC; the other orders cover the rest`)
  await goto('markets.html')
  await connect()
  await shot('w1-markets')
  await click('[data-open="borrow"]')
  await sleep(800)
  await setValue('[data-input="amount"]', AMOUNT)
  await sleep(800)
  console.log(`   ${await evaluate(`document.querySelector('[data-app="fill-note"]').textContent`)} · rate ${await evaluate(`document.querySelector('[data-app="q-apr"]').textContent`)}`)
  await shot('w1-borrow-dialog')
  await click('[data-act="borrower/request"]')
  const asked = await until('the request', async (s) => s.baskets.length > 0)
  const pieces = asked.baskets[asked.baskets.length - 1].pieces

  for (const [wallet, name] of DESKS) {
    if (!pieces.some((p) => p.deskName === name)) continue
    say(`${name} approves its piece on Lend: posts its terms on Base, signs them`)
    await goto(`desk.html?wallet=${wallet}`)
    await connect()
    await shot(`w2-request-${wallet}`)
    await click('[data-act="lender/approve"]')
    await until(`${name}'s offer`, async (s) => loansOf(s).some((l) => l.deskName === name))
  }

  say(`Borrower accepts ${pieces.length > 1 ? 'both offers with one click' : 'the offer'}, signs a fresh ZEC payout address; the vaults are made`)
  await goto('loan.html')
  await connect()
  await click('[data-fill="test-zec"]')
  await shot('w3-accept')
  await click('[data-act="borrower/accept"]')
  // The page accepts each loan on Base, waits for it to be mined, then signs and posts:
  // leaving before the API has every acceptance would cut that off.
  await until('every acceptance to reach the API', async (s) => loansOf(s).length === pieces.length && loansOf(s).every((l) => l.accepted))
  await goto('loan.html')
  await shot('w3b-making')
  await until('the vaults', async (s) => loansOf(s).every((l) => l.vault) && idle(s, 'keys'), 600_000)

  for (const [wallet, name] of DESKS) {
    if (!pieces.some((p) => p.deskName === name)) continue
    say(`${name} funds its own loan contract`)
    await goto(`desk.html?wallet=${wallet}`)
    await connect()
    await click('[data-act="lender/fund"]')
    await until(`${name}'s loan Funded on Base`, async (s) => loansOf(s).find((l) => l.deskName === name)?.onchain.status === 'Funded')
  }

  say('Borrower locks the ZEC for every vault at once (test wallet on this chain)')
  await goto('loan.html')
  await sleep(1500)
  await shot('w4-lock')
  await click('[data-act="borrower/lock"]')
  const active = await until('the guardians to confirm and the contracts to pay', async (s) => loansOf(s).every((l) => l.onchain.status === 'Active'), 600_000)
  for (const l of loansOf(active)) console.log(`   ${l.deskName}: LTV ${l.risk?.ltvBps / 100}%`)
  await goto('loan.html')
  await shot('w5-active')
  await goto('log.html')
  await shot('g1-guardians-lock')

  if (PATH === 'topup') {
    const dip = Math.round((Number((await state()).price.microUsd) / 1e6) * 0.72)
    say(`The desk sets the demo price to $${dip}: margin call, no liquidation`)
    await goto('desk.html')
    await setValue('[data-input="override"]', String(dip))
    await click('[data-act="lender/price"]')
    const called = await until('the margin call', async (s) => loansOf(s).every((l) => l.risk && l.risk.ltvBps >= l.offer.marginLtvBps && !l.risk.liquidationRule))
    const l = loansOf(called)[0]
    console.log(`   LTV ${l.risk.ltvBps / 100}%; suggested top-up ${Number(l.risk.topUpZat) / 1e8} ZEC`)
    say('Borrower adds the suggested ZEC (test wallet on this chain)')
    await goto('loan.html')
    await shot('w6-margin-call')
    await click('[data-act="borrower/topup"]')
    const topped = await until('the top-up', async (s) => loansOf(s)[0].events.some((e) => e.kind === 'top-up') && idle(s, 'topup'), 400_000)
    console.log(`   vault ${Number(loansOf(topped)[0].vaultZat) / 1e8} ZEC; LTV ${loansOf(topped)[0].risk.ltvBps / 100}%`)
    await goto('desk.html')
    await click('[data-act="lender/price-live"]')
    await goto('loan.html')
    await shot('w7-topped-up')
  }

  if (PATH === 'deadline' || PATH === 'liquidate') {
    if (PATH === 'deadline') {
      say('Borrower does not repay; the due date passes; Liquidate unlocks on the deadline rule')
      await until('the loan to be overdue', async (s) => loansOf(s)[0].overdue && !!loansOf(s)[0].risk?.liquidationRule, 900_000)
      await goto('desk.html')
    } else {
      const crash = Math.round((Number((await state()).price.microUsd) / 1e6) * 0.6)
      say(`The desk sets the demo price to $${crash}; Liquidate unlocks; the guardians decide`)
      await goto('desk.html')
      await setValue('[data-input="override"]', String(crash))
      await click('[data-act="lender/price"]')
      await until('the liquidation rule', async (s) => !!loansOf(s)[0].risk?.liquidationRule)
      await goto('desk.html')
    }
    await shot('w6-liquidatable')
    await click('[data-act="lender/liquidate"]')
    await until('Liquidated on Base', async (s) => loansOf(s)[0].onchain.status === 'Liquidated', 400_000)
    await click('[data-act="lender/price-live"]').catch(() => undefined)
    await goto('loan.html')
    await shot('w7-liquidated')
  } else {
    say(pieces.length > 1 ? 'Borrower repays every loan at once: one permit signature, one transaction' : 'Borrower repays: one permit signature, one transaction')
    await goto('loan.html')
    await click(pieces.length > 1 ? '[data-act="borrower/repay-all"]' : '[data-act="borrower/repay"]')
    await until('Repaid on Base', async (s) => loansOf(s).every((l) => l.onchain.status === 'Repaid'), 400_000)
    say('The ZEC comes back without another click: the guardians check and sign each release')
    await goto('loan.html')
    await shot('w6-repaid')
    await until('the releases', async (s) => loansOf(s).every((l) => l.loanbookStatus === 'Released'), 600_000)
    await goto('loan.html')
    await shot('w7-closed')
  }
  await goto('log.html')
  await shot('g2-guardians-end')
  const s = await state()
  console.log(`\nWEB ${PATH.toUpperCase()}: OK  (${loansOf(s).length} loan${loansOf(s).length === 1 ? '' : 's'}, ${loansOf(s).reduce((a, l) => a + l.events.filter((e) => e.sig).length, 0)} signed log entries)`)
} catch (e) {
  console.error(`\nFAILED: ${e.message}`)
  console.error(`page says: ${await toastText().catch(() => '')}`)
  await shot('failure').catch(() => undefined)
  process.exitCode = 1
} finally {
  ws.close()
  chrome.kill()
}
