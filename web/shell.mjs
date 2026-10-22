import { MARK, caret, ic } from './chrome.mjs'
import { vaultLines } from './art.mjs'

/**
 * The chrome and the pieces both product surfaces share.
 *
 * The borrower app and the lender desk are one design with two rails, as Quorum's
 * worker app and console are: the card, the tile, the pill, the health bar and the
 * guardian token are defined once here, and when both surfaces show the same panel it
 * is the same function.
 *
 * The look is a credit desk's, not a game's: hairline rules, white panels, figures
 * set in tabular numerals, one accent colour for the one action on a screen. Icons
 * appear only where they help find something (the navigation); a heading, a button
 * or a notice carries words, not a glyph. A loan is still a run of steps (the
 * progress line), and the LTV is still drawn against the published levels, because
 * both are information, not decoration.
 *
 * Two rules carried over from Quorum:
 *   - Every figure comes from /api/state or shows as a dash. Nothing is typed in.
 *   - Nothing celebrates money arriving. A finished step is marked done, plainly;
 *     the loan's end is a "Loan closed" panel with its transaction, not confetti.
 */

/* ---------------------------------------------------------------- atoms -- */

const v = (key, fallback = '—') => `<b data-app="${key}">${fallback}</b>`

const pill = (label, tone = '', key = '') =>
  `<span class="pill${tone ? ` pill-${tone}` : ''}"${key ? ` data-app="${key}"` : ''}>${label}</span>`

const tile = (icon, tone = '', size = '') =>
  `<span class="tile${size ? ` tile-${size}` : ''}${tone ? ` tile-${tone}` : ''}">${ic(icon)}</span>`

const card = (body, extra = '') => `<section class="card"${extra}>${body}</section>`

/* The icon argument is kept so callers read the same; headings carry no glyph. */
const cardHead = (title, _icon = '', right = '') =>
  `<div class="card-head"><h2 class="h2">${title}</h2>${right}</div>`

/**
 * The one button. Words only. `act` names the API action app.js posts; a button
 * without one is a link.
 */
const btn = (label, { act = '', href = '', tone = 'primary', key = '', wide = false } = {}) => {
  const cls = `btn btn-${tone}${wide ? ' btn-wide' : ''}`
  const inner = `<span>${label}</span>`
  if (href) return `<a class="${cls}" href="${href}">${inner}</a>`
  return `<button class="${cls}" type="button"${act ? ` data-act="${act}"` : ''}${key ? ` data-app="${key}"` : ''}>${inner}</button>`
}

/** A label and a live figure, one row of a terms sheet. */
const line = (label, key, note = '') =>
  `<div class="line"><span>${label}</span>${v(key)}${note ? `<em>${note}</em>` : ''}</div>`

const stat = (_icon, label, key, note = '', tone = '') =>
  `<div class="stat${tone ? ` stat-${tone}` : ''}"><span>${label}</span>${v(key)}${note ? `<em data-app="${key}-note">${note}</em>` : ''}</div>`

/* A notice: a rule on the left in the tone's colour, a title and one paragraph. */
const info = (_icon, title, body, tone = '') =>
  `<div class="info${tone ? ` info-${tone}` : ''}"><b>${title}</b><p>${body}</p></div>`

/* ------------------------------------------------------------- progress -- */

/**
 * The progress line. One numbered stop per step of a loan; app.js marks each done,
 * current or ahead from the loan's real state. The labels are the borrower's own
 * actions or the thing they are waiting for, never a stage name only the system knows.
 */
const QUEST = [
  ['dollar', 'Ask', 'request'],
  ['guard', 'Accept', 'accept'],
  ['key', 'Keys', 'keys'],
  ['lock', 'Lock ZEC', 'lock'],
  ['coin', 'Get <span data-sym>USDC</span>', 'receive'],
  ['receipt', 'Repay', 'repay'],
  ['vault', 'ZEC back', 'release'],
]

