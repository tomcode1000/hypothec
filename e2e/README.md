# The wired system

Every part together: the 3-of-4 Zcash vault (core/), the Base loan contract (usdc/), the
loanbook and the two referees (services/).

```
WSL (e2e/stack.sh)                         Windows (services/)
Zcash regtest chain (ths)                  loanbook :7900   signed shared record
zafe relay :48790                          referee A        rules engine, acts on its own
party host (control API :7899)  <------>  referee B        rules engine, acts on its own
  hypothec-party x4 per loan,              flow.ts          borrower app + lender desk actions
  ports from :7810; faucet, mine
                                                 |
                                           Base Sepolia: HypothecLoans + Circle test USDC
```

## Run on Zcash testnet

1. The test wallet (kept between runs; fund it at https://faucet.testnet.valargroup.dev/
   with the address it prints, 0.125 TAZ a day):
   `wsl -d Ubuntu -- bash "/mnt/c/Users/Toleexxzy/OneDrive/Documents/coding projects/hypothec/e2e/testnet-wallet.sh"`
2. `wsl -d Ubuntu -- env NETWORK=test bash ".../hypothec/e2e/stack.sh"`
3. In `services/`, with `ZAFE_NETWORK=test` set for each: `npx ts-node src/serve.ts all --fresh`,
   then `npx ts-node src/flow.ts repay` (or `src/api.ts` for the screens).
   A lock waits for 10 confirmations before the referees accept it: tens of minutes.

## Run

1. Zcash side (WSL), leave it running; prints `STACK READY`:
   `wsl -d Ubuntu -- bash "/mnt/c/Users/Toleexxzy/OneDrive/Documents/coding projects/hypothec/e2e/stack.sh"`
2. Loanbook + referees (Windows, in `services/`), leave running:
   `npx ts-node src/serve.ts all --fresh`
3. One loan (in `services/`):
   `npx ts-node src/flow.ts repay|liquidate|topup|deadline|basket` (`topup`: margin call,
   the borrower adds ZEC, then repays; `deadline`: a 10-minute desk, the loan goes overdue
   and is liquidated on the due-date rule at the live price, about 15 minutes; `basket`:
   one borrow filled from two desks' orders, locked together, one piece repaid and
   released, the other liquidated when overdue, about 20 minutes)

4. Or use the screens instead of step 3 (in `services/`):
   `npx ts-node src/api.ts`, then open http://127.0.0.1:7910/markets.html (Markets, Portfolio,
   Guardians, Docs). The desk's price override drives the
   liquidation in the demo.

   Each screen signs with a browser wallet (MetaMask, Coinbase Wallet) on Base Sepolia:
   - Lend (`desk.html`): any wallet opens a desk there (docs/DECISIONS.md D14) and needs
     Base Sepolia USDC to lend. Or import the `lender` test key from
     `~/.hypothec/testnet-wallets.json` (TESTNET ONLY), which holds some.
   - The borrower can use any wallet with a little Base Sepolia ETH for fees, and
     0.15 USDC more than it borrows to repay the interest (faucet.circle.com). Or import
     the `borrower` test key.

5. Screen test without a browser wallet (in `services/`, with 1-2 running):
   `HYPOTHEC_DESK_AGENTS=0 npx ts-node src/api.ts` (the test answers as the desks itself), `npx ts-node test/signer.ts` (TEST ONLY: answers wallet
   requests with the test keys), then `node test/e2e-web.mjs repay` or `liquidate`.
   Also `topup`, `deadline` and `basket` (two desks, the second with the `lender2` test
   wallet). It opens the desks on Lend first, then clicks through every screen in headless
   Chrome and saves screenshots. Stop the
   signer afterwards: it signs for anything on this machine that asks.

Restart steps 1 and 2 before each scripted flow (each assumes a fresh loanbook). Stop serve.ts by
killing its node process (stopping its shell can leave node running and holding the
database). `stack.sh` stops the previous run's processes itself.

## What flow.ts does, and what it does not

It plays the borrower app and the lender desk only: offer, accept, key setup, fund, lock
(the regtest faucet stands in for the borrower's wallet), repay or the price-crash
override, propose and send spends. The referees decide everything on their own: confirm
the lock (which pays the borrower), approve a release only after Base says Repaid and only
to the borrower's signed address, approve a liquidation only when the price rule holds and
the surplus goes to the borrower in the same transaction, and record it on Base.

## Results, 8 Oct 2026

- `repay`: loan `0x27e7c1bb...f0b0`. Referees confirmed the lock (borrower paid 5 USDC),
  borrower repaid 5.15, referees approved the release ("repaid on Base"), 990,000 zat back
  to the borrower's registered address. FLOW REPAY: OK.
- `liquidate`: loan `0xe0657afe...7da0`. Price override $600, referees computed LTV 85.83%
  >= 75% and approved one transaction: 875,500 zat to the lender (5.15 / 600 x 1.02),
  109,500 zat surplus to the borrower, fee 15,000. Both recorded it on Base: Liquidated.
  FLOW LIQUIDATE: OK.
- Live price feed (no override): Bitfinex $1,130.84, Bitstamp $1,139.57, Gemini $1,138.69,
  median $1,138.69 (1-hour averages). Coinbase, Kraken and Binance APIs did not resolve
  from this machine.
- Tests: `services/` 9 rule and loanbook tests; `usdc/` 9 contract tests; `core/e2e`.
