# Decisions

Everything about the guardians (who they are, how the vault is made, every check, the
signed log, limits) is in one place: docs/GUARDIANS.txt.

## 8 Oct 2026

**D1. Borrowed USDC goes to any address the borrower gives (Base).**
The USDC side is allowed to be public. What Hypothec protects is the borrower's Zcash side:
the lender learns the collateral amount (through the vault's viewing key, needed to lend)
and where the borrowed money goes, nothing about the borrower's Zcash wallet.
What the lender can and cannot see on Zcash:
- Can: the vault's balance and its notes (viewing key); the outputs of any vault spend it
  verifies, including the borrower's payout address.
- Cannot: where the ZEC came from (shielded notes carry no sender address), the borrower's
  wallet balance or history, or any other address of the borrower's.
- So the borrower's registered payout address should be a fresh diversified address:
  unlinkable to their other addresses without their own viewing key.
- Identity (KYC) is separate: an exchange lender knows its customer anyway.

**D2. The borrower sees and approves the referee before locking any ZEC.**
Added to scope by the user. Exact flow to design with referee/ (who is offered, what the
borrower sees: operator, published rules, signature log).

**D3. Payouts stay shielded; the lender sees only the payout address and amount.**
A vault payout is an ordinary shielded transaction: the public sees nothing. Vault members
(the lender included) can read the vault's own spends, because each signer checks a spend
before signing (no blind signing). From that the lender learns the payout address and the
amount sent to it, never that address's balance, other payments or later moves. With a
fresh address per loan (D1) the address leads nowhere. Hiding payouts from members would
mean signing unchecked, so we don't.

**D4. Vault is 3-of-4: Borrower, Lender and two referees from the Hypothec operator list.**
Supersedes the 2-of-3 in BRIEF section 1. Referees are named operator companies listed on
Hypothec (not miners: anonymous, rotating, unaccountable, don't run our rules, easy to
bribe). The borrower approves both before locking (D2).
- Release: Borrower + both referees. Liquidation: Lender + both referees.
- Borrower + Lender + either referee: cooperative close (one referee offline).
- Both referees alone, or Lender + one referee: cannot move anything.
- Theft now needs both independent operators plus one party; in 2-of-3 it needed two.
- Rejected: 3-of-5 with three referees, because the three referees alone would reach the
  threshold.
- Cost: release and liquidation need both referees online. Share repair replaces a lost one.
- Tested 8 Oct: core/e2e/liquidation.sh, Lender + one referee refused, Lender + both
  referees paid lender share + borrower surplus in one tx, Borrower not signing.

**D5. The USDC side is a loan contract on Base Sepolia ("rules on-chain, keys off-chain").**
`usdc/contracts/HypothecLoans.sol`: the lender offers terms (with its two referees), the
borrower accepts (agreeing to the referees, D2, and naming the payout address), the lender
funds the contract, both referees confirm the ZEC lock, then the contract pays the
borrower. Repayments go through the contract to the lender, and it records "Repaid", which
the referees act on to release the ZEC. It records liquidation (both referees) and flags
overdue loans. It stores nothing about the collateral (privacy promise). A contract cannot
sign on Zcash, so the referees still hold key shares; the contract makes their decisions
public and provable.

**D7. The borrower never picks a lender (8 Oct). Superseded by D14 on 14 Oct.** The exchange installs Hypothec, so the
borrower is already inside that desk's app and sees its published terms. The borrower
types an amount and a USDC address; nothing else to choose.

**D8. Collateral is sized at the live price the referees use** (1-hour average per
exchange, median across them), not a fixed demo price, so the borrower is quoted on the
number that will judge the loan. A price that falls straight through the liquidation
line can leave no surplus; then the lender takes the vault less the fee, which the
referees' rule allows and nothing more (tested).

**D9. UI: Quorum's construction, institutional look (changed 10 Oct).** Static `.mjs`
builder, one stylesheet, every figure live. First built as a game (ink outlines, hard
shadows, a cartoon vault, an icon quest track); on 10 Oct the user asked for an
institutional look instead. Now: hairline rules, white panels, tabular figures, Zcash
yellow only for the main action and progress, icons only in the navigation. The
landing page states the loan structure, who sees what, and the build's status and
limits. See web/README.md.

**D17. The interface, organised as Quorum's (16 Oct, user).** Four places in the rail:
Markets (the order book, the app's main page), Portfolio (Borrowing and Lending tabs),
Guardians, Docs. Borrow and Lend sit at the end of each desk's row and open dialogs;
Lend starts from that desk's terms (desks lend their own money, D10). Explanations moved
off the app screens into Docs; panels with nothing to show stay hidden until there is a
loan; the top-up and the demo price controls fold away. One drawing, made for Hypothec
(web/art.mjs): the vault as contour lines with its four key holders, three joined; faint
behind the landing hero and each page heading, over a ledger grid that fades down the
page. Fonts no longer block the first paint.

**D18. Desk agents: instant answers (16 Oct, user: "these things are supposed to be very
fast").** A desk that reviews each request by hand leaves the borrower waiting on a person.
A desk can run an agent holding its Base key that answers requests (posts and signs the
offer) and funds each loan once its vault is made, in seconds: request accepted in about
1 s, offer on Base about 8 s later (measured). Markets marks such desks "Instant". In the
demo the two test desks run their agents inside api.ts; a desk run from a browser wallet
still reviews on its Lending tab. The request no longer re-reads every chain before
answering: it checks the last snapshot, less what was asked of each desk since. The
waiting screen now shows the ZEC each piece will lock and says where the deposit
request appears.

**D19. Interface upgrade (16 Oct, user).** Before an action the screens show what the
connected wallet holds on Base Sepolia (ETH for fees, USDC) and say what is short, with
faucet links: in the Borrow and Lend dialogs, at Accept and at Repay. Portfolio has a
progress strip: what the borrow waits for, time since the last step, how long it usually
takes, a moving bar while the system works and a highlighted "your turn" when it waits on
the borrower. Markets shows each desk's record (repaid, liquidated), what it has lent and
how many loans are open, marks the best rate, and sorts by rate, term, lent or available;
on a phone each stacked cell keeps its column's name. Loading placeholders, plain-language
errors, a three-line "how it works" on the landing page. Motion: cross-page fade with the
rail held still, content settling in, dialogs and toasts rising in, step panels fading in,
button press feedback and a spinner while busy; all off under reduced motion. Redraws now
happen only when the HTML changed (a 2 s redraw had been replacing buttons under the
pointer and losing clicks). Every Base connection falls back between two public RPC
providers (sepolia.base.org, PublicNode), after a run failed on one provider timing out.

**D20. Repay a whole borrow in one transaction; the ZEC comes back by itself (16 Oct,
user).** The loan contract gained `repayAll(ids)`: every listed loan repaid in full in one
transaction, each lender paid what is left on its own loan, each loan marked Repaid with
the same events the referees release on. `repayAllWithPermit` takes a USDC permit
(EIP-2612, which Circle's USDC implements: domain "USDC", version 2), so repaying is one
signature (no fee) and one transaction, with no approve; a permit someone else already
submitted is not an error if its allowance is there. All or nothing: a liquidated,
released or repeated loan stops the whole call, so nothing is paid twice or to a closed
loan. Partly repaid loans pay only what is left. Single-loan Repay uses the same path. After
the repayment the borrower's app asks the guardians to release every repaid vault
(`borrower/release-all`, one job), so the ZEC comes back without another click; there is
also a "Get all ZEC back" button. The ZEC releases remain one Zcash transaction per vault:
each vault has its own key. 14 contract tests (9 unchanged). New contract
`0x63dd4a31a6b559f3a893f0c474a145b6fdff817a` on Base Sepolia (16 Oct, deployed by the test
lender wallet; `usdc/scripts/deploy.ts`); the old one is kept in deployments/base-sepolia.json
as `previous`. The app works with one contract at a time, so open loans had to be settled
first (the user's two were repaid and released before the switch).

**D21. Layout as Kamino's (16 Oct, user).** A top bar instead of the side rail (mark left,
sections centred, network, wallet and theme right, pinned on scroll); larger titles with
their figures in rounded pills; on Markets, featured cards for the three best rates, filter
chips (all, instant, under 30 days, 30 days and over) with a search, and taller rows with
each desk's monogram. Larger corner radii throughout. Our colours kept.

**D22. Guardians: an operator list, chosen per desk, paid 0.10% each (19 Oct, user).** A
guardian registers itself in the loanbook, signed with its Base key: name, operator, fee
and a sha256 fingerprint of the rules code it runs; it heartbeats every 30 s and shows
online while heartbeats are under 90 s old. A desk names two online guardians that are
different from each other and from itself; every offer carries them and the borrower
accepts them on Base. The contract pays each guardian 0.10% of the principal at
confirmLock, from the desk's funding (`fundingAmount` = principal + 2 fees; refunded with
it on cancel). A flat fee, the same whether the loan is repaid or liquidated, so a
guardian never earns more by liquidating. Hypothec may run at most one guardian in
production (two would give one company and a desk 3 of 4 keys); in the demo the team runs
both, said on the Guardians page. Bond and slashing, attested code and an on-chain price
are next (docs/DESIGN.md section 7).

**D23. A lock that never completes gives the borrower's ZEC back (20 Oct).** Found when
checking deposits: a borrower who sent part of the collateral, then let the lock deadline
pass, could not get it back. The desk cancels and the contract refunds it, but the
guardians released only on Repaid, so the ZEC stayed in the vault unless the desk agreed
to co-sign. Now the guardians treat Cancelled like Repaid for a release (the same checks:
one output, the borrower's signed address, everything but the fee). Safe because a
cancelled loan never paid the borrower any USDC. Desk agents cancel on their own once the
deadline passes; a desk on a browser wallet gets a "Cancel and refund" button; the
borrower gets "Get ZEC back". Tested: flow.ts `cancel`.

**D24. Two loan chains, one site, a switch (21 Oct, user).** The dollar side runs on Base
Sepolia (Circle's test USDC) or Robinhood Chain testnet. Paxos's test USDG faucet is closed
in the user's country, so Robinhood uses Test USDC (usdc/contracts/test/TestUSDC.sol, the
same 6 decimals and permit, anyone can mint; the app offers "Get 20 test tUSDC"). Each chain
runs its own loanbook, guardians, desks and API, so a loan, its desk and its guardians never
mix chains; the public API forwards /x/<chain>/api/ to the other (HYPOTHEC_PEERS), and the
switch beside the wallet picks one and remembers it (?chain=robinhood in a link works too).
The Borrow dialog names the chain and token. The Zcash side (party host, relay, test wallet)
is shared. flow.ts repay passes on Robinhood.

**D25. A shielded dollar side: private borrows (22 Oct, user).** On Zcash the collateral was
already private; on Base and Robinhood the borrower's wallet, the payout and the repayment
were public. Now a borrow can be private on the dollar side too, with Zcash's own design
(as Gloam does for payments, built separately for loans): a vault contract
(usdc/contracts/vault/HypothecVault.sol) holds dollars as private notes, Poseidon
commitments in a Merkle tree, spent with a Groth16 proof (shield/circuits/spend.circom: up to
two notes in, one change note, a public amount out) that publishes nullifiers and hides which
note. A private borrow's borrower on the loan chain is a one-time key from the wallet's
signature; it signs its acceptance and a relayer submits it (`acceptShielded`), so the key
needs no gas and the wallet never appears. The principal is paid into the vault as a note only
that seed can spend; repaying proves a spend straight into the loan (`transact` with the loan
id; the recipient, loan, relayer and fee are hashed into the proof so a relayer cannot change
them). Public: the loan's amount and terms (the contract enforces them), and money entering
or leaving the vault. Private: who borrowed, who repaid, where the dollars went inside.
Test proving keys from a one-machine setup and no audit: a real deployment needs a ceremony.
Tested: 4 contract tests with real proofs; test/e2e-private.mjs through the screens.

**D26. Private desks: the lender's side shielded too (22 Oct, user).** With D25 a private
borrower was hidden but the desk still lent from a public wallet. Now a desk can be private:
a one-time key from the lender's wallet signature owns it, signs its terms, its offers
(`offerShielded`) and its cancels (`cancelSigned`), and the relayer submits them, so the key
needs no gas and the wallet never appears. It funds from its private balance with a proof
(`transact` with the loan contract as recipient: the vault approves the funding and calls
`fundFromVault`, which only the vault may call and only for a private desk's loan). What comes
back is held by the loan contract and paid into the vault as one private note per loan when
the loan ends: the amount owed when Repaid, what was repaid when Liquidated, the funding when
Cancelled after funding, so the desk finds it again from its seed and the loan's status
alone. The vault checks a repay or a funding used its whole approval (not its balance, since
a repayment can come straight back in as the desk's note). Markets shows a private desk with
a "Private" chip; its order counts at face value, since its balance cannot be seen (if it
cannot fund, the loan never reaches the lock and no ZEC moves). Liquidation is unchanged: the
desk's ZEC share goes to the shielded address in its terms. Public: the loan's amount and
terms; private: which wallet lent and where the repayment went. Tested: 3 more contract
tests with real proofs (private on both sides; a private desk's signed cancel refunding into
its note; only the vault funds a private desk's loan) and test/e2e-private-lend.mjs.
Notes the seed cannot find again on its own (deposits and change) were kept only in the
browser, so clearing it lost them. Now each is also stored on the site encrypted (AES-GCM),
under a tag; the key and the tag both come from the wallet's signature, so the site holds
only ciphertext, and signing again in any browser restores every note (tested: a deposit
made in one browser profile shows in a fresh one).

**D27. Borrow as an order ticket (22 Oct, user).** The Borrow dialog had grown into one
long column (about 900 px). It is now two columns: the order (amount, which desks fill it,
Private) and a term sheet (what you lock, what you repay, rate, due, chain, the wallet check
and the button), one screen tall on a laptop and stacked on a phone. A private borrow needs
no ETH, so its wallet check asks only for the interest. Lend got the same ticket: the order in
four labelled groups (order, pricing, risk, settlement) and a preview of what borrowers see
(rate, the LTV ladder, guardian fees, collateral per 100 lent, interest at term). Every page's
heading figures are now one card of cells as on Markets (they were separate pills), and an
empty Portfolio is one quiet line with a normal button.

**D10. Desk, not pool (8 Oct; decided 14 Oct with D14).** The borrower app shows
the desk like a pool card (available USDC, rate, term, start LTV, price, Borrow), but the
money is one lender's. A depositor pool would need someone to hold the lender's key
share and sell liquidated ZEC on behalf of all depositors (a custodian: a contract
cannot hold a FROST share), would face AML questions lending to unknown borrowers
against shielded collateral, and BRIEF rules it out. A pool can come later as one more
"desk" run by an operator.

**D11. Five price sources, at least three must count (9 Oct).** Bitstamp, Bitfinex,
Gemini (ZEC/USD), Gate.io and MEXC (ZEC/USDT, at par). A source counts only with 10+
one-minute candles in the hour: on 9 Oct Bitfinex had 3, and the old three-source rule
then had no price at all. Left-out sources are shown with the reason. Tested.

**D12. People sign their own Base actions with the wallet they connect (9 Oct).** The
borrower app and the desk have a Connect wallet button (any EIP-1193 browser wallet;
it switches to Base Sepolia). The desk's wallet posts and signs its terms and funds;
the borrower's wallet accepts, signs its ZEC payout address and repays. The API holds no
Base key for them: it prepares what they sign and checks the chain before recording
each claim. The borrower pastes their own fresh ZEC payout address; release and
liquidation pay the addresses in the signed loanbook entries (previously a hard-coded
test address, which the guardians would have refused for real addresses). Locking shows
the vault address and a QR; on this local chain the test wallet still sends the ZEC,
labelled as such. Each party's Zcash key share stays in its own party service (its
device); the guardians keep their own keys as operators. Tested end to end through
the real screens with a test-only wallet stand-in (services/test/e2e-web.mjs).

**D13. Zcash testnet is blocked by NU7, so the demo stays on Ironwood regtest (9 Oct,
pending the user's call).** Ironwood has been on testnet since block 4,134,000 and zafe
ran a 2-of-3 spend there on 30 Sep (testnet.zec.rocks, Valar faucet). But testnet
activated NU7 at block 4,465,026 on 4 Oct, and the newest stable librustzcash
(zcash_protocol 0.10.6, zcash_primitives 0.30.1) has NU7 behind `zcash_unstable` with no
testnet height, so zafe builds transactions testnet now rejects; even Zallet cannot build
NU7 transactions yet (zallet#898). Only zcash_protocol 0.11.0-pre.0 (1 Oct) exists.
Mainnet NU7 is targeted for 5 Nov (height to be set 20 Oct), after the 28 Oct deadline.
Revisit if stable NU7 crates ship before then. No standard exists for a website to
connect a Zcash wallet, so the Zcash side stays address + QR in, signed address out.
*Update 14 Oct (user: try the pre-release).* Still no stable NU7 crates, but the 6 Oct
pre-releases set the real NU7 branch id and testnet height (zcash_protocol 0.11.0-pre.0,
not behind `zcash_unstable`), and upstream zafe (moved to github.com/zafe-cash/zafe)
ported to them on 12 Oct and sent a payment on NU7 testnet on 13 Oct. vendor/zafe and the
WSL build clone now sit on zafe `c39ff82` with our patch re-applied
(spike/zafe-multi-output.patch, regenerated); core/ uses zcash_protocol 0.11.0-pre.0 and
zcash_keys 0.17.0-pre.1 (one call changed: `top_up_pool` takes `reset`, false for us).
Regtest stays on NU6.3 (ths 0.3.0 has no NU7) and is what the e2e scripts run. Testnet
needs TAZ from the Valar faucet (0.125 per request, one per IP per day, by hand) and the
party services started with `--network test --lightwalletd https://testnet.zec.rocks:443`.
*Update 16 Oct: runs on testnet.* A 2-of-2 test wallet (e2e/testnet-wallet.sh, both shares
local) took 0.125 TAZ from the Valar faucet (block 4,508,150) and pays each lock in one
transaction (one output per vault); released ZEC comes back to it. `NETWORK=test
e2e/stack.sh` plus `ZAFE_NETWORK=test` for serve.ts / api.ts / flow.ts. First full loan on
testnet: `flow.ts repay`, FLOW REPAY: OK; the lock needed 10 confirmations (librustzcash
default for received notes, about 33 minutes at that day's block times) before both
referees confirmed it; release tx 0c686198...d4c8 returned 796,924 zat to the test wallet.
The local chain stays for quick runs and the screen tests.

**D14. Open desks: anyone can lend (14 Oct, user).** Hypothec is a standalone app, not
something an exchange installs (reverses D7). Any Base wallet opens a desk on the Lend
page: name, rate, term, start / margin-call / liquidation LTV, price buffer and its ZEC
address for liquidation shares, signed with that wallet (kind "desk", `desk=<owner>`) and
kept in the loanbook (services/src/desks.ts checks the levels are in order and leave room
for a surplus). Borrowers pick a desk from the markets table; only that desk's wallet can
answer the request. Each loan still carries its own signed offer, so a desk changing its
terms later does not touch running loans, and the referees need no change (the contract
already accepted any lender). Still one desk = one lender's money: no pool (D10), since a
pool needs a custodian for the lender's key share. An exchange can still run a desk (and do
its own KYC there); it is one desk among others. (The one-loan-at-a-time limit of 14 Oct
went with D16.)

**D15. Top-up and the due-date path (14 Oct).** A borrower adds ZEC to a running loan's
vault at any time; the referees already judge the vault's live balance, so nothing has to
be signed and the LTV falls as soon as it confirms. At a margin call the loan page suggests
the amount back to the desk's start LTV. No grace period: liquidation stays at the
published liquidation LTV, and the margin call is a warning. The due-date rule
(contract `isOverdue`) was already in the referees' rules; the API now passes it too, and a
desk may publish terms as short as 10 minutes so the path can be run (flow.ts `deadline`).
Interest is pro rata per second of the term.

**D16. Orders, and one borrow filled from several desks (16 Oct, user).** A desk posts an
order: its terms plus how much it lends in all (`maxUsdc`); what is left is that less its
open loans and the pieces asked of it. The Borrow page is the order book: the borrower
types an amount and it fills from the cheapest orders first (then the larger order),
ticking or unticking orders on the same page (services/src/desks.ts `fill`, mirrored in
app.js). Each piece becomes its own loan with its own 3-of-4 vault, its desk's terms and
its own Base contract entry; the loans of one borrow share a `basket` id in the loanbook.
- Not one vault with several lenders: that breaks 3-of-4, and one liquidation would pay
  several lenders under different rules. Separate loans keep every rule unchanged.
- Together where it helps the borrower: one accept click (one wallet prompt per loan),
  one lock (a ZIP 321 payment request with one output per vault, so a real wallet pays all
  in one shielded transaction; the regtest faucet sends one per vault), Repay all.
- Apart where it matters: each loan is repaid, topped up, released or liquidated on its
  own; a liquidation of one leaves the others untouched (tested: flow.ts `basket`, one
  piece repaid and released while the other goes overdue and is liquidated).
- A party service holds one vault, so the party host starts four per loan (e2e/control.py
  POST /party; fresh party identities per loan, so loans cannot be linked through key
  holders). In the product each role runs its own host on its own device.
- Limits: at most 4 pieces and 15 USDC per borrow (testnet faucet); pieces no desk has
  answered can be dropped by the borrower, which frees those orders.

**D6. Real Circle test USDC, small numbers.** The faucet gives 20 USDC per 2 hours, so
the demo uses e.g. 5 USDC against 0.01 ZEC at $1,000 (same 50% LTV maths), not $5,000.