/*
  One line runs behind all seven stops and fills up to the current one (app.js
  sets --p from the loan's real step). Under each label a tag says done, now or next, so
  the track reads at a glance without counting nodes.
*/
const quest = () => `<div class="quest-wrap" data-app="quest-wrap">
  <div class="quest-track" aria-hidden="true"><span class="quest-fill"></span></div>
  <ol class="quest" data-app="quest">${QUEST.map(
    ([icon, label, step], i) =>
      `<li data-quest="${step}"><span class="quest-node">${i + 1}</span><span class="quest-label">${label}</span><span class="quest-tag"></span></li>`,
  ).join('')}</ol>
</div>`

/**
 * The health bar: LTV against the published levels. Zones are drawn at the desk's
 * margin-call and liquidation LTVs (set by app.js from the offer), the marker at the
 * live LTV. The scale runs to 100%: past that the collateral no longer covers the debt.
 */
/*
  The bar starts at the levels the desk publishes (BRIEF section 3: margin call at 65%
  LTV, liquidation at 75%); app.js redraws them from the loan's own signed terms.
*/
const MARGIN = 65
const LIQ = 75

const health = () => `<div class="health" data-app="health">
  <div class="health-top"><span>Loan health</span>${pill('—', '', 'health-pill')}</div>
  <div class="health-bar">
    <span class="health-zone health-safe" data-app="zone-safe" style="width:${MARGIN}%"></span><span class="health-zone health-margin" data-app="zone-margin" style="width:${LIQ - MARGIN}%"></span><span class="health-zone health-liq" data-app="zone-liq"></span>
    <span class="health-mark" data-app="health-mark" hidden><b data-app="ltv">—</b></span>
  </div>
  <div class="health-scale"><span>0%</span><span data-app="margin-ltv-label" style="left:${MARGIN}%">${MARGIN}%</span><span data-app="liq-ltv-label" style="left:${LIQ}%">${LIQ}%</span><span>100%</span></div>
  <div class="health-prices">
    <div><span>ZEC price</span>${v('price')}<em data-app="price-source">—</em></div>
    <div><span>Margin call at</span>${v('margin-price')}</div>
    <div><span>Liquidation at</span>${v('liq-price')}</div>
  </div>
</div>`

/**
 * A guardian: one of the two referees from the operator list. Its state (watching,
 * lock confirmed, signed, refused) comes from the chain and the signed log.
 */
const guardian = (letter) => `<div class="guardian" data-guardian="${letter}">
  <span class="guardian-token">${letter}</span>
  <div><b>Guardian ${letter}</b><span class="mono" data-app="guardian-${letter}-addr">—</span></div>
  ${pill('Waiting', '', `guardian-${letter}-state`)}
</div>`

/**
 * The vault, as facts: what the four key holders see through the viewing key, and
 * what the public chain shows, which is nothing. On the landing surface (`live`
 * false) it names the contents instead of a figure.
 */
const vaultArt = (live = true) => `<dl class="facts">
  <div><dt>Locked</dt><dd>${live ? '<b class="mono" data-app="vault-zec">—</b>' : 'Your ZEC'}</dd></div>
  <div><dt>Spending rule</dt><dd>${live ? '<span data-app="vault-count">One vault per loan</span>; any 3 of its 4 keys' : 'Any 3 of 4 keys'}</dd></div>
  <div><dt>Key holders</dt><dd>You · ${live ? '<span data-app="desk-name">the desk</span>' : 'the desk'} · Guardian A · Guardian B</dd></div>
  <div><dt>On the public chain</dt><dd>Nothing: no owner, no amount, no sign of a loan</dd></div>
</dl>`

/* ------------------------------------------------------------------ rails -- */

/* One menu on every page, as Quorum's: where the work is, where your positions are, the
   guardians' record, and the docs. Borrowing and lending start from a market row; the
   wallet connected decides whose positions Portfolio shows. */
