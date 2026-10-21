import { MARK, appPage, page } from './chrome.mjs'
import { borrowDialog, borrowerSide, btn, card, cardHead, deskSide, guardian, heading, health, info, lendDialog, line, loanPick, making, markets, pill, portfolioTabs, quest, stage, vaultArt } from './shell.mjs'

/**
 * The pages, organised as Quorum's are: each app screen carries only the work done on
 * it, and everything that explains the product lives in Docs.
 *
 *   index.html     the landing surface: what Hypothec is, in brief; no app rail
 *   markets.html   the order book; Borrow and Lend on each desk's row, each in a dialog
 *   loan.html      Portfolio, Borrowing: the borrower's loans, step by step
 *   desk.html      Portfolio, Lending: requests to answer, the desk's loans, its order
 *   log.html       Guardians: what they check now, the operators, the signed log
 *   docs.html      Docs: how it works, who sees what, controls, limits, testnet
 *
 * Anyone can post an order (D14); a borrow can be filled from several orders (D16), each
 * piece its own loan in its own vault.
 */

/* --------------------------------------------------------------- landing -- */

const header = `<header class="site-head"><div class="shell site-head-in">
  <a class="brand" href="index.html"><span class="mark">${MARK}</span><span>Hypothec</span></a>
  <nav class="site-links" aria-label="Primary"><a href="markets.html">Markets</a><a href="loan.html">Portfolio</a><a href="log.html">Guardians</a><a href="docs.html">Docs</a></nav>
  <div class="site-end"><div class="chainsw" data-app="chain-switch" role="group" aria-label="Loan chain" hidden></div><button class="theme-dot" type="button" data-theme-toggle aria-label="Switch between light and dark"></button>${btn('Read the docs', { href: 'docs.html', tone: 'ghost' })}${btn('Open the app', { href: 'markets.html' })}</div>
</div></header>`

/* The loan's structure, as a term sheet would state it. No figure here: each desk
   publishes its own levels and rate, and the app shows them live. */
const STRUCTURE = [
  ['Collateral', 'ZEC, held in a shielded Zcash vault'],
  ['Loan', '<span data-sym>USDC</span> on <span data-net>Base</span>, paid out by the loan contract'],
  ['Custody', 'One threshold key per loan; any 3 of its 4 holders can sign'],
  ['Key holders', 'Borrower, lending desk, two independent guardians'],
  ['Liquidation', "Only past the desk's published LTV; any surplus returns in the same transaction"],
]

/* The landing page's three lines: what a borrower, a lender and a guardian each do. */
const TRIO = [
  ['01', 'Borrow', 'Pick a desk\u2019s order, or several. Your ZEC goes into a shielded vault per loan, and the <span data-sym>USDC</span> is paid on <span data-net>Base</span>.'],
  ['02', 'Lend', 'Post an order with your rate, term and LTV levels. Your desk holds one key of each loan\u2019s vault.'],
  ['03', 'Guardians', 'Two independent operators sign only what the published rules allow, and log every decision.'],
]

const STEPS = [
  ['Request', 'The borrower picks an amount from the desks’ orders. One borrow can be filled from several desks; each piece is its own loan.'],
  ['Vault', 'Borrower, desk and both guardians make one shielded vault per loan. Each holds a share; the whole key never exists.'],
  ['Lock', 'The borrower pays every vault in one shielded transaction. When both guardians see it confirmed, the contract pays the <span data-sym>USDC</span>.'],
  ['Repay', 'The borrower repays through the contract, at any time before the due date.'],
  ['Release', 'The contract records repayment and both guardians sign the ZEC back to the borrower.'],
]

const CONTROLS = [
  ['No single party can move the collateral', 'Every spend needs three of four keys. The desk with one guardian cannot; both guardians alone cannot.'],
  ['Liquidation follows published rules only', 'Guardians sign only past the LTV in the signed offer, or after the due date, and only if the desk takes no more than it is owed.'],
  ['Surplus returns in the same transaction', 'A liquidation pays the desk and the borrower in one transaction. A guardian refuses any spend that does not.'],
  ['Every decision is signed and logged', 'Each guardian signs what it approved or refused, and why, with the price and the rule it applied.'],
]

const SEES = [
  ['Borrower', 'Everything about its own loans', '—'],
  ['Lending desk', 'The collateral in its own loan’s vault, through the viewing key; where the <span data-sym>USDC</span> is paid; the ZEC address the vault returns to', 'The borrower’s Zcash wallet, its balance or history, or the borrower’s loans with other desks'],
  ['Guardians', 'What the desk sees, and the signed terms they enforce', 'The borrower’s Zcash wallet'],
  ['Zcash, publicly', 'Shielded transactions', 'Owner, amount, or that a loan exists'],
  ['<span data-net>Base</span>, publicly', 'Each loan contract: <span data-sym>USDC</span> amount, payout address, status', 'Any Zcash detail; the contract stores none'],
]

