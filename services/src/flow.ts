// One complete Hypothec loan through every part: Base contract, loanbook, the 3-of-4 Zcash
// vault and the two referees (running separately, src/serve.ts). This script does only what
// the borrower app and the lender desk do (the same actions as the web API, actions.ts);
// every referee decision is the referees' own.
//   ts-node src/flow.ts repay       open -> lock -> lend -> repay -> release
//   ts-node src/flow.ts liquidate   open -> lock -> lend -> price crash -> liquidation
//   ts-node src/flow.ts topup       open -> lock -> lend -> margin call -> top-up -> repay -> release
//   ts-node src/flow.ts deadline    a 10-minute desk: open -> lock -> lend -> due date passes
//                                   unpaid -> liquidation on the deadline rule at the live price
//   ts-node src/flow.ts basket      one borrow of 5 USDC filled from two desks' orders (D16):
//                                   two loans, two vaults, locked together; one is repaid
//                                   and released, the other goes overdue and is liquidated
// Needs: e2e/stack.sh running in WSL (fresh), and `serve.ts all --fresh` running.
import { formatUnits } from "viem";
import { getLoan, isOverdue, usdcBalance } from "./base";
import { BASE_ADDRESS } from "./config";
import {
  borrowerAccept, borrowerRelease, borrowerRepay, keySetup, lenderFund, lenderLiquidate,
  lenderOffer, loanbook, lockFromTestWallet, lockManyFromTestWallet, openTestDesk, setPriceOverride,
  sizingPriceUsd, topUpFromTestWallet, until, type TestLender,
} from "./actions";
import { fill, topUpToStartZat } from "./desks";
import { partyFor } from "./party";
import { liquidationReason, ltvBps } from "./policy";
import { zecPrice } from "./price";
import { termsOf } from "./referee";

const path = process.argv[2] ?? "repay";
const PATHS = ["repay", "liquidate", "topup", "deadline", "basket"];
if (!PATHS.includes(path)) throw new Error(`usage: flow.ts ${PATHS.join("|")}`);
const PRINCIPAL = 5_000_000n; // 5 USDC (docs/DECISIONS.md D6)
/*
  The crash price, relative to the live price the collateral was sized at. At start LTV
  50% the liquidation line (75%) sits at 2/3 of that price and the vault stops covering
  the debt at about 0.51 of it, so 0.6 lands past the line with a surplus to return.
*/
const CRASH_OF_LIVE = 0.6;
/// A fall into the margin-call zone (LTV between 65% and 75%) but not past the line.
const DIP_OF_LIVE = 0.72;
/// The deadline path's desk lends for 10 minutes, the shortest term a desk may publish.
const SHORT_TERM_SECONDS = 600;

let n = 0;
const step = (s: string) => console.log(`\n== ${++n}. ${s}`);