const APP_NAV = [
  ['gauge', 'Markets', 'markets.html'],
  ['vault', 'Portfolio', 'loan.html'],
  ['guard', 'Guardians', 'log.html'],
  ['list', 'Docs', 'docs.html'],
]
const BORROWER_NAV = APP_NAV
const DESK_NAV = APP_NAV

const navList = (items, current) =>
  `<nav class="nav-rail" aria-label="Sections">${items
    .map(([icon, label, href]) => `<a href="${href}" title="${label}"${label === current ? ' aria-current="page"' : ''}>${ic(icon)}<span>${label}</span></a>`)
    .join('')}</nav>`

const railToggle = `<button class="rail-toggle" type="button" data-rail-toggle aria-label="Collapse navigation">${ic('arrowLeft')}</button>`
const themeToggle = `<button class="theme" type="button" data-theme-toggle>${ic('sun')}<span data-theme-label>Dark mode</span></button>`

/*
  The wallet button. It connects the browser wallet the person already uses; the label
  turns into their short address once connected. Each <span data-net>Base</span> action is signed there.
*/
const walletBtn = (label) =>
  `<button class="wallet-btn" type="button" data-app="wallet"><span class="wallet-dot"></span><span data-app="wallet-label">${label}</span></button>`

/*
  The top bar, as lending apps lay it out: the mark on the left, the sections in the
  middle, the network, the wallet and the theme on the right. It stays at the top while
  the page scrolls.
*/
const side = (_label, items, current) => `<header class="side topnav">
  <a class="brand" href="index.html"><span class="mark">${MARK}</span><span>Hypothec</span></a>
  ${navList(items, current)}
  <div class="topnav-end">
    <div class="chainsw" data-app="chain-switch" role="group" aria-label="Loan chain" hidden></div><span class="topbar-net" data-app="net-solo"><i></i><span data-app="net-label">Base Sepolia · Zcash</span></span>
    ${walletBtn('Connect wallet')}
    <button class="theme theme-icon" type="button" data-theme-toggle aria-label="Switch theme">${ic('sun')}<span data-theme-label hidden>Dark mode</span></button>
  </div>
</header>`

const borrowerSide = (current) => side('', BORROWER_NAV, current)

const deskSide = (current) => side('', DESK_NAV, current)

const top = (kicker, title, right = '') =>
  `<header class="top"><div><p class="kicker">${kicker}</p><h1 class="h1">${title}</h1></div>${right}</header>`

/**
 * A page header in the shape lending apps use: title and one line on the left, the
 * page's summary figures as chips on the right. `chips` is [label, data-app key].
 */
const heading = (title, sub, chips = []) => `<header class="heading">
  ${vaultLines({ cls: 'art-heading', rings: 12, points: 96 })}
  <div><h1 class="h1">${title}</h1><p class="heading-sub">${sub}</p></div>
  <div class="chips">${chips.map(([label, key]) => `<span class="chip"><span>${label}</span><b data-app="${key}">—</b></span>`).join('')}</div>
</header>`

/** The featured desks: the best rates on offer, each a card with its rate large (app.js). */
const featured = () => `<div class="featured" data-app="featured"><div class="feat feat-skel"></div><div class="feat feat-skel"></div></div>`

/** Filter chips and a search box over the order book. */
const filters = () => `<div class="filters">
  <div class="fchips" role="group" aria-label="Show">
    <button class="fchip" type="button" data-filter="all" aria-pressed="true">All desks</button>
    <button class="fchip" type="button" data-filter="instant" aria-pressed="false">Instant</button>
    <button class="fchip" type="button" data-filter="short" aria-pressed="false">Under 30 days</button>
    <button class="fchip" type="button" data-filter="long" aria-pressed="false">30 days and over</button>
  </div>
  <label class="search">${ic('eye')}<input data-input="desk-search" type="search" placeholder="Search desks…" autocomplete="off"/></label>
</div>`