const DISCLOSURES = [
  ['Test build', 'Runs on Zcash testnet (or a local test chain) and <span data-net-full>Base Sepolia</span>, with test coins only. The testnet build uses pre-release Zcash libraries for NU7.'],
  ['Guardians', 'Both guardians in this build are run by the Hypothec team. In production they are independent operators from a published list, approved by each borrower.'],
  ['Audit', 'Not audited. The threshold-signing library underneath is pre-release software.'],
  ['Availability', 'Release and liquidation need both guardians online. If one is unavailable, the borrower, the desk and the other guardian can close the loan together.'],
  ['Price', 'Each guardian reads the price off-chain on its own: the one-hour average of at least three of five exchanges. Without three, nothing that needs a price is signed.'],
  ['Desks', 'Each desk lends its own money and does its own customer checks. There is no shared pool: pooling lenders would need a custodian for the lender’s key share.'],
]

/* The four keys of every vault, and what any three of them can do together. The order of
   the seats is fixed (borrower, desk, guardian A, guardian B), so each row reads as a pattern. */
const SEATS = [
  ['You', 'The borrower', 'Your ZEC, your share of the key'],
  ['Desk', 'The lending desk', 'Lends the dollars, holds one share'],
  ['G·A', 'Guardian A', 'Rules software at one operator'],
  ['G·B', 'Guardian B', 'Rules software at another'],
]
const MOVES = [
  [[1, 0, 1, 1], 'Your ZEC back', 'Only after the contract says repaid, and only to the address you signed.'],
  [[0, 1, 1, 1], 'A liquidation', 'Only past the published line or the due date, with the rest returned to you in the same transaction.'],
  [[1, 1, 1, 0], 'Close by agreement', 'You, the desk and either guardian, when the other guardian is offline.'],
  [[0, 0, 1, 1], 'Nothing', 'Any two keys move nothing. Not the desk with a guardian, not both guardians together.'],
]

const keyDots = (pattern) => pattern.map((on, i) => `<i class="kd${on ? ' kd-on' : ''}${on && i === 0 ? ' kd-you' : ''}"></i>`).join('')

/* The postcard: what a loan on a public chain shows, next to what a Hypothec loan shows. */
const POSTCARD_PUBLIC = [
  ['Borrower', '0x9f3c…41aa'],
  ['Collateral', '12.40 ETH'],
  ['Where it came from', 'Every past transfer'],
  ['Liquidates at', '$1,412 per ETH'],
]
const POSTCARD_SEALED = [
  ['Collateral', 'Shielded on Zcash'],
  ['Amount locked', '••••••'],
  ['Where it came from', 'Shielded'],
  ['The dollar loan', 'Public, on <span data-net>Base</span>'],
]

const TRUST = [
  ['Code, not people', 'Guardians are software with a published fingerprint. Nobody at an operator reads your loan or clicks approve.'],
  ['The surplus comes back', 'A liquidation pays the desk what it is owed and returns the rest to you in the same transaction, or no guardian signs it.'],
  ['Every decision on the record', 'Each guardian signs what it approved or refused, and why, with the price and the rule. Anyone can read the log.'],
]

const pcRows = (rows, sealed) => rows.map(([k, v]) => `<div class="pc-row"><span>${k}</span><b${sealed && /•|Shielded/.test(v) ? ' class="sealed"' : ''}>${v}</b></div>`).join('')

