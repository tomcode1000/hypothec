# Try Hypothec on testnet

A step-by-step walkthrough of the hosted demo: borrow test dollars against shielded ZEC,
repay and get the ZEC back, then lend from your own desk. Everything runs on Zcash testnet
and Robinhood Chain testnet with test coins that have no value.

**Site:** [hypothec.onrender.com](https://hypothec.onrender.com)

| | |
|---|---|
| Time | about 10 minutes of clicking, plus about 30 minutes while Zcash confirms the lock |
| Cost | nothing: test ETH from a faucet, test dollars minted on the site |
| You need | a browser wallet (below). A Zcash wallet is optional |

The site is on a free plan and sleeps when nobody is using it. If the first visit is slow,
wait about 30 seconds and it wakes up.

---

## 1. Wallets

### A browser wallet for the dollars (required)

Any EIP-1193 browser wallet: **MetaMask**, **Coinbase Wallet** or **Rabby**. You use it to
sign the loan, receive the test dollars and repay. Use a fresh account or one with no real
funds on it. It's a testnet, but good practice.

You don't need to add Robinhood Chain testnet by hand. The first time you connect, the
site asks your wallet to add and switch to it:

| | |
|---|---|
| Network | Robinhood Chain Testnet |
| Chain ID | 46630 |
| RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com) |
| Gas token | ETH (test) |

### A Zcash wallet for the collateral (optional)

The ZEC collateral is paid into a shielded Zcash vault. You can do this two ways:

- **The demo test wallet (easiest).** The lock screen has a **Demo: pay from the test
  wallet** button that pays the vault from the demo's own testnet wallet. The **Use the test
  wallet's address** link sends the ZEC back to that same wallet when the loan closes.
