# Hypothec

**Private USDC loans against shielded ZEC.** The collateral never leaves Zcash's shielded
pool, and no single party can move it: not the borrower, not the lender, not Hypothec.

Built for the ZECATHON, Private Markets track.

- **Live demo:** the hosted site (Zcash testnet + Base Sepolia, test coins only). The link
  is in the repository's About panel once deployed.
- **How it works, the maths, the trust model and the production design:** [docs/DESIGN.md](docs/DESIGN.md)
- **Every design decision, dated:** [docs/DECISIONS.md](docs/DECISIONS.md)

## What it does

1. **Lenders post orders.** Any wallet opens a desk: a rate, a term, loan-to-value
   levels, how much it lends, and the two guardians it works with.
2. **Borrowers fill a borrow from one desk or several.** Each piece becomes its own loan
   with its own shielded vault on Zcash.
3. **Each vault is one FROST threshold key with four holders:** the borrower, the desk
   and two guardians. Any **3 of the 4** can sign. The whole key never exists anywhere.
4. **The borrower locks ZEC** (one shielded payment to every vault). When both guardians
   see it confirmed, the loan contract on Base pays out the USDC.
5. **Repaying** the whole borrow is one permit signature and one transaction; the ZEC
   then comes back on its own.
6. **If ZEC falls past a desk's liquidation line, or the due date passes unpaid**, one
   Zcash transaction pays the desk what it is owed and returns the rest to the borrower.
7. **Guardians** are software run by independent operators. They sign only what the
   published rules allow, and log every decision with its evidence.

Nothing on Zcash shows an owner, an amount, or that a loan exists. The Base contract
stores nothing about the collateral.

## Repository

| Folder | What is there |
|---|---|
| `core/` | `hypothec-party`: one party's FROST key share of a vault, as an HTTP service (Rust, on [zafe](https://github.com/zafe-cash/zafe)) |
| `usdc/` | `HypothecLoans.sol`, the loan contract on Base Sepolia, and its tests |
| `services/` | the loanbook, the **guardians' rules engine**, the price feed, desk agents, the web API |
| `web/` | the website: Markets, Portfolio, Guardians, Docs |
| `e2e/` | scripts that bring the whole system up (local chain or testnet) |
| `deploy/` | the container for the hosted demo |
| `vendor/zafe` | zafe (MIT OR Apache-2.0), as a git submodule |
| `docs/` | design, decisions, the spike, the guardians in detail |

## What you need

