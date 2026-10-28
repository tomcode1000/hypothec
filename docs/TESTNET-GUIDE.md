# Try Hypothec on testnet

Borrow test dollars against shielded ZEC, repay, get your ZEC back, then lend.
Test coins only, no real money.

**Site:** [hypothec.onrender.com](https://hypothec.onrender.com) (the first visit can take about 30 seconds while the site wakes up)

---

## 1. Create your wallets

**EVM wallet** (receives and repays the dollars)

- **MetaMask (recommended):** [metamask.io/download](https://metamask.io/download/) → install the browser extension → **Create a new wallet** → save your recovery phrase → done
- Also works: [Rabby](https://rabby.io/) or [Coinbase Wallet](https://www.coinbase.com/wallet)

**Zcash testnet wallet** (holds the ZEC you lock)

**Zkool** ([download](https://github.com/hhanh00/zkool2), [docs](https://hhanh00.github.io/zkool2/)). Switch to testnet **before** creating any account: Zkool opens on mainnet, and an account made there won't work here.

1. Install and open Zkool → **don't create an account yet**
2. **Settings** → folder icon (**Open Database Manager**) → close and reopen Zkool
3. Database Manager → **Create a new database** → give it a name containing `testnet` (e.g. `testnet`) → open it
4. **Settings** → **Server** → tap the list button → choose `https://testnet.zec.rocks`
5. Now create your account: **New account** → back up the seed phrase → copy your shielded address (starts with `utest1`)

If your address starts with `u1` instead, you're on mainnet: go back to step 2. An account you already made on mainnet does no harm. It stays in its own database, and the testnet database starts empty.

---

## 2. Get test coins

| Coin | Steps |
|---|---|
| **Test ETH** (fees) | Site → **Connect wallet** → approve the Robinhood Chain testnet switch → **Markets** → **get test ETH** → paste your MetaMask address → request |
| **tUSDC** (test dollars) | **Markets** → **mint 20 test tUSDC** → confirm in MetaMask |
| **TAZ** (test ZEC) | [Valar testnet faucet](https://faucet.testnet.valargroup.dev/) → paste your `utest1` address → request (0.125 TAZ a day, enough for many loans) |

---

## 3. Borrow

1. **Markets** → pick a desk → **Borrow**
2. Type an amount (e.g. **2**) → check the term sheet (ZEC to lock, what you repay, due date) → **Request** → sign
3. **Portfolio → Borrowing** → the desk answers in about 15 seconds
4. **Your ZEC comes back to** → paste your Zkool `utest1` address → **Accept and sign**
5. The vault is made → the lock screen shows a QR code → scan it with Zkool → send
6. Wait for **10 confirmations** (the ring counts them) → both guardians confirm → **tUSDC arrives in MetaMask**

**While you wait:** **Guardians** → pick your loan in **Loan** → see every check and signature.

---

## 4. Repay

**Portfolio → Borrowing** → **Repay** → approve tUSDC → confirm → the guardians sign the release → **your ZEC returns to Zkool**

---

## 5. Borrow privately

Same as section 3, with **Private** switched on in the ticket.

- One signature creates a one-time key → **your wallet never appears on the loan chain**
- Gas is paid by the relayer → **you need no ETH for the loan itself**
- The dollars land in your **private balance** → **Portfolio** → **Open private balance** → **Withdraw** to any address, or repay from it

---

## 6. Lend

You can't borrow from your own desk → use **two MetaMask accounts** (MetaMask → account menu → **Add account**).

**Account 1 (lender)**
1. **Markets** → **Lend** (or **Portfolio → Lending → Post an order**)
2. Fill in: name → **Lend up to** (e.g. 5) → rate and term (choose *minutes* to test a due date) → LTV levels (e.g. 50 / 65 / 75) → paste a `utest1` address for liquidation shares → pick the two guardians → **Post an order** → sign

**Account 2 (borrower)**
3. **Markets** → **Borrow** on your desk → **Request**

**Account 1**
4. **Portfolio → Lending → Requests** → **Approve** → sign

**Account 2**
5. Accept and lock (section 3, steps 4 to 6)

**Account 1**
6. **Fund** → approve tUSDC → confirm → you are repaid with interest when the borrower repays

**If the loan goes overdue or past liquidation:** **Liquidate** → the guardians check the price from 5 exchanges (at least 3 must agree) → your desk is paid and the rest goes back to the borrower.

---

## 7. Lend privately

**Post an order** → tick **Private desk** → **Portfolio → Open private balance → Add** tUSDC → your desk funds from it, and repayments return to it.

---

## If something is stuck

| You see | Do |
|---|---|
| *This wallet needs test ETH* | Section 2, test ETH |
| *Waiting for the desks* (your own desk) | Account 1 → **Approve** |
| *Waiting for ZEC* | Check that Zkool sent the payment, then give it a minute |
| A liquidation check shows *Not met* | Fewer than 3 exchanges answered; the guardians refuse to act on a thin price, by design |

**Test-only:** tUSDC and TAZ have no value, and both guardians and the demo desks are run by the Hypothec team. More: [DESIGN.md](DESIGN.md) · [DECISIONS.md](DECISIONS.md) · [GUARDIANS.txt](GUARDIANS.txt)