- **Your own Zcash testnet wallet.** Any wallet that runs on Zcash testnet, is up to date
  with testnet's current upgrade, and can pay a unified address (`utest1…`) or scan a
  ZIP 321 payment QR code. Get test ZEC (TAZ) from the
  [Valar testnet faucet](https://faucet.testnet.valargroup.dev/) (0.125 TAZ a day). A loan
  of a few test dollars needs well under 0.01 TAZ.

---

## 2. Get test coins

1. Open the site and click **Connect wallet**. Approve the network switch.
2. On **Markets**, the line under the title reads *Testnet: get test ETH for fees, then
   mint 20 test tUSDC*.
3. Click **get test ETH**. It opens the Robinhood Chain faucet. Paste your wallet address
   and request test ETH. A small amount covers dozens of transactions.
4. Back on the site, click **mint 20 test tUSDC** and confirm in your wallet. You need
   tUSDC to repay the interest on a loan, and to lend.

Hypothec never sends you ETH or tokens from its own wallets. You get everything yourself,
so every action is signed by you.

---

## 3. Borrow

### Open the order ticket

1. On **Markets**, pick a desk in the order book (for example *Desk A*) and click
   **Borrow**.
2. Type an amount, e.g. **2** tUSDC. The ticket fills it from the cheapest desk first.
   A larger amount may split across several desks, and each piece becomes its own loan with
   its own vault. Limits: up to 15 tUSDC and 4 pieces per borrow, and no more than the
   desks have available.
3. Read the term sheet: the ZEC you lock, what you repay, the due date and the
   liquidation price.
4. Leave **Private** off for your first loan (private borrowing is section 5).
5. Click **Request** and sign in your wallet.

### Accept the offer

6. You land on **Portfolio**, under **Borrowing**. The demo desks answer automatically,
   usually within 15 seconds.
7. In **Your ZEC comes back to**, paste a fresh shielded address from your Zcash wallet,
   or click **Use the test wallet's address**. This address is signed into the loan: when
   the loan closes, the vault can only pay back to it.
8. Click **Accept and sign** and confirm in your wallet.

### Lock the ZEC

9. The site makes the vault. One FROST threshold key is split four ways (you, the desk and
   two guardians). The whole key never exists in one place. The desk then funds the loan
   contract.
10. The lock screen shows one payment request covering every vault, as a QR code plus
    address and amount. Either:
    - click **Demo: pay from the test wallet**, or
    - scan the QR code (or copy the details) and pay from your own Zcash testnet wallet.
11. Wait for **10 of 10 confirmations**. On testnet this takes about 30 minutes; the
    progress ring counts them. You can close the tab and come back.

### Get paid

12. Once the vault is confirmed, both guardians confirm the lock on Robinhood Chain and
    the loan contract pays the tUSDC to your wallet. The loan shows as **Running**.

**While you wait:** open **Guardians**. Pick your loan in the **Loan** menu to see each
check the guardians run before they sign (*It is the vault all four made*, *Any 3 of the 4
keys move it*, *The full collateral is in the vault*, and so on), with each decision
signed and timestamped.

---

## 4. Repay and get your ZEC back

1. **Portfolio → Borrowing**: click **Repay** on the loan, or **Repay all** for a
   multi-desk borrow. Approve the tUSDC and confirm. The interest for a short loan is a
   fraction of a cent.
2. The contract marks the loan repaid. Both guardians check it and sign the release. The
   ZEC can only go to the address you signed at step 7.
3. The ZEC arrives back in that Zcash wallet a few minutes later. If the loan shows **Get
   ZEC back**, click it to ask for the release yourself.

Check it on Zcash: the vault and the payment back are shielded, so an explorer shows a
transaction but no amount, sender or receiver.

---

## 5. Borrow privately

Same flow, with **Private** switched on in the order ticket.

- **One-time key.** Your wallet signs one message. From that signature the site derives a
  one-time key, and it is that key that takes the loan. Your wallet address never appears
  on the loan chain.
- **Gas.** A relayer sends the transactions, so the one-time key needs no ETH.
- **Payout.** The dollars land in your **private balance**, a shielded note in the
  Hypothec vault on Robinhood Chain, not in your wallet.
- **Private balance.** Open it on **Portfolio** with **Open private balance** (one
  signature). From there you can **Withdraw** to any address, or repay from it. Spending
  makes a zero-knowledge proof (Groth16) in your browser; it takes about 2 seconds.
- **Another browser.** Notes are backed up encrypted, so signing in elsewhere with the same
  wallet restores your private balance.

---

## 6. Lend

You can't borrow from your own desk. To try both sides, use **two wallet accounts**:
account 1 lends, account 2 borrows from it.

### Post an order (account 1)

1. On **Markets**, click **Lend** on any desk to copy its terms, or **Post an order** on
   **Portfolio → Lending**.
2. Fill in the order:

   | Field | Example | Meaning |
   |---|---|---|
   | Desk name | *My desk* | what borrowers see |
   | Lend up to | 5 | the most this order lends in total, in tUSDC |
   | Rate / Term | 10% APR, 10 minutes | the term unit can be days or minutes; minutes let you test a due date |
   | Start / Margin call / Liquidation | 50 / 65 / 75 % | loan-to-value levels |
   | Price buffer | 2 % | room for the price to move while a liquidation settles |
   | ZEC address for liquidation shares | **Use the test desk's** | where your share goes if a loan is liquidated |
   | Guardian A / B | the two listed | the two independent key holders on every loan |

3. The panel on the right shows what borrowers see and what the order earns at term.
4. Click **Post an order** and sign. Your desk appears in the order book on **Markets**.

### Answer a borrower (account 1)

5. Switch to account 2 and borrow from your desk (section 3, steps 1 to 5).
6. Switch back to account 1. In **Portfolio → Lending**, the request appears under
   **Requests**. Click **Approve** and sign. This offers the loan on your desk's terms.
7. Switch to account 2 and accept it (section 3, steps 7 and 8).
8. Back on account 1, once the vault is made, click **Fund**. Approve the tUSDC and
   confirm. The dollars wait in the loan contract.
9. Account 2 locks the ZEC (section 3, step 10). When the guardians confirm it, the
   contract pays the borrower.

### Get repaid

10. When the borrower repays, the tUSDC goes to your desk wallet with the interest.
11. If the loan goes overdue, or the ZEC price passes your liquidation level, your loan
    row shows **Liquidate**. The guardians check it against the median price of five
    exchanges (at least three must answer). One Zcash transaction then pays your desk what
    it is owed and returns the rest to the borrower.
12. If a borrower accepts but never locks, **Cancel and refund** returns your funding.

---

## 7. Lend privately

When you post an order, tick **Private desk**:

- **One-time key.** A key made from one wallet signature runs the desk, so your wallet
  never appears on the loan chain.
- **Funding.** First add tUSDC to your private balance (**Portfolio → Open private
  balance → Add**). The desk funds loans from that balance, and repayments come back into
  it.
- **Relayer.** The relayer submits each transaction. It cannot redirect funds, because the
  proof binds where every dollar goes.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| *No browser wallet found* | Install MetaMask, Coinbase Wallet or Rabby, then reload |
| *Before you go on: this wallet needs test ETH* | Use the **get test ETH** link (section 2) |
| The page is slow to load | The free host was asleep; give it 30 seconds |
| A request stays *Waiting for the desks* | Demo desks answer in seconds; your own desk needs you to click **Approve** |
| The lock stays at *Waiting for ZEC* | Check the payment left your Zcash wallet; a new payment can take a minute to appear |
| Confirmations are slow | Zcash testnet blocks vary; 10 confirmations is often 20 to 40 minutes |
| *Price feed down* or a liquidation check shows *Not met* | Fewer than 3 of the 5 exchanges answered; the guardians refuse to act on a thin price, by design |
| *Demo: pay from the test wallet* fails | The demo wallet may be out of test ZEC; pay from your own testnet wallet |

## What is real, what is test-only

- **Real:**
  - the Zcash testnet vaults, the shielded payments and the FROST threshold signing;
  - the loan contract and the shielded dollar vault on Robinhood Chain testnet;
  - the Groth16 proofs made in your browser;
  - the guardians' checks and signed log;
  - the price feed from five exchanges.
- **Test-only:**
  - tUSDC is a test token anyone can mint;
  - ZEC is testnet ZEC;
  - both guardians and the demo desks are run by the Hypothec team, on the same host as
    the website. In production each guardian is an independent operator.

How it works in depth: [DESIGN.md](DESIGN.md). Every design decision, dated:
[DECISIONS.md](DECISIONS.md). What the guardians sign and refuse:
[GUARDIANS.txt](GUARDIANS.txt).