const index = () =>
  page({
    title: 'Private loans against ZEC',
    body: `${header}
<main class="land">
  <section class="shell hero4">
    <div class="hero-panel"><div class="hero-media" aria-hidden="true"><video class="hero-vid vault-vid vault-vid-light" src="assets/media/vault-light.mp4" poster="assets/media/vault-light.jpg" muted loop playsinline autoplay preload="auto"></video><video class="hero-vid vault-vid vault-vid-dark" src="assets/media/vault-dark.mp4" poster="assets/media/vault-dark.jpg" muted loop playsinline autoplay preload="auto"></video></div>
      <div class="hero-copy4">
        <a class="hero-tag" href="log.html"><span class="dot dot-on"></span>Guardians online <b data-live="guardians">—</b><span aria-hidden="true">→</span></a>
        <h1 class="h-hero">Borrow dollars against <em>ZEC</em> that never leaves the shielded pool</h1>
        <p class="lede">Your ZEC stays in Zcash’s shielded pool, in a vault made for one loan, and no single party can move it: not the lender, not Hypothec, not one guardian.</p>
        <div class="hero-cta">${btn('Open the app', { href: 'markets.html' })}<a class="btn-link" href="docs.html">Read the docs <span aria-hidden="true">→</span></a></div>
      </div>
      <a class="hero-scroll" href="#what">Scroll to explore <span aria-hidden="true">↓</span></a>
    </div>
  </section>

  <section class="shell keys4" id="what">
    <div class="keys4-head">
      <span class="label-caps">One vault per loan</span>
      <h2 class="h-display">Four keys. Any three move it.</h2>
      <p>Every loan gets its own shielded vault. Its key is split four ways when the loan opens and never exists in one place. What three of the four can do together is all anyone can do.</p>
    </div>
    <div class="keyring">
      <div class="seats">${SEATS.map(([tag, name, line], i) => `<div class="seat${i === 0 ? ' seat-you' : ''}"><span class="seat-tag">${tag}</span><b>${name}</b><span>${line}</span></div>`).join('')}</div>
      <div class="moves">${MOVES.map(([pattern, what, why], i) => `<div class="move${i === MOVES.length - 1 ? ' move-none' : ''}"><span class="kds" aria-label="${pattern.reduce((n, x) => n + x, 0)} of 4 keys">${keyDots(pattern)}</span><b>${what}</b><span>${why}</span></div>`).join('')}</div>
      <div class="keyring-foot"><a class="btn-link" href="markets.html">Open the app <span aria-hidden="true">→</span></a><a class="btn-link" href="#" data-live="contract" target="_blank" rel="noopener">Verify the contract <span aria-hidden="true">→</span></a><a class="btn-link" href="log.html">See every decision <span aria-hidden="true">→</span></a></div>
    </div>
  </section>

  <section class="shell postcard">
    <h2 class="h-display">On a public chain, every loan is a postcard. Hypothec seals the envelope.</h2>
    <p class="section-lede">A loan in a public market shows who borrowed, against what, where the coins came from, and the price that wipes them out. With Hypothec the dollar side stays public and the collateral does not.</p>
    <div class="pc">
      <div class="pc-card"><span class="label-caps">What a crypto loan normally shows</span>${pcRows(POSTCARD_PUBLIC, false)}</div>
      <div class="pc-card pc-sealed"><span class="label-caps">What a Hypothec loan shows</span>${pcRows(POSTCARD_SEALED, true)}</div>
    </div>
  </section>

  <section class="shell">
    <div class="stage4">
      <h2 class="h-display">Live on testnet</h2>
      <p class="section-lede">Real orders, real vaults, real guardians. Test coins only.</p>
      <div class="live">
        <div class="bez"><div class="bez-in">
          <span class="label-caps">Best rate</span>
          <div class="live-big"><b data-live="rate">—</b><sup>APR</sup></div>
          <p data-live="rate-desk">Loading the order book…</p>
          ${btn('Borrow', { href: 'markets.html', wide: true })}
        </div></div>
        <div class="bez"><div class="bez-in">
          <span class="label-caps">On offer now</span>
          <div class="live-big"><b data-live="avail">—</b></div>
          <p data-live="desks">Across the desks’ open orders</p>
          ${btn('Post an order', { href: 'markets.html', tone: 'ghost', wide: true })}
        </div></div>
        <div class="bez"><div class="bez-in">
          <span class="label-caps">Guardians</span>
          <div class="live-big"><b data-live="guardians-big">—</b></div>
          <p data-live="code">Signing by the published rules</p>
          ${btn('See the signed log', { href: 'log.html', tone: 'ghost', wide: true })}
        </div></div>
      </div>
    </div>
  </section>

  <section class="shell steps4">
    <h2 class="h-display">How a loan runs</h2>
    <ol>${STEPS.map(([t, b], i) => `<li><span class="steps-n">${String(i + 1).padStart(2, '0')}</span><h3>${t}</h3><p>${b}</p></li>`).join('')}</ol>
  </section>

  <section class="shell trust">
    <h2 class="h-display">What you can<br/>check yourself</h2>
    <div class="trust-cols">${TRUST.map(([t, b]) => `<div><h3>${t}</h3><p>${b}</p></div>`).join('')}</div>
  </section>
</main>
<footer class="foot4"><div class="foot4-media" aria-hidden="true"><video class="pool-vid" data-src="assets/media/pool.mp4" poster="assets/media/pool.jpg" muted loop playsinline preload="none"></video></div><div class="shell">
  <div class="foot4-top">
    <div class="foot4-brand"><a class="brand" href="index.html"><span class="mark">${MARK}</span><span>Hypothec</span></a><p>Private dollar loans against shielded ZEC.</p></div>
    <nav aria-label="Product"><b>Product</b><a href="markets.html">Markets</a><a href="loan.html">Portfolio</a><a href="log.html">Guardians</a></nav>
    <nav aria-label="Learn"><b>Learn</b><a href="docs.html#how">How a loan runs</a><a href="docs.html#visibility">Who sees what</a><a href="docs.html#operators">Run a guardian</a><a href="docs.html#limits">Status and limits</a></nav>
    <nav aria-label="Source"><b>Source</b><a href="https://github.com/tomcode1000/hypothec" target="_blank" rel="noopener">GitHub</a><a href="https://github.com/tomcode1000/hypothec/blob/main/docs/DESIGN.md" target="_blank" rel="noopener">Design</a><a href="https://github.com/tomcode1000/hypothec/blob/main/docs/DECISIONS.md" target="_blank" rel="noopener">Decisions</a></nav>
  </div>
  <p class="foot4-note">Test build for the ZECATHON, on Zcash testnet and <span data-net-full>Base Sepolia</span>. Nothing here holds real money. Not audited. Not investment advice.</p>
</div></footer>`,
  })