async function main() {
  setPriceOverride(null);

  step("The test lender opens its desk: terms published and signed with its wallet");
  const desk = await openTestDesk(path === "deadline" ? { termSeconds: SHORT_TERM_SECONDS } : {});
  console.log(`${desk.name}: ${desk.aprBps / 100}% APR, ${desk.termSeconds >= 86_400 ? `${desk.termSeconds / 86_400} days` : `${desk.termSeconds / 60} minutes`}, start LTV ${desk.startLtvBps / 100}%`);

  step("The desk offers its terms for 5 USDC; two referees from the list");
  const { id, offer, tx } = await lenderOffer(PRINCIPAL, desk);
  console.log(`loan ${id}: lock ${Number(offer.collateralZat) / 1e8} ZEC, owe ${formatUnits(BigInt(offer.owedUsdc), 6)} USDC\n${tx}`);

  step("Borrower accepts the terms and both referees; registers a fresh ZEC payout address");
  console.log((await borrowerAccept(id, offer)).tx);

  step("Key setup: Borrower, Lender, Referee A and Referee B make a 3-of-4 shielded vault");
  const { vault, safetyNumber } = await keySetup(id);
  console.log(`safety number ${safetyNumber} (all four match)\nvault ${vault}`);

  step("Lender puts the USDC into the contract (paid out only once the referees see the ZEC)");
  console.log((await lenderFund(id, PRINCIPAL)).tx);

  step("Borrower locks the ZEC (regtest faucet stands in for the borrower's wallet)");
  const usdcBefore = await usdcBalance(BASE_ADDRESS.borrower);
  const locked = await lockFromTestWallet(id, vault, BigInt(offer.collateralZat));
  console.log(`desk sees ${locked.spendable_zat} zat locked (viewing key); the public sees nothing`);

  step("Referees confirm the lock on their own -> the contract pays the borrower");
  await until("the loan to be Active on Base", async () => (await getLoan(id)).statusName === "Active", 300_000, 4000);
  const paid = (await until("the payout to show", async () => {
    const d = (await usdcBalance(BASE_ADDRESS.borrower)) - usdcBefore;
    return d >= PRINCIPAL && d;
  })) as bigint;
  console.log(`borrower received ${formatUnits(paid, 6)} USDC`);
  await loanbook.event(id, { actor: "borrower", kind: "lent", data: { status: "Active" } });

  if (path === "topup") {
    const dip = Math.round((await sizingPriceUsd()) * DIP_OF_LIVE);
    step(`Price dips to $${dip}: margin call, not yet liquidation`);
    setPriceOverride(dip);
    const price = BigInt(dip) * 1_000_000n;
    const doc = await loanbook.get(id);
    const vaultZat = BigInt((await (await partyFor(id, "borrower")).balance()).total_zat);
    const ltv = ltvBps(BigInt(offer.owedUsdc), vaultZat, price);
    if (ltv < BigInt(offer.marginLtvBps) || liquidationReason(termsOf(doc), vaultZat, price, false)) throw new Error(`LTV ${ltv} bps is not in the margin-call zone`);
    console.log(`LTV ${Number(ltv) / 100}%: margin call; no liquidation rule is met`);
    const add = topUpToStartZat(BigInt(offer.owedUsdc), vaultZat, price, BigInt(desk.startLtvBps));
    step(`Borrower adds ${Number(add) / 1e8} ZEC to the vault (back to the start LTV)`);
    const after = await topUpFromTestWallet(id, vault, add);
    const ltvAfter = ltvBps(BigInt(offer.owedUsdc), BigInt(after.total_zat), price);
    if (ltvAfter > BigInt(desk.startLtvBps)) throw new Error(`LTV after the top-up is ${ltvAfter} bps`);
    console.log(`vault ${after.total_zat} zat; LTV ${Number(ltvAfter) / 100}%`);
    setPriceOverride(null);
  }

  if (path === "deadline") {
    const due = Number(offer.dueAt) * 1000;
    step(`Borrower does not repay; due ${new Date(due).toISOString()}`);
    await until("the contract to say the loan is overdue", async () => isOverdue(id), due - Date.now() + 300_000, 10_000);
    const price = await zecPrice();
    const doc = await loanbook.get(id);
    const vaultZat = BigInt((await (await partyFor(id, "lender")).balance()).total_zat);
    console.log(`overdue; at $${Number(price.microUsd) / 1e6} the price rule alone gives: ${liquidationReason(termsOf(doc), vaultZat, price.microUsd, false) ?? "nothing (LTV is healthy)"}`);
    step("Lender proposes ONE transaction at the live price: its share + the surplus back to the borrower");
    const r = await lenderLiquidate(id, BigInt(offer.owedUsdc), price.microUsd);
    console.log(`liquidation tx ${r.txid}: lender ${r.lenderZat} zat, borrower surplus ${r.surplusZat} zat, fee ${r.feeZat}
contract status: Liquidated`);
  } else if (path === "repay" || path === "topup") {
    step(`Borrower repays ${formatUnits(BigInt(offer.owedUsdc), 6)} USDC through the contract`);
    console.log((await borrowerRepay(id, BigInt(offer.owedUsdc))).tx);
    step("Borrower asks for the ZEC back; referees check and sign");
    const r = await borrowerRelease(id);
    console.log(`release tx ${r.txid}: ${r.amountZat} zat to the borrower, fee ${r.feeZat}`);
  } else {
    const crash = Math.round((await sizingPriceUsd()) * CRASH_OF_LIVE);
    step(`Price crashes to $${crash} (demo price override, logged as such)`);
    setPriceOverride(crash);
    step("Lender proposes ONE transaction: its share + the surplus back to the borrower");
    const r = await lenderLiquidate(id, BigInt(offer.owedUsdc), BigInt(crash) * 1_000_000n);
    console.log(`liquidation tx ${r.txid}: lender ${r.lenderZat} zat, borrower surplus ${r.surplusZat} zat, fee ${r.feeZat}\ncontract status: Liquidated`);
    setPriceOverride(null);
  }

  step("Referee log (every signature, with its evidence)");
  for (const ev of await loanbook.events(id)) {
    console.log(`${new Date(ev.at).toISOString()} ${ev.actor.padEnd(8)} ${ev.kind.padEnd(22)} ${JSON.stringify(ev.data)}${ev.sig ? " [signed]" : ""}`);
  }
  console.log(`\nFLOW ${path.toUpperCase()}: OK`);
}