| Tool | Version | For |
|---|---|---|
| Linux, or Windows with WSL 2 (Ubuntu 24.04) | | the Rust services and the local chain |
| Rust | 1.88 or later | `core/` and zafe |
| Node.js | 22 or later | services, website, contract |
| Python | 3.10 or later | the control API (`e2e/control.py`) |
| Docker | | the local Zcash chain only |
| [ths](https://github.com/zcashlabs/thus-spoke-zakura) | 0.3.0 | the local Zcash chain only |
| Chrome | | the screen tests only |

Plus, on Base Sepolia, test wallets with a little ETH for fees and test USDC
([faucet.circle.com](https://faucet.circle.com)). Their keys live in
`~/.hypothec/testnet-wallets.json`, outside the repository
(`usdc/scripts/new-wallets.ts` creates them).

## Run it locally (local Zcash chain)

```bash
git clone --recurse-submodules https://github.com/tomcode1000/hypothec
cd hypothec

# 1. Build the Rust services (about 15 minutes the first time)
cargo build -p hypothec-core
(cd vendor/zafe && cargo build -p zafe-relay)

# 2. Install and build the rest
(cd usdc && npm ci && npx hardhat compile)
(cd web && npm ci && node build.mjs)
(cd services && npm ci)

# 3. The Zcash side: a local chain, the relay, the party host (leave running)
e2e/stack.sh                                  # prints STACK READY

# 4. The loanbook and both guardians (leave running)
cd services && npx ts-node src/serve.ts all --fresh

# 5. The website with the desk agents
npx ts-node src/api.ts                        # http://127.0.0.1:7910
```

`e2e/stack.sh` expects the binaries under `~/hypothec-build` as in [e2e/README.md](e2e/README.md);
set `CARGO_TARGET_DIR` and `ZAFE_DIR` to match your build.

## Run it on Zcash testnet

```bash
e2e/testnet-wallet.sh          # a 2-of-2 test wallet that pays the locks; prints its address
# fund that address at https://faucet.testnet.valargroup.dev/ (0.125 TAZ a day)
NETWORK=test e2e/stack.sh
cd services
ZAFE_NETWORK=test npx ts-node src/serve.ts all --fresh
ZAFE_NETWORK=test npx ts-node src/api.ts
```

A lock waits for 10 confirmations before the guardians accept it, which on testnet is
tens of minutes.

## The hosted demo

One container (`deploy/Dockerfile`) runs the testnet system: the relay, the party host,
the test wallet, the loanbook and both guardians, and the website with the desk agents.
Every push to `main` runs the tests, builds the image and deploys it
(`.github/workflows/deploy.yml`, `render.yaml`).

The container runs two loan chains, Base Sepolia (USDC) and Robinhood Chain testnet (Test
USDC anyone can mint), each with its own loanbook, guardians and desks; the switch beside the
wallet picks one (`HYPOTHEC_SECOND_CHAIN=none` turns the second off).

Hosting the guardians next to the website is a **demo** arrangement. In production each
guardian runs at its own operator (see below).

Secrets are set on the host, never in the repository: `TESTNET_WALLETS_JSON` (test keys)
and `HYPOTHEC_DEMO_TOKEN` (unlocks the demo price controls, `?demo=<token>` on the
Lending tab; without it they are off, so no visitor can crash the price).

## Run a guardian (operators)

A guardian is the rules engine in `services/src/referee.ts`, holding one key share per
loan. To run one:

1. Create a Base key for it, with a little Base Sepolia ETH for its confirmations.
2. Start it: `npx ts-node src/serve.ts refereeA` (or `refereeB`), pointed at the loanbook
   (`HYPOTHEC_LOANBOOK`) and its own party host for its key shares (`HYPOTHEC_PARTY_HOST`). Set `HYPOTHEC_OPERATOR` to
   your organisation's name.
3. It registers itself on the operator list, signed with its key, with a fingerprint of
   the rules code it runs, and sends a signed heartbeat every 30 seconds. Desks can pick
   it only while it is online.
4. It earns 0.10% of each loan's principal, paid by the loan contract when it confirms the
   lock, the same whether the loan is later repaid or liquidated.

What it signs, what it refuses and why: [docs/GUARDIANS.txt](docs/GUARDIANS.txt).

## Tests

```bash
(cd usdc && npx hardhat test)        # the loan contract: 17 tests
(cd services && npm test)            # rules, price feed, loanbook, desks, operator list: 17 tests
core/e2e/run.sh                      # the 3-of-4 vault and a liquidation on a local chain
```

End to end: `services/src/flow.ts` (repay, liquidate, topup, deadline, basket) and the
screen test `services/test/e2e-web.mjs`; see [e2e/README.md](e2e/README.md).

## Status and limits

- **Test build.** Zcash testnet (or a local chain) and Base Sepolia; test coins only.
  Not audited. The threshold-signing library underneath (zafe, on pre-release Zcash
  libraries for NU7) is pre-release software.
- **Both guardians in the demo are run by the Hypothec team**, on the same host as the
  website. In production they are independent operators; Hypothec may run at most one.
- **If both guardians are offline, collateral is safe but frozen** (the borrower and the
  desk hold only 2 of the 4 keys). One guardian offline is fine: the borrower, the desk
  and the other guardian can close the loan. Replacing a lost guardian (share repair)
  is not built.
- The price is read off-chain by each guardian (median of at least 3 of 5 exchanges).
  Moving it on-chain is the next step: [docs/DESIGN.md](docs/DESIGN.md).

## Licence

MIT OR Apache-2.0, like zafe, which it builds on (Anmol Bansal and Zafe contributors).
