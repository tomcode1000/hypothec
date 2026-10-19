# usdc: the Hypothec loan contract (Base Sepolia)

`contracts/HypothecLoans.sol` holds the public half of a loan: terms, payout, repayment,
deadline. Nothing about the ZEC collateral. See docs/DECISIONS.md D5 and docs/USDC.md.

Lifecycle: `offer` (lender) -> `accept` (borrower: agrees to the two referees, gives the
payout address) -> `fund` (lender) -> `confirmLock` x2 (referees) => principal to the
borrower -> `repay` (forwarded to the lender) => `Repaid` event, or `confirmLiquidation` x2.
`cancel` before funding, or after an unconfirmed lock deadline (refund to the lender).
`isOverdue` signals the deadline rule.

## Run (Windows, Node 22)

```bash
npm install
npx hardhat test        # 14 tests on Hardhat's local chain, with a stand-in USDC (with permit)
```

Versions are pinned in package.json (Hardhat 2.29.1, viem 2.57.4, TypeScript 5.9.3,
Solidity 0.8.24).

## Live on Base Sepolia (16 Oct 2026)

- Contract: `0x63dd4a31a6b559f3a893f0c474a145b6fdff817a`, with `repayAll` and
  `repayAllWithPermit` (docs/DECISIONS.md D20). Deployed with `npx ts-node scripts/deploy.ts`
  (test lender wallet); `deployments/base-sepolia.json` keeps the address it replaced.

## First deployment (8 Oct 2026)

- Contract: `0xdc821cdb076a1b2c5d1ada9a242f33b97d34f0a5`
  (https://sepolia.basescan.org/address/0xdc821cdb076a1b2c5d1ada9a242f33b97d34f0a5),
  saved in `deployments/base-sepolia.json`. USDC: Circle's `0x036C...CF7e`.
- Loan `0x1f0f1f33...ae426`: offered, accepted, funded, lock confirmed by both referees,
  borrower paid 5 USDC, repaid 5.15, status Repaid (finished with the resume mode).
- Loan `0x32c09b1c...07793`: the whole lifecycle in one run of `scripts/live-loan.ts`.

```bash
npx ts-node scripts/live-loan.ts            # one full loan (deploys the contract if needed)
npx ts-node scripts/live-loan.ts <loan id>  # resume an Active loan at repayment
npx ts-node scripts/show-loan.ts <loan id>  # loan state + the four wallets' USDC
```

The public RPC (sepolia.base.org) is a pool of nodes that can lag a block: reads pinned
to a fresh block may get "block not found", simulations may see old state. The scripts
retry those and send with a fixed gas limit. Set `BASE_SEPOLIA_RPC` to use another
endpoint.

## Testnet wallets

`npx ts-node scripts/new-wallets.ts` created four TEST wallets (lender, borrower, refereeA,
refereeB). Keys: `~/.hypothec/testnet-wallets.json`, outside OneDrive and this folder.
Only the lender was funded from the faucets (0.005 ETH, 20 USDC); `live-loan.ts` passes
gas to the other three and 1 USDC to the borrower for interest.
