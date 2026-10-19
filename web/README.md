# web: the borrower app and the lending desk

Built the way the Quorum site is: static HTML from `.mjs` files, no framework.

| File | What it holds |
|---|---|
| `chrome.mjs` | icons (Quorum's set + vault, coin, keyhole, guard), the mark, page shells |
| `shell.mjs` | shared components: card, pill, button, terms sheet, notice, progress line, health bar, guardian, vault facts |
| `pages.mjs` | `index.html` (landing, no rail), `markets.html` (the order book; Borrow and Lend dialogs on each row), `loan.html` and `desk.html` (Portfolio: Borrowing and Lending tabs), `log.html` (Guardians: checks, operators, signed log), `docs.html` (everything that explains the product) |
| `art.mjs` | the vault drawn as contour lines, the one picture the site uses (landing hero, page headings) |
| `assets/hypothec.css` | the whole design system: institutional: hairline rules, tabular figures, Zcash yellow #F4B728 for the main action only, black #231F20 ink |
| `assets/app.js` | reads `/api/state`, works out the loan's step, fills `data-app` keys, posts `data-act` buttons |
| `wallet/wallet.mjs` | the browser wallet: connect, switch to Base Sepolia, contract calls, signing, the vault QR; bundled with viem into `dist/assets/wallet.js` |
| `build.mjs` | writes `dist/` (`npm install` once, for esbuild) |

```bash
node build.mjs     # then services/src/api.ts serves dist/ on http://127.0.0.1:7910
```

Rules carried over from Quorum: every figure comes from the system or shows a dash; one
accent colour, for actions only; every icon has a sizing class; the landing page never
carries the app's rail; each mark has its own mask id (a shared one broke the logo on a
page that renders two rails).

Checked on 8 Oct 2026 at 1440px and 390px: no element past the page edge on any page,
with a Chrome DevTools script; screenshots of every step of a live liquidation.

Organised as Quorum's site is (16 Oct, docs/DECISIONS.md D17): each app screen carries only its work, the explaining lives in Docs.

Layout ideas taken from lending apps (Kamino, 9 Oct): the page heading with summary
chips on the right, Borrow as a markets table with the action at the end of the row,
and a borrow dialog that leads to the loan's own page. Not taken: their dark theme and
feature banners.

Wallets (9 Oct): the desk and the borrower sign their own Base actions in the wallet they
connect; nothing in the page holds a key. The canonical text of a signed loanbook entry
in `wallet.mjs` must match `services/src/sign.ts` byte for byte. Tested through every
screen with `services/test/e2e-web.mjs` (repay and liquidate both pass).