/* ------------------------------------------------------------- markets -- */

const marketsPage = () =>
  appPage({
    title: 'Markets',
    view: 'markets',
    side: borrowerSide('Markets'),
    main: `${heading('Markets', '<span data-sym>USDC</span> against shielded ZEC. Borrow from one desk or several, or post your own order.', [
      ['Available', 'm-available'],
      ['Desks', 'm-desks'],
      ['ZEC price', 'price'],
    ])}
  ${markets()}
  ${borrowDialog()}
  ${lendDialog()}`,
  })

/* ----------------------------------------------------------- portfolio -- */

/** One panel of the borrow's progress. app.js shows the one whose `data-step` matches. */
const step = (name, body) => `<div class="step" data-step="${name}"${name === 'none' ? '' : ' hidden'}>${body}</div>`

const pieceTable = (key, cols) => `<div class="mini" role="table"><div class="mini-row mini-head" role="row">${cols.map((c) => `<span>${c}</span>`).join('')}</div><div data-app="${key}"></div></div>`

/* ------------------------------------------------------------ lock (F4) --
   The moment the borrower pays ZEC into the vault, after the Figma frames F4: a state badge
   and title, the payment (QR, amount, address, each copyable) with its confirmations, why it
   is safe and what happens next, and the vault itself. app.js fills every data-app key and
   picks the state: waiting, seen and confirming, confirmed, or several vaults at once. */
const LOCK_ICONS = {
  shield: '<path d="M9 1.8 3 4.2v4.3c0 3.6 2.6 6.6 6 7.7 3.4-1.1 6-4.1 6-7.7V4.2L9 1.8Z"/>',
  key: '<circle cx="6" cy="12" r="3.2"/><path d="m8.3 9.7 6.5-6.5M12.5 5.5l2 2M10.8 7.2l1.6 1.6"/>',
  clock: '<circle cx="9" cy="9" r="7"/><path d="M9 5v4l2.6 1.6"/>',
  bolt: '<path d="M10 1.5 3.5 10H9l-1 6.5L14.5 8H9l1-6.5Z"/>',
}
const lockIcon = (k) => `<span class="li-ic"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LOCK_ICONS[k]}</svg></span>`
const copyIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="2"/><path d="M10.5 2.5H4A1.5 1.5 0 0 0 2.5 4v6.5"/></svg>'
const zecCoin = '<span class="zec-coin" aria-hidden="true">ⓩ</span>'

const lockScreen = () => `<div class="lock4" data-app="lock4">
  <div class="lock4-head">
    <span class="badge4" data-app="lock-badge-wrap"><i></i><b data-app="lock-badge">Waiting for ZEC</b></span>
    <h2 class="lock4-title" data-app="lock-title">Send ZEC to the vault</h2>
    <p class="lock4-sub" data-app="lock-sub">Scan the QR code with your Zcash wallet, or copy the details below. The guardians see it arrive through the vault’s view-only key.</p>
  </div>
  <div class="lock4-grid">
    <div class="lock4-pay">
      <div class="lock4-main">
        <div class="lock4-qr"><div class="qr" data-app="lock-qr" aria-label="QR code of the payment request"></div><span>Scan with any Zcash wallet</span></div>
        <div class="lock4-fields">
          <span class="lab4" data-app="lock-amt-label">Amount to send</span>
          <div class="lock4-amt">${zecCoin}<b data-app="b-lock-total">—</b></div>
          <button class="copy4" type="button" data-copy="amount">${copyIcon}<span>Copy amount</span></button>
          <div class="lock4-single" data-app="lock-single">
            <span class="lab4">Vault address</span>
            <div class="addr4"><code data-app="lock-addr">—</code><button class="copy4-ic" type="button" data-copy="addr" aria-label="Copy the vault address">${copyIcon}</button></div>
            <button class="copy4" type="button" data-copy="addr">${copyIcon}<span>Copy address</span></button>
          </div>
          <div class="lock4-multi" data-app="lock-multi" hidden>
            <span class="lab4">One payment to every vault</span>
            <button class="copy4" type="button" data-copy="uri">${copyIcon}<span>Copy payment request</span></button>
          </div>
        </div>
      </div>
      <div class="lock4-vaults" data-app="lock-vaults" hidden></div>
      <div class="lock4-conf" data-app="lock-conf">
        <span class="ring4" data-app="lock-ring" style="--c: 0"><i></i></span>
        <div class="conf4-text"><b data-app="lock-conf-n">0 of 10 confirmations</b><span class="dots4" data-app="lock-dots"></span></div>
        <div class="conf4-side"><b data-app="lock-conf-state">Waiting for ZEC</b><span data-app="lock-conf-note">Nothing has arrived in the vault yet.</span></div>
      </div>
    </div>
    <div class="lock4-info">
      <div class="li4">${lockIcon('shield')}<div><b>Your ZEC stays in the shielded pool</b><p>The vault holds your ZEC in Zcash’s shielded pool. It never leaves, and is never given to anyone.</p></div></div>
      <div class="li4">${lockIcon('key')}<div><b>Needs 3 of 4 keys</b><p>The vault’s key is split four ways (you, the lending desk, two guardians). Any three must sign to move it.</p></div></div>
      <div class="li4">${lockIcon('clock')}<div><b data-app="lock-i3-t">Wait for 10 confirmations</b><p data-app="lock-i3-p">Once your payment is seen, the guardians wait for 10 confirmations on the Zcash network.</p></div></div>
      <div class="li4">${lockIcon('bolt')}<div><b data-app="lock-i4-t">Then your dollars are paid</b><p data-app="lock-i4-p">Both guardians confirm the lock on <span data-net>Base</span>, and the loan contract pays the dollars to your wallet.</p></div></div>
    </div>
    <div class="lock4-art" aria-hidden="true"><video class="vault-vid vault-vid-light" src="assets/media/vault-light.mp4" poster="assets/media/vault-light.jpg" muted loop playsinline autoplay preload="metadata"></video><video class="vault-vid vault-vid-dark" src="assets/media/vault-dark.mp4" poster="assets/media/vault-dark.jpg" muted loop playsinline autoplay preload="metadata"></video></div>
  </div>
  <button class="btn btn-ghost lock4-demo" type="button" data-act="borrower/lock" data-app="lock-demo"><span>Demo: pay from the test wallet</span></button>
</div>`

