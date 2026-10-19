import { join } from 'node:path'

/**
 * The site's shared chrome: icons, mark, page shells. build.mjs writes the pages.
 *
 * Laid out the way the Quorum site is.
 *
 * Built the way the Quorum site is built: one nav, one icon set, one stylesheet and
 * one script shared by every page, held here so the pages cannot drift apart.
 * Output is plain static HTML in dist/, served by services/src/api.ts. No runtime
 * framework, nothing to hydrate: app.js fills `data-app` keys from /api/state and
 * shows the panel that matches the loan's step.
 *
 * Every figure on a page is rendered from the system or rendered as a dash. Nothing
 * here types a balance, a price or a count into the markup.
 */

const OUT = join(import.meta.dirname, 'dist')

/* ------------------------------------------------------------------ icons -- */

/*
  Quorum's icon set (18px grid, 1.5 stroke, round caps), the glyphs this product
  uses, plus four drawn to the same grid: vault, coin, keyhole and guard.
*/
const I = {
  shield: '<path d="M9 1.8 3.4 4.2v4.3c0 3.4 2.3 6.5 5.6 7.7 3.3-1.2 5.6-4.3 5.6-7.7V4.2L9 1.8Z"/>',
  check: '<path d="m3.6 9.4 3.4 3.4 7.4-7.4"/>',
  x: '<path d="M5 5l8 8M13 5l-8 8"/>',
  arrow: '<path d="M3.4 9h11.2M10.2 4.6 14.6 9l-4.4 4.4"/>',
  arrowLeft: '<path d="M14.6 9H3.4M7.8 4.6 3.4 9l4.4 4.4"/>',
  lock: '<rect x="3.6" y="7.8" width="10.8" height="7.4" rx="2"/><path d="M6 7.8V5.6a3 3 0 0 1 6 0v2.2"/>',
  key: '<circle cx="6" cy="10.4" r="3.4"/><path d="m8.5 8 6-6M12.4 4.1l1.7 1.7M10.9 5.6l1.7 1.7"/>',
  eye: '<path d="M1.8 9S4.6 3.8 9 3.8 16.2 9 16.2 9 13.4 14.2 9 14.2 1.8 9 1.8 9Z"/><circle cx="9" cy="9" r="2.4"/>',
  clock: '<circle cx="9" cy="9" r="7"/><path d="M9 4.8V9l2.8 1.7"/>',
  activity: '<path d="M1.8 9h3.2l2-5.4 4 11L13 9h3.2"/>',
  dollar: '<path d="M9 2v14M12 5.2c-.6-1-1.7-1.5-3-1.5-1.8 0-3 1-3 2.4 0 3.3 6.3 1.7 6.3 5 0 1.5-1.4 2.5-3.3 2.5-1.5 0-2.7-.6-3.3-1.7"/>',
  bolt: '<path d="M9.8 1.8 3.6 10.2h4.3l-.7 6 6.2-8.4H9.1l.7-6Z"/>',
  receipt: '<path d="M4 1.8h10v14.4l-2-1.4-1.6 1.4L9 14.8l-1.4 1.4L6 14.8l-2 1.4V1.8Z"/><path d="M6.6 6h4.8M6.6 9.2h4.8"/>',
  list: '<path d="M6.4 4.8h9M6.4 9h9M6.4 13.2h9"/><circle cx="3.2" cy="4.8" r=".9" fill="currentColor" stroke="none"/><circle cx="3.2" cy="9" r=".9" fill="currentColor" stroke="none"/><circle cx="3.2" cy="13.2" r=".9" fill="currentColor" stroke="none"/>',
  gauge: '<path d="M2.4 13.4a7 7 0 1 1 13.2 0"/><path d="m9 9.6 3-3"/>',
  warn: '<path d="M9 2.4 16.2 15H1.8L9 2.4Z"/><path d="M9 7.2v3.2"/><circle cx="9" cy="12.6" r=".8" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="9" cy="9" r="3.4"/><path d="M9 1.6v1.8M9 14.6v1.8M3.8 3.8l1.3 1.3M12.9 12.9l1.3 1.3M1.6 9h1.8M14.6 9h1.8M3.8 14.2l1.3-1.3M12.9 5.1l1.3-1.3"/>',
  out: '<path d="M11.4 2.6h4v4M15.4 2.6 8.6 9.4"/><path d="M13.6 10.6v3.8a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 14.4V6a1.6 1.6 0 0 1 1.6-1.6h3.8"/>',
  users: '<circle cx="9" cy="6.2" r="3.1"/><path d="M3.2 15.2c.6-2.8 2.9-4.5 5.8-4.5s5.2 1.7 5.8 4.5"/>',
  bank: '<path d="M9 1.9 16 5.6H2L9 1.9Z"/><path d="M4 7.6v5.2M7.4 7.6v5.2M10.6 7.6v5.2M14 7.6v5.2M2.2 15.4h13.6"/>',
  sliders: '<path d="M2.6 5.4h12.8M2.6 12.6h12.8"/><circle cx="6.6" cy="5.4" r="1.9"/><circle cx="11.4" cy="12.6" r="1.9"/>',
  refresh: '<path d="M15.2 7.6A6.4 6.4 0 0 0 4.2 4.6L2.4 6.4"/><path d="M2.8 10.4a6.4 6.4 0 0 0 11 3l1.8-1.8"/><path d="M2.4 2.8v3.6H6M15.6 15.2v-3.6H12"/>',
  play: '<path d="M7 5.2 12.6 9 7 12.8V5.2Z"/>',
  /* Drawn for this product, same grid and stroke. */
  vault: '<rect x="2.2" y="2.6" width="13.6" height="12.4" rx="2.4"/><circle cx="9" cy="8.2" r="2.1"/><path d="M8.2 10.1 7.6 12h2.8l-.6-1.9M5 15v1.4M13 15v1.4"/>',
  coin: '<circle cx="9" cy="9" r="7"/><path d="M6.4 6.4h5.2L6.4 11.6h5.2M9 4.6v1.8M9 11.6v1.8"/>',
  keyhole: '<circle cx="9" cy="7.2" r="2.6"/><path d="M8 9.4 7.2 14h3.6L10 9.4"/>',
  guard: '<path d="M9 1.8 3.4 4.2v4.3c0 3.4 2.3 6.5 5.6 7.7 3.3-1.2 5.6-4.3 5.6-7.7V4.2L9 1.8Z"/><path d="m6.4 8.8 1.9 1.9 3.4-3.6"/>',
}