/// One borrow from two desks: each piece its own loan and vault, locked together, then
/// settled apart (D16).
async function basket() {
  setPriceOverride(null);
  step("Two lenders open desks with orders: A 3 USDC at 9% for 90 days, B 5 USDC at 12% for 10 minutes");
  const deskA = await openTestDesk({ name: "Desk A", aprBps: 900, maxUsdc: 3_000_000 }, "lender");
  const deskB = await openTestDesk({ name: "Desk B", aprBps: 1200, termSeconds: SHORT_TERM_SECONDS, maxUsdc: 5_000_000 }, "lender2");
  const who = (owner: string): TestLender => (owner === deskA.owner ? "lender" : "lender2");
  const terms = (owner: string) => (owner === deskA.owner ? deskA : deskB);

  step("Borrower asks for 5 USDC: filled from the cheapest orders first");
  const { pieces, unfilledUsdc } = fill(PRINCIPAL, [deskA, deskB].map((d) => ({ owner: d.owner, aprBps: d.aprBps, remainingUsdc: BigInt(d.maxUsdc) })));
  if (unfilledUsdc > 0n) throw new Error("the orders do not cover the borrow");
  const basketId = `b${Date.now().toString(36)}`;
  for (const p of pieces) console.log(`${terms(p.desk).name}: ${formatUnits(p.principalUsdc, 6)} USDC`);

  step("Each desk offers its piece on its own terms; the borrower accepts each");
  const loans = [];
  for (const p of pieces) {
    const { id, offer } = await lenderOffer(p.principalUsdc, terms(p.desk), who(p.desk), basketId);
    await borrowerAccept(id, offer);
    loans.push({ id, offer, who: who(p.desk), name: terms(p.desk).name });
    console.log(`${terms(p.desk).name}: loan ${id.slice(0, 10)}, lock ${Number(offer.collateralZat) / 1e8} ZEC`);
  }

  step("A 3-of-4 vault per loan, each with its desk's key share and the two referees");
  const vaults = [];
  for (const l of loans) {
    const { vault } = await keySetup(l.id);
    vaults.push({ id: l.id, vault, zat: BigInt(l.offer.collateralZat) });
    console.log(`${l.name}: vault ${vault.slice(0, 24)}…`);
  }

  step("Each desk funds its own loan contract");
  for (const l of loans) await lenderFund(l.id, BigInt(l.offer.principalUsdc), l.who);

  step("Borrower locks the ZEC for both vaults together");
  const usdcBefore = await usdcBalance(BASE_ADDRESS.borrower);
  await lockManyFromTestWallet(vaults);
  for (const l of loans) await until(`${l.name}'s loan to be Active`, async () => (await getLoan(l.id)).statusName === "Active", 300_000, 4000);
  const paid = (await until("both payouts", async () => {
    const d = (await usdcBalance(BASE_ADDRESS.borrower)) - usdcBefore;
    return d >= PRINCIPAL && d;
  })) as bigint;
  console.log(`borrower received ${formatUnits(paid, 6)} USDC from ${loans.length} desks`);

  const [first, second] = loans;
  step(`Borrower repays ${first.name} and takes that vault's ZEC back`);
  await borrowerRepay(first.id, BigInt(first.offer.owedUsdc));
  const r = await borrowerRelease(first.id);
  console.log(`${first.name}: released ${r.amountZat} zat`);

  step(`${second.name}'s loan is not repaid; its due date passes`);
  await until(`${second.name}'s loan to be overdue`, async () => isOverdue(second.id), Number(second.offer.dueAt) * 1000 - Date.now() + 300_000, 10_000);
  const price = await zecPrice();
  const liq = await lenderLiquidate(second.id, BigInt(second.offer.owedUsdc), price.microUsd);
  console.log(`${second.name}: liquidated, desk ${liq.lenderZat} zat, borrower surplus ${liq.surplusZat} zat`);

  step("Each loan ended on its own");
  for (const l of loans) {
    const doc = await loanbook.get(l.id);
    console.log(`${l.name}: Base ${(await getLoan(l.id)).statusName}, loanbook ${doc.status}`);
  }
  console.log("\nFLOW BASKET: OK");
}

(path === "basket" ? basket() : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