const borrowerSteps = () => [
  step('none', `${cardHead('No loans yet')}
    <div class="pad"><p class="muted">Borrow from a desk on Markets; your loans show up here.</p>
    ${btn('Go to Markets', { href: 'markets.html', wide: true })}</div>`),
  step('wait-offer', `${cardHead('Waiting for the desks')}
    <div class="pad">${pieceTable('wait-rows', ['Desk', 'You receive', 'You will lock', 'Status'])}
      <div class="sheet">${line('ZEC to lock in all', 'b-lock-quote')}</div>
      <p class="fine">Next: accept the offers here. One payment request, an address and a QR code for every vault, appears on this page as soon as the vaults are made.</p>
      ${btn('Drop unanswered requests', { act: 'borrower/cancel', tone: 'ghost', wide: true })}</div>`),
  step('accept', `${cardHead('Review and accept')}
    <div class="pad">
      ${pieceTable('accept-rows', ['Desk', 'You receive', 'You lock', 'You owe', 'Due', 'Liquidation'])}
      <div class="sheet">${line('ZEC to lock in all', 'b-accept-lock')}</div>
      <p class="fine" data-app="accept-note"></p>
      <label class="field"><span>Your ZEC comes back to</span><input data-input="zec-payout" type="text" spellcheck="false" placeholder="a fresh shielded address from your Zcash wallet"/></label>
      <p class="fine">Signed into each loan; nobody can change it later. <button class="linkish" type="button" data-fill="test-zec">Use the test wallet's address</button></p>
      <div class="preflight" data-app="preflight-accept"></div>
      ${btn('Accept and sign', { act: 'borrower/accept', wide: true, key: 'accept-label' })}
    </div>`),
  step('keys', `${cardHead('Making the vaults')}
    <div class="pad"><p class="sub-h" data-app="keys-note">One vault per loan</p>${making()}</div>`),
  step('wait-fund', `${cardHead('The desks are funding')}
    <div class="pad">${pieceTable('piece-rows', ['Desk', 'Amount', 'Status'])}</div>`),
  step('lock', lockScreen()),
  step('confirming', lockScreen()),
  step('active', `${cardHead('Your loans')}
    <div class="pad">
      ${pieceTable('loan-rows-b', ['Desk', 'Received', 'Left', 'Due', 'LTV', 'Status', ''])}
      <div class="preflight" data-app="preflight-repay"></div>
      ${btn('Repay all', { act: 'borrower/repay-all', wide: true, key: 'repay-all' })}
      ${btn('Get all ZEC back', { act: 'borrower/release-all', wide: true, key: 'release-all' })}
      <details class="fold" data-app="topup">
        <summary>Add collateral</summary>
        <div data-app="topup-note"></div>
        <div class="topup-fields">
          <label class="field"><span>To the vault of</span><select data-app="topup-pick"></select></label>
          <label class="field"><span>Add</span><div class="amount"><input data-input="topup" type="number" min="0" step="0.001" inputmode="decimal"/><b>ZEC</b></div></label>
        </div>
        ${btn('Add from the test wallet', { act: 'borrower/topup', tone: 'ghost', wide: true })}
      </details>
    </div>`),
  step('closed', `${cardHead('Settled')}
    <div class="pad">${pieceTable('outcome-rows', ['Desk', 'Outcome', 'Back to you', 'Zcash transaction'])}
      ${btn('Borrow again', { href: 'markets.html', tone: 'ghost', wide: true })}</div>`),
]

