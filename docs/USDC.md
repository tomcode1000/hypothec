# USDC side: verified facts (8 Oct 2026)

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