/**
 * The order book: one row per desk's order, its terms in columns, Borrow and Lend at the
 * end of the row. Rows are drawn by app.js from /api/state; each action opens a dialog.
 */
const markets = () => `${filters()}<section class="card table-card">
  <div class="table-top"><span class="showing" data-app="m-count">Orders</span><span class="fine-inline">Each desk's terms are signed by its wallet</span></div>
  <div class="table table-book" role="table">
    <div class="tr th" role="row">
      <span role="columnheader">Desk</span>
      <button class="sort" type="button" data-sort="rate" role="columnheader">Rate</button>
      <button class="sort" type="button" data-sort="term" role="columnheader">Term</button>
      <span role="columnheader">LTV start / liq.</span>
      <button class="sort" type="button" data-sort="lent" role="columnheader">Lent now</button>
      <button class="sort" type="button" data-sort="available" role="columnheader">Available</button>
      <span role="columnheader"></span>
    </div>
    <div data-app="market-rows"><div class="skeleton"><i></i><i></i></div></div>
  </div>
</section>`

const dialogHead = (id, title) => `<div class="card-head"><h2 class="h2" id="${id}">${title}</h2><button class="x" type="button" data-close aria-label="Close">${ic('x')}</button></div>`

/**
 * Borrow, opened from a market row. The row's desk fills first; the other orders, ticked,
 * cover what it cannot (D16). Each piece is its own loan.
 */
const borrowDialog = () => `<dialog class="dialog dialog-ticket" data-app="borrow-dialog" aria-labelledby="borrow-title"><div class="bezel">
  <div class="tk-head">
    <div><span class="label-caps">Borrow · <span data-net>Base</span></span><h2 class="h2" id="borrow-title"><span data-app="desk-name">A desk</span></h2></div>
    <button class="x" type="button" data-close aria-label="Close">${ic('x')}</button>
  </div>
  <div class="tk-body">
    <div class="tk-main">
      <label class="field tk-amount"><span>Amount</span><div class="amount"><input data-input="amount" type="number" min="0.1" step="0.1" value="5" inputmode="decimal"/><b data-sym>USDC</b></div></label>
      <div class="tk-block">
        <div class="tk-sub"><span class="label-caps">Filled by</span><span class="tk-note" data-app="fill-note"></span></div>
        <div class="mini" role="table"><div class="mini-row mini-head" role="row"><span></span><span>Desk</span><span>Rate</span><span>Available</span><span>You take</span></div><div data-app="fill-rows"></div></div>
      </div>
      <label class="privsw" data-app="priv-wrap" hidden>
        <input type="checkbox" data-input="private" checked/>
        <span class="privsw-text"><b>Private</b><em>A one-time key borrows; your wallet never appears on <span data-net>Base</span>.</em></span>
        <span class="privsw-knob" aria-hidden="true"></span>
      </label>
      <div class="dest">
        <p class="dest-to">Paid to <b data-app="dest-wallet">your connected wallet</b>. <button class="linkish" type="button" data-toggle="dest">Change</button></p>
        <label class="field" data-app="dest-field" hidden><span>Send the <span data-sym>USDC</span> to</span><input data-input="usdc-address" type="text" spellcheck="false" placeholder="0x… any address on this chain"/></label>
      </div>
    </div>
    <aside class="tk-sheet">
      <span class="label-caps">Term sheet</span>
      <div class="tk-lock"><span>You lock</span><b data-app="q-collateral">—</b><em>shielded, in a 3-of-4 vault</em></div>
      <dl class="tk-terms">
        <div><dt>You repay</dt><dd data-app="q-owed">—</dd></div>
        <div><dt>Rate</dt><dd data-app="q-apr">—</dd></div>
        <div><dt>Due</dt><dd data-app="q-due">—</dd></div>
        <div><dt>Paid on</dt><dd data-app="q-chain">—</dd></div>
      </dl>
      <p class="tk-fine">Sized at each desk's start LTV, ZEC at <b data-app="sizing-price">—</b> (the guardians' one-hour average).</p>
      <div class="preflight" data-app="preflight-borrow"></div>
      ${btn('Request', { act: 'borrower/request', wide: true, key: 'ask-btn' })}
    </aside>
  </div>
</div></dialog>`