const loan = () =>
  appPage({
    title: 'Portfolio',
    view: 'borrower',
    side: borrowerSide('Portfolio'),
    main: `${heading('Portfolio', '<span data-app="basket-sub">Your loans</span>', [
      ['Borrowed', 'b-principal'],
      ['Left to repay', 'b-left'],
      ['Locked', 'vault-zec'],
      ['Highest LTV', 'b-ltv'],
    ])}
  ${portfolioTabs('Borrowing')}
  <section class="card progress" data-app="progress" hidden>
    <div class="progress-text"><b data-app="prog-title">—</b><span data-app="prog-detail"></span></div>
    <span class="progress-time" data-app="prog-time"></span>
    <div class="progress-bar" aria-hidden="true"><i></i></div>
  </section>
  ${card(quest(), ' data-card="quest" data-when="loans"')}
  <section class="card scene">
    <div class="scene-play">${borrowerSteps().join('')}</div>
    <div class="scene-vault" data-when="loans"><p class="kicker">Vaults</p>${vaultArt()}</div>
  </section>
  <div class="pair" data-when="loans">
    ${card(`${cardHead('Health', '', loanPick())}<div class="pad">${health()}</div>`)}
    ${card(`${cardHead('Guardians', '', '<a class="more" href="log.html?as=borrower">Log</a>')}<div class="pad"><div class="guardians">${guardian('A')}${guardian('B')}</div></div>`)}
  </div>`,
  })

const desk = () =>
  appPage({
    title: 'Portfolio',
    view: 'desk',
    side: deskSide('Portfolio'),
    main: `${heading('Portfolio', 'Your desk and the loans it has made.', [
      ['Lent now', 'd-lent'],
      ['Available to lend', 'd-desk-usdc'],
      ['Collateral', 'd-collateral'],
      ['ZEC price', 'price'],
    ])}
  ${portfolioTabs('Lending')}
  <section class="card order-bar">
    <div><span class="kicker">Your order</span><b data-app="my-desk-status">Connect a wallet</b></div>
    <button class="btn btn-ghost" type="button" data-open="lend" data-app="edit-order"><span>Post an order</span></button>
  </section>
  <section class="card table-card">
    <div class="table-top"><span class="kicker" data-app="req-count">Requests</span></div>
    <div class="table table-req" role="table">
      <div class="tr th" role="row"><span>Borrower</span><span>Asks you for</span><span>Locks</span><span>Owes</span><span>Of their borrow</span><span>Pays out to</span><span></span></div>
      <div data-app="req-rows"></div>
    </div>
  </section>
  <section class="card table-card">
    <div class="table-top"><span class="kicker" data-app="loan-count">Loans</span></div>
    <div class="table table-loans" role="table">
      <div class="tr th" role="row"><span>Loan</span><span>Rate</span><span>Lent</span><span>Collateral</span><span>LTV</span><span>Guardians</span><span>Status</span><span></span></div>
      <div data-app="loan-rows"></div>
    </div>
    <p class="fine table-foot" data-app="d-liq-why"></p>
  </section>
  ${card(`${cardHead('Loan detail', '', loanPick())}${quest()}`, ' data-card="quest" id="detail" data-when="loans"')}
  <div class="pair" data-when="loans">
    ${card(`<div class="pad">${health()}</div>`)}
    ${card(`${cardHead('Guardians', '', '<a class="more" href="log.html?as=desk">Log</a>')}<div class="pad"><div class="guardians">${guardian('A')}${guardian('B')}</div></div>`)}
  </div>
  <details class="card fold fold-card">
    <summary>Price feed and demo controls</summary>
    <div class="pad">
      <div class="feeds feeds-wide" data-app="feeds"></div>
      <div class="override">
        <label class="field"><span>Demo price override</span><div class="amount"><input data-input="override" type="number" min="1" step="10" placeholder="live"/><b>USD</b></div></label>
        <div class="actions">${btn('Set', { act: 'lender/price', tone: 'ghost' })}${btn('Back to live', { act: 'lender/price-live', tone: 'ghost' })}</div>
      </div>
      <p class="fine">For the demo only. Guardians log every signature made under an override as such.</p>
    </div>
  </details>
  ${lendDialog()}`,
  })

/* ------------------------------------------------------------- guardians -- */