/**
 * One icon, stroked. The `i` class is the size floor: an inline SVG with a viewBox
 * and no size expands to fill its parent (the Quorum docs header learnt this).
 */
const ic = (name) =>
  `<svg class="i" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] ?? I.shield}</svg>`

/* ------------------------------------------------------------------- mark -- */

/*
  The Hypothec mark, built the way Quorum's is: one rounded square cut by a mask.
  It keeps Quorum's two cuts, the clipped top-left corner and the diagonal slot
  that frees the bottom-right block, so the two marks read as one maker's. Where
  Quorum's square is a hollow ring, this one is a solid vault door with a keyhole
  through it; the freed corner block is the fourth key.
*/
const MARK_SHAPES = (id) => `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40"><rect width="40" height="40" fill="#fff"/><polygon points="-2,-2 15.4,-2 -2,15.4" fill="#000"/><line x1="25" y1="41" x2="41" y2="25" stroke="#000" stroke-width="4.4" stroke-linecap="round"/><circle cx="19.2" cy="16.6" r="4.6" fill="#000"/><path d="M17 19.4h4.4l1.5 8.4h-7.4Z" fill="#000"/></mask></defs>`
const MARK_BODY = `<rect x="2" y="2" width="36" height="36" rx="11"/>`

/*
  Each mark carries its own mask id. A page can render two rails and hide one (the
  log page does), and a mask defined inside a hidden element does not render, so a
  shared id left the visible mark without its keyhole.
*/
let markN = 0
const MARK = {
  toString() {
    const id = `hm${++markN}`
    return `<svg viewBox="0 0 40 40" aria-hidden="true">${MARK_SHAPES(id)}<g mask="url(#${id})" fill="currentColor">${MARK_BODY}</g></svg>`
  },
}

/* Favicon: the mark in Zcash yellow on Zcash black. */
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">${MARK_SHAPES('f')}<rect width="40" height="40" rx="9" fill="#231F20"/><g transform="translate(4 4) scale(.8)"><g mask="url(#f)" fill="#F4B728">${MARK_BODY}</g></g></svg>`

const caret = `<svg class="caret" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/* ------------------------------------------------------------------ pages -- */

const head = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>${title} · Hypothec</title>
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<!-- Not render-blocking: the page shows at once in the fallback face and swaps in Inter. -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap" media="print" onload="this.media='all'"/>
<link rel="stylesheet" href="assets/hypothec.css"/>
<script>
  /* The stored theme and rail width, applied before first paint (as on Quorum). */
  try {
    if (localStorage.getItem('hypothec-theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
    if (localStorage.getItem('hypothec-rail') === 'collapsed') document.documentElement.setAttribute('data-rail', 'collapsed')
  } catch (e) {}
</script>
</head>`

/** The landing surface: header, content, footer. It never carries the app's rail. */
const page = ({ title, body }) => `${head(title)}
<body class="site">
${body}
<script src="assets/app.js"></script>
</body>
</html>`

/** A product surface: the rail plus the page. */
/*
  A product surface: the rail, then the page under a top bar that carries the wallet
  button in its right-hand corner (where lending apps put it) and names both networks.
*/
const appPage = ({ title, side, main, view }) => `${head(title)}
<body data-view="${view}" class="is-loading">
<a class="skip" href="#main">Skip to the page</a>
<div class="ap">
${side}
<main class="ap-main" id="main">
${main}
</main>
</div>
<div class="toast" data-app="toast" role="status" aria-live="polite" hidden></div>
<script src="assets/wallet.js"></script>
<script src="assets/app.js"></script>
</body>
</html>`

export { I, ic, MARK, FAVICON, caret, page, appPage, OUT }
