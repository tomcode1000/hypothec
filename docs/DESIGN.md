# Hypothec: design

How a loan works, the numbers behind it, who can do what, what each party sees, and how
the guardians should run in production. Decisions are dated in [DECISIONS.md](DECISIONS.md);
the guardians' exact checks are in [GUARDIANS.txt](GUARDIANS.txt).

## 1. The problem

A ZEC holder who wants dollars without selling has two options today: hand the coins to
a custodial lender, or move them into a public DeFi market. The first gives up control;
the second gives up the privacy that made them hold ZEC. Hypothec keeps both: the
collateral stays in Zcash's shielded pool, in a vault no single party can move.

## 2. The parts

| Part | Where | What it is |
|---|---|---|
| Vault | Zcash (shielded, Ironwood) | One FROST threshold key per loan, 3 of 4 holders: borrower, desk, guardian A, guardian B |
| Loan contract | Base (`usdc/contracts/HypothecLoans.sol`) | Terms, payout, repayment, deadline, guardian fees. Nothing about the collateral |
| Loanbook | `services/src/loanbook.ts` | The shared record: desks and their orders, the operator list, signed offers and acceptances, the signed log. Holds no keys |
| Guardians | `services/src/referee.ts`, `policy.ts` | Rules engines, each holding one key share per loan |
| Party services | `core/` (`hypothec-party`) | Each party's key share, one service per loan and role |
| Relay | zafe | Carries encrypted messages between the parties; holds no keys, cannot spend |

## 3. A loan, step by step

1. **Order.** A desk publishes signed terms: rate, term, start LTV, margin-call LTV,
   liquidation LTV, price buffer, how much it lends, its Zcash address for liquidation
   shares, and its two guardians.
2. **Request.** The borrower picks an amount; it fills from the chosen desk first, then
   other orders (cheapest rate first). Each piece is its own loan.
3. **Offer and acceptance.** Each desk posts its offer on Base and signs it into the
   loanbook. The borrower accepts on Base (agreeing to the two guardians) and signs a
   fresh Zcash payout address into each loan.
4. **Vault.** The four parties run a FROST key generation through the relay. All four
   check one safety number; each keeps only its own share.
5. **Funding.** The desk moves the principal and both guardians' fees into the contract.
6. **Lock.** The borrower pays every vault in one shielded transaction (a ZIP 321
   request with one output per vault). Each guardian, reading the vault through its
   viewing key, confirms on Base once the full amount has 10 confirmations. When both
   have, the contract pays the borrower the principal and each guardian its fee.
7. **Repay.** One USDC permit signature and one transaction repay every loan of the
   borrow (`repayAllWithPermit`), each lender paid what is left on its own loan. Both
   guardians then sign each vault's release, only to the address the borrower signed.
8. **Or liquidate.** Past the liquidation line or the due date, the desk proposes one
   Zcash transaction paying itself what it is owed and the rest to the borrower. Both
   guardians check it and sign; they record the liquidation on Base.

## 4. The numbers

Units: USDC in micro-units (6 decimals), ZEC in zatoshi (8 decimals), prices in
micro-dollars per ZEC.

- **Owed** = principal × (1 + APR × term in seconds / one year).
- **Collateral** = principal / (start LTV × price), at the price the guardians use.
- **LTV** = what is still owed / (vault balance × price).
- **Liquidation allowed** when LTV ≥ the desk's liquidation LTV, or the contract says the
  loan is overdue.
- **The desk's share at liquidation** = owed / price × (1 + price buffer), rounded up: the
  most the guardians allow. The desk asks 0.1% under it, so the proposal stays valid while
  the one-hour average moves between proposing and checking.
- **Surplus** = vault − desk's share − network fee; it goes to the borrower in the same
  transaction. A guardian refuses any liquidation without it.
- **A desk's terms must leave room for a surplus:** liquidation LTV × (1 + buffer) < 95%.
- **Price** = for each of five exchanges, the one-hour average of one-minute candles (only
  exchanges with 10 or more candles count); the median of those, if at least 3 count.
  Without three, nothing that needs a price is signed.
- **Guardian fee** = 0.10% of the principal per guardian, paid by the desk.

## 5. Who can move the collateral

Any 3 of the 4 keys:

| Together | Can | Used for |
|---|---|---|
| Borrower + both guardians | release | after the contract says Repaid |
| Desk + both guardians | liquidate | past the line or the due date |
| Borrower + desk + one guardian | close by agreement | when a guardian is offline |
| Both guardians alone | nothing | 2 of 4 |
| Desk + one guardian | nothing | 2 of 4 |

Taking collateral against the rules needs both independent guardians **and** one of the
two parties to collude. That residual trust is stated openly; the production design
below is about shrinking it.

**Availability.** One guardian offline: the loan can still close (borrower, desk, other
guardian). Both offline: the collateral is safe but frozen until one returns. Replacing a
guardian that is gone for good (re-sharing its key share to a new operator) is not built.

## 6. Who sees what

| Party | Sees | Never sees |
|---|---|---|
| Borrower | everything about its own loans | |
| Desk | the collateral in its own loan's vault (viewing key), where the USDC goes, the payout address | the borrower's Zcash wallet, its balance or history, the borrower's loans with other desks |
| Guardians | what the desk sees, and the signed terms they enforce | the borrower's Zcash wallet |
| Zcash, publicly | shielded transactions | owner, amount, that a loan exists |
| Base, publicly | each loan contract: USDC amounts, payout address, status | any Zcash detail |

A fresh payout address per loan keeps the desk from linking it to anything else. Each loan
also gets fresh party identities, so two loans cannot be linked through their key holders.

## 7. The guardians in production

**What a guardian is.** Code, not a person: a rules engine that holds one key share per
loan and signs only when the published rules pass, logging every decision, signed, with
its evidence. Nobody at an operator reads transactions or clicks approve.

**Who runs them.** Independent operator companies from a published list. A desk names two
that are independent of each other and of the desk; the borrower sees them before
accepting and can decline. **Hypothec may run at most one**: if one company ran both,
it and a desk together would hold 3 of 4 keys.

**The operator list (built).** A guardian registers itself in the loanbook, signed with its
key: name, operator, fee and a fingerprint (sha256) of the rules code it runs. It sends a
signed heartbeat every 30 seconds; the site shows it online while heartbeats are recent,
and desks can pick only online guardians.

**Pay (built).** Each guardian earns 0.10% of the principal, paid by the loan contract when
it confirms the lock, from the desk's funding. The fee is the same whether the loan is
repaid or liquidated: a guardian must never earn more by liquidating.

**Next, to remove the operator's discretion:**

1. **Decide only from public on-chain facts.** Repaid and overdue already come from the
   Base contract. The price should come from an on-chain oracle on Base instead of each
   guardian reading exchanges, so a guardian has no judgement left to exercise.
2. **Attested code.** Run the guardian in a trusted execution environment whose
   measurement matches the published, reproducible build: the operator can host it but
   cannot change what it signs.
3. **A bond.** Each operator posts a bond; its signed log is the evidence. Signing against
   the published rules (for example a release before Repaid) loses the bond and its place
   on the list.
4. **Share repair.** Re-share a lost guardian's key share to a new operator, so two
   guardians going away for good cannot freeze collateral.

## 8. Status

A test build on Zcash testnet (or a local chain) and Base Sepolia, with test coins. Not
audited. The vault code (zafe) is pre-release and runs on pre-release Zcash libraries for
NU7. In the demo the Hypothec team runs both guardians, on the same host as the website,
and says so on the Guardians page.
