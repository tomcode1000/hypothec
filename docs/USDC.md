# The dollar side: verified facts (8 Oct 2026; Robinhood Chain added 21 Oct)

| Item | Value | Source |
|---|---|---|
| Network | Base Sepolia (testnet) | |
| Chain ID | 84532 | docs.base.org, connecting-to-base |
| Public RPC | https://sepolia.base.org | docs.base.org |
| Explorer | https://sepolia.basescan.org | docs.base.org |
| USDC contract | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | developers.circle.com, usdc-contract-addresses |
| USDC decimals | 6 (standard USDC; confirm on-chain with `decimals()` before use) | |
| Test USDC faucet | https://faucet.circle.com: 20 USDC per 2 hours, per address, per chain | faucet.circle.com |
| Gas | Base Sepolia ETH, from a Base Sepolia faucet (lender and borrower wallets each need some) | |

Consequence: real test USDC comes 20 at a time, so a $5,000 demo loan cannot be paid in
real test USDC. Decision needed: small real amounts, or a mock token for big numbers.

Base notes that its transaction submission endpoint and its RPC endpoint have separate
roles; the public endpoints are for testing, not production.

## Robinhood Chain testnet (added 21 Oct 2026, D24)

| Item | Value | Source |
|---|---|---|
| Chain ID | 46630 | usdc/deployments/robinhood-testnet.json (the chain our contracts are on) |
| Explorer | https://explorer.testnet.chain.robinhood.com | |
| Stablecoin | Test USDC (tUSDC) `0xdc821cdb076a1b2c5d1ada9a242f33b97d34f0a5`, 6 decimals, permit, anyone can mint | usdc/contracts/test/TestUSDC.sol |
| Why not Paxos USDG | its test faucet is closed in the user's country | |
| Gas | Robinhood Chain testnet ETH | |

The loan contract and the shielded dollar vault on each chain: `usdc/deployments/*.json`.