const operator = (letter) => `<div class="operator card">
  <div class="operator-head">
    <span class="guardian-token guardian-token-lg">${letter}</span>
    <div><h3>Guardian ${letter}</h3><p>Demo operator · run by the Hypothec team</p></div>
    ${pill('On the list', 'good')}
  </div>
  <div class="sheet">${line('<span data-net>Base</span> address', `op-${letter}-addr`)}${line('Signed entries', `op-${letter}-count`)}${line('Seat', `op-${letter}-seat`)}</div>
</div>`

const log = () =>
  appPage({
    title: 'Guardians',
    view: 'log',
    side: `<div data-app="log-side"></div>`,
    main: `${heading('Guardians', 'What the two guardians check, and every decision they signed.', [
      ['Operators', 'log-ops'],
      ['Signed entries', 'log-signed'],
    ])}
  <div class="section-row"><h2 class="section-h">Checks</h2>${loanPick()}</div>
  <div class="stages">
    ${stage('lock', 1, 'Before the borrower is paid', 'The ZEC is locked and confirmed.')}
    ${stage('release', 2, 'Before the ZEC goes back', 'Repaid, and only to the borrower.')}
    ${stage('liquidation', 3, 'Before a liquidation', 'Past the line, surplus in the same move.')}
  </div>
  <h2 class="section-h">Operator list <a class="section-link" href="docs.html#operators">Run a guardian →</a></h2>
  <div class="operators" data-app="operators"><div class="feat feat-skel"></div><div class="feat feat-skel"></div></div>
  ${card(`${cardHead('Signed log', '', pill('—', '', 'log-count'))}<div class="log" data-app="log"></div>`)}`,
  })

/* The log page carries the rail either way; app.js picks the side the visitor came from. */
const logWithRails = () =>
  log().replace('<div data-app="log-side"></div>', `<div data-rail-for="borrower">${borrowerSide('Guardians')}</div><div data-rail-for="desk" hidden>${deskSide('Guardians')}</div>`)

/* ------------------------------------------------------------------ docs -- */

const OPERATOR_NEEDS = [
  ['A server', 'Any small Linux machine that stays on: a VPS or a cloud instance. 2 GB of memory is enough.'],
  ['A <span data-net>Base</span> key', 'One wallet key, with a little ETH for the confirmations it sends. Its fees arrive at this address.'],
  ['Zcash access', 'A public lightwalletd such as testnet.zec.rocks. No Zcash node of your own.'],
  ['Two addresses', 'The Hypothec loanbook (orders, signed entries, the operator list) and the relay (carries encrypted messages between a vault’s four key holders).'],
  ['The code', 'Rust, Node.js 22 and Python 3.10, or the Docker image from the repository.'],
]
const OPERATOR_STEPS = [
  ['Build', 'Clone the repository and build the key-share service and the rules engine.'],
  ['Add your key', 'Put the guardian’s <span data-net>Base</span> key in ~/.hypothec/testnet-wallets.json, under refereeA or refereeB. It never leaves the server.'],
  ['Start both parts', 'The key-share service first, then the guardian, pointed at the loanbook and the relay.'],
  ['It registers', 'The guardian signs its name, operator and a fingerprint of the rules code into the operator list, then heartbeats every 30 seconds.'],
  ['Desks choose it', 'It shows Online on the Guardians page. Every loan from a desk that names it is guarded from then on.'],
]