/**
 * Lend: post an order, or update yours. Opened from a market row it starts from that
 * desk's terms. Desks lend their own money; there is no shared pool (D10).
 */
const lendDialog = () => `<dialog class="dialog dialog-ticket" data-app="lend-dialog" aria-labelledby="lend-title"><div class="bezel">
  <div class="tk-head">
    <div><span class="label-caps">Lend · <span data-net>Base</span></span><h2 class="h2" id="lend-title"><span data-app="lend-title">Post an order</span></h2></div>
    <button class="x" type="button" data-close aria-label="Close">${ic('x')}</button>
  </div>
  <div class="tk-body">
    <div class="tk-main">
      <fieldset class="tk-group">
        <legend class="label-caps">Order</legend>
        <div class="tk-row2">
          <label class="field"><span>Desk name</span><input data-desk="name" type="text" maxlength="32" placeholder="shown to borrowers"/></label>
          <label class="field"><span>Lend up to</span><div class="amount"><input data-desk="max" type="number" min="0.1" step="0.1"/><b data-sym>USDC</b></div></label>
        </div>
      </fieldset>
      <fieldset class="tk-group">
        <legend class="label-caps">Pricing</legend>
        <div class="tk-row2">
          <label class="field"><span>Rate</span><div class="amount"><input data-desk="apr" type="number" min="0" max="100" step="0.1"/><b>% APR</b></div></label>
          <label class="field"><span>Term</span><div class="amount"><input data-desk="term" type="number" min="1" step="1"/><select data-desk="term-unit"><option value="86400">days</option><option value="60">minutes</option></select></div></label>
        </div>
      </fieldset>
      <fieldset class="tk-group">
        <legend class="label-caps">Risk</legend>
        <div class="tk-row4">
          <label class="field"><span>Start LTV</span><div class="amount"><input data-desk="start" type="number" min="10" max="90" step="1"/><b>%</b></div></label>
          <label class="field"><span>Margin call</span><div class="amount"><input data-desk="margin" type="number" min="10" max="94" step="1"/><b>%</b></div></label>
          <label class="field"><span>Liquidation</span><div class="amount"><input data-desk="liq" type="number" min="10" max="94" step="1"/><b>%</b></div></label>
          <label class="field"><span>Price buffer</span><div class="amount"><input data-desk="slippage" type="number" min="0" max="10" step="0.5"/><b>%</b></div></label>
        </div>
      </fieldset>
      <fieldset class="tk-group">
        <legend class="label-caps">Settlement</legend>
        <label class="field"><span>ZEC address for liquidation shares <button class="linkish" type="button" data-fill="test-desk">Use the test desk's</button></span><input data-desk="zec" type="text" spellcheck="false" placeholder="a shielded address from your Zcash wallet"/></label>
        <div class="tk-row2">
          <label class="field"><span>Guardian A</span><select data-desk="guardian-a"></select></label>
          <label class="field"><span>Guardian B</span><select data-desk="guardian-b"></select></label>
        </div>
      </fieldset>
    </div>
    <aside class="tk-sheet">
      <span class="label-caps">What borrowers see</span>
      <div class="tk-lock"><span>Your rate</span><b data-app="lp-rate">—</b><em data-app="lp-term">—</em></div>
      <div class="ladder" aria-label="Loan-to-value levels">
        <div class="ladder-bar"><i class="ladder-safe" data-app="lp-bar-safe"></i><i class="ladder-warn" data-app="lp-bar-warn"></i><i class="ladder-bad"></i></div>
        <div class="ladder-keys"><span>Start <b data-app="lp-start">—</b></span><span>Margin call <b data-app="lp-margin">—</b></span><span>Liquidation <b data-app="lp-liq">—</b></span></div>
      </div>
      <dl class="tk-terms">
        <div><dt>Order size</dt><dd data-app="lp-max">—</dd></div>
        <div><dt>Guardian fees</dt><dd data-app="lp-fee">—</dd></div>
        <div><dt>Per 100 lent</dt><dd data-app="lp-collateral">—</dd></div>
        <div><dt>Earns at term</dt><dd data-app="lp-earn">—</dd></div>
      </dl>
      <p class="tk-fine">Each guardian earns <b data-app="guardian-fee">0.10%</b> of a loan's principal from your funding when it confirms the lock, the same whether the loan is repaid or liquidated.</p>
      <label class="privsw privsw-row" data-app="priv-wrap" hidden>
        <input type="checkbox" data-input="private-desk" checked/>
        <span class="privsw-text"><b>Private desk</b><em>A one-time key runs it and funds from your private balance; your wallet never appears on <span data-net>Base</span>.</em></span>
        <span class="privsw-knob" aria-hidden="true"></span>
      </label>
      <div class="preflight" data-app="preflight-lend"></div>
      ${btn('Sign and post', { act: 'lender/desk', wide: true, key: 'desk-publish' })}
    </aside>
  </div>
</div></dialog>`