const DOCS = [
  ['overview', 'Overview', `<p>Hypothec lends <span data-sym>USDC</span> on <span data-net>Base</span> against ZEC that stays shielded on Zcash. Each loan's collateral sits in its own vault: one threshold key with four holders (the borrower, the lending desk and two guardians), any three of whom can sign. No single party, and no two of them, can move it alone.</p>
    <dl class="facts">${STRUCTURE.map(([k, d]) => `<div><dt>${k}</dt><dd>${d}</dd></div>`).join('')}</dl>`],
  ['how', 'How a loan runs', `<ol class="steps">${STEPS.map(([t, b], i) => `<li><span class="steps-n">${String(i + 1).padStart(2, '0')}</span><h3>${t}</h3><p>${b}</p></li>`).join('')}</ol>`],
  ['orders', 'Orders and split borrows', `<p>Any wallet can open a desk and post an order: its rate, term, loan-to-value levels and how much it lends in all. Markets lists every order.</p>
    <p>A borrower can fill one borrow from several orders. The desk chosen fills first and the other ticked orders cover the rest. Each piece becomes its own loan, with its own vault and its desk's terms, so a liquidation of one piece leaves the others untouched. The borrower accepts every offer at once and locks every vault in one shielded transaction.</p>`],
  ['controls', 'Controls', `<div class="grid2">${CONTROLS.map(([t, b]) => `<div class="grid2-cell"><h3>${t}</h3><p>${b}</p></div>`).join('')}</div>`],
  ['visibility', 'Who sees what', `<div class="card"><table class="dt">
      <thead><tr><th scope="col">Party</th><th scope="col">Sees</th><th scope="col">Never sees</th></tr></thead>
      <tbody>${SEES.map(([w, y, n]) => `<tr><th scope="row">${w}</th><td>${y}</td><td>${n}</td></tr>`).join('')}</tbody>
    </table></div>`],
  ['guardians', 'Guardians', `<p>A guardian is an operator from the Hypothec list running the published rules engine. It confirms a lock only when it sees the full amount in the vault; it releases only after the contract says repaid (or cancelled, when a lock never completed), and only to the borrower's signed address; it liquidates only past the published line, or after the due date, with the surplus to the borrower in the same transaction. It signs every decision, and the reason, into the log.</p>`],
  ['operators', 'Run a guardian', `<p>A guardian is a program, not a person. An operator runs it on their own server; from then on it watches every loan that names it and signs or refuses by the published rules, with nobody approving anything by hand. Two operators can guard every loan on Hypothec.</p>
    <p>The operator sets up one <span data-net>Base</span> key, once: it is the guardian's identity on the operator list and the address its fees are paid to. Each loan's vault needs a fresh key share, and the guardian's key-share service makes it automatically when the loan starts and keeps it on the operator's server; it never leaves.</p>
    <h3 class="sub-h">What you need</h3>
    <dl class="facts">${OPERATOR_NEEDS.map(([k, d]) => `<div><dt>${k}</dt><dd>${d}</dd></div>`).join('')}</dl>
    <h3 class="sub-h">Start it</h3>
    <ol class="steps">${OPERATOR_STEPS.map(([t, b], i) => `<li><span class="steps-n">${String(i + 1).padStart(2, '0')}</span><h3>${t}</h3><p>${b}</p></li>`).join('')}</ol>
    <pre class="code"><code>git clone --recurse-submodules https://github.com/tomcode1000/hypothec
cd hypothec &amp;&amp; cargo build --release -p hypothec-core
(cd services &amp;&amp; npm ci)

# the key-share service (one share per loan, kept on this server)
ZAFE_NETWORK=test ZAFE_RELAY=&lt;relay URL&gt; PARTY_BIN=target/release/hypothec-party \\
  STACK_STATE=~/guardian-state python3 e2e/control.py &amp;

# the guardian
cd services
HYPOTHEC_LOANBOOK=&lt;loanbook URL&gt; HYPOTHEC_OPERATOR="Your company" \\
  ZAFE_NETWORK=test npx ts-node src/serve.ts refereeA</code></pre>
    <h3 class="sub-h">Pay and uptime</h3>
    <p>Each guardian earns 0.10% of every loan's principal it guards, paid by the loan contract on <span data-net>Base</span> when it confirms the lock, from the desk's funding. The fee is the same whether the loan is repaid or liquidated, so a guardian never gains by liquidating.</p>
    <p>The guardian sends a signed heartbeat every 30 seconds. While they arrive it shows Online on the <a href="log.html">Guardians</a> page and desks can choose it; if they stop for 90 seconds it shows Offline and new desks cannot pick it. Loans it already guards still close without it: the borrower, the desk and the other guardian are three of four keys.</p>
    <p>The full checks it runs, and why it refuses, are in the repository: <a href="https://github.com/tomcode1000/hypothec/blob/main/docs/GUARDIANS.txt">GUARDIANS.txt</a>, <a href="https://github.com/tomcode1000/hypothec/blob/main/docs/DESIGN.md">DESIGN.md</a>.</p>
    <p class="note">In this demo both guardians are run by the Hypothec team, on the same server as the website, and its loanbook and relay are not open to outside operators yet. In production each guardian is an independent company, and Hypothec runs at most one.</p>`],
  ['limits', 'Status and limits', `<dl class="disclosures">${DISCLOSURES.map(([k, d]) => `<div><dt>${k}</dt><dd>${d}</dd></div>`).join('')}</dl>`],
]

const docs = () =>
  appPage({
    title: 'Docs',
    view: 'docs',
    side: borrowerSide('Docs'),
    main: `${heading('Docs', 'How Hypothec works, what it protects, and its limits.')}
  <div class="docs">
    <nav class="docs-toc" aria-label="On this page">${DOCS.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>
    <article class="docs-body">${DOCS.map(([id, t, body]) => `<section id="${id}"><h2 class="h2">${t}</h2>${body}</section>`).join('')}</article>
  </div>`,
  })

/* Old links to borrow.html land on Markets. */
const moved = (to) => page({ title: 'Markets', body: `<meta http-equiv="refresh" content="0; url=${to}"/><p class="shell"><a href="${to}">Markets</a></p>` })

export const pages = () => ({
  'index.html': index(),
  'markets.html': marketsPage(),
  'borrow.html': moved('markets.html'),
  'loan.html': loan(),
  'desk.html': desk(),
  'log.html': logWithRails(),
  'docs.html': docs(),
})