/** Portfolio has two sides; the tabs switch between them. */
const portfolioTabs = (current) => `<nav class="tabs" aria-label="Portfolio">${[['Borrowing', 'loan.html'], ['Lending', 'desk.html']]
  .map(([label, href]) => `<a href="${href}"${label === current ? ' aria-current="page"' : ''}>${label}</a>`)
  .join('')}</nav>`

/** A picker for which loan a panel shows, when there are several. Filled by app.js. */
const loanPick = () => `<label class="pick" data-app="pick-wrap" hidden><span>Loan</span><select data-app="loan-pick"></select></label>`

/**
 * One stage of what the guardians check: each condition with its state and detail
 * (filled by app.js from /api/state), then what Guardian A and Guardian B actually did.
 */
const stage = (key, n, title, when) => `<section class="card stage" data-stage="${key}">
  <div class="stage-head"><span class="stage-n">${n}</span><div><h2 class="h2">${title}</h2><p class="stage-when">${when}</p></div>${pill('—', '', `stage-${key}-pill`)}</div>
  <ul class="checks" data-app="checks-${key}"></ul>
  <div class="decisions" data-app="dec-${key}"></div>
</section>`

/**
 * The vault being made, party by party: the borrower opens it, the desk and both
 * guardians join, all four see one safety number, then each makes its key share.
 */
const making = () => `<ol class="making" data-app="making">
  <li data-make="open"><span class="mk"></span><b>You opened the vault</b><em>your app starts it</em></li>
  <li data-make="lender"><span class="mk"></span><b><span data-app="desk-name">The desk</span> joined</b><em>the desk's agent</em></li>
  <li data-make="refereeA"><span class="mk"></span><b>Guardian A joined</b><em>an operator on the list</em></li>
  <li data-make="refereeB"><span class="mk"></span><b>Guardian B joined</b><em>an operator on the list</em></li>
  <li data-make="safety"><span class="mk"></span><b>All four see the same safety number</b><em class="mono" data-app="safety-number">—</em></li>
  <li data-make="keys"><span class="mk"></span><b>Each made its share of one key</b><em>the whole key never exists anywhere</em></li>
</ol>`

export { featured, v, pill, tile, card, cardHead, btn, line, stat, info, quest, heading, markets, borrowDialog, lendDialog, portfolioTabs, loanPick, stage, making, health, guardian, vaultArt, borrowerSide, deskSide, top, caret, QUEST }
