// The referee rules (BUILD-PLAN "Done means"): refuse a liquidation without surplus to the
// borrower, refuse release to any address but the borrower's, refuse liquidation when the
// price rule is not met. Plus the loanbook's signature checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { checkLiquidation, checkRelease, lenderShareZat, liquidationReason, ltvBps, type Terms } from "../src/policy";
import { hourAverage, median, pickPrice } from "../src/price";
import { handle, LoanStore, offerDigest, type Accept, type Offer } from "../src/loanbook";
import { message } from "../src/sign";

const T: Terms = {
  owedUsdc: 5_150_000n,
  collateralZat: 1_000_000n,
  marginLtvBps: 6500n,
  liquidationLtvBps: 7500n,
  slippageBps: 200n,
  lenderZec: "zLENDER",
  borrowerZec: "zBORROWER",
};
const VAULT = 1_000_000n;
const usd = (n: number) => BigInt(n * 1_000_000);

test("LTV and the lender's share follow BRIEF section 3", () => {
  assert.equal(ltvBps(T.owedUsdc, VAULT, usd(1000)), 5150n); // 51.5% at $1,000
  assert.equal(ltvBps(T.owedUsdc, VAULT, usd(600)), 8583n); // 85.8% at $600
  assert.equal(lenderShareZat(T.owedUsdc, usd(600), 200n), 875_500n); // 5.15/600 x 1.02 ZEC
});

test("liquidation is allowed only past the LTV level or the deadline", () => {
  assert.equal(liquidationReason(T, VAULT, usd(1000), false), null);
  assert.match(liquidationReason(T, VAULT, usd(600), false)!, /LTV/);
  assert.match(liquidationReason(T, VAULT, usd(1000), true)!, /deadline/);
});

test("a correct liquidation passes", () => {
  const share = 875_500n;
  const outputs = [
    { address: "zLENDER", amount_zat: Number(share) },
    { address: "zBORROWER", amount_zat: Number(VAULT - share - 15_000n) },
  ];
  assert.equal(checkLiquidation(outputs, T, VAULT, usd(600)), null);
});

test("refuses a liquidation without the surplus to the borrower", () => {
  const outputs = [{ address: "zLENDER", amount_zat: 875_500 }];
  assert.match(checkLiquidation(outputs, T, VAULT, usd(600))!, /surplus/);
});

test("underwater: the lender may take the whole vault, and only when it is owed more", () => {
  // At $500 the debt (5.15 USDC x 1.02 / 500 = 0.010506 ZEC) exceeds the 0.01 ZEC vault.
  assert.equal(checkLiquidation([{ address: "zLENDER", amount_zat: 985_000 }], T, VAULT, usd(500)), null);
  // At $600 it does not, so taking everything is still refused.
  assert.match(checkLiquidation([{ address: "zLENDER", amount_zat: 985_000 }], T, VAULT, usd(600))!, /exceeds|surplus/);
});

test("refuses a liquidation paying the lender more than it is owed", () => {
  const outputs = [
    { address: "zLENDER", amount_zat: 950_000 },
    { address: "zBORROWER", amount_zat: 40_000 },
  ];
  assert.match(checkLiquidation(outputs, T, VAULT, usd(600))!, /exceeds/);
});

test("refuses a liquidation that pays a third address", () => {
  const outputs = [
    { address: "zLENDER", amount_zat: 875_500 },
    { address: "zTHIEF", amount_zat: 109_500 },
  ];
  assert.match(checkLiquidation(outputs, T, VAULT, usd(600))!, /neither party/);
});

test("release goes only to the borrower's registered address, and all of it", () => {
  assert.equal(checkRelease([{ address: "zBORROWER", amount_zat: 990_000 }], T, VAULT), null);
  assert.match(checkRelease([{ address: "zLENDER", amount_zat: 990_000 }], T, VAULT)!, /registered/);
  assert.match(checkRelease([{ address: "zBORROWER", amount_zat: 500_000 }], T, VAULT)!, /everything/);
});

test("price: 1h average per source, median across sources, no thin data", () => {
  const now = 10_000_000;
  const candles: [number, number][] = Array.from({ length: 60 }, (_, i) => [now - i * 60_000, 1000 + i]);
  assert.equal(hourAverage(candles, now), 1029.5);
  assert.throws(() => hourAverage(candles.slice(0, 5), now));
  assert.equal(median([1100, 1000, 1200]), 1100);
});

test("price: thin sources are left out, and at least three must count", () => {
  const thin = new Error("only 3 candles in the last hour");
  const p = pickPrice({ bitstamp: 1180, bitfinex: thin, gemini: 1182, gate: 1228, mexc: 1227 });
  assert.equal(p.detail.median, 1204.5); // median of 1180, 1182, 1227, 1228
  assert.equal(p.skipped?.bitfinex, thin.message);
  assert.throws(() => pickPrice({ bitstamp: 1180, bitfinex: thin, gemini: thin, gate: 1228, mexc: thin }), /need 3/);
});

test("the loanbook refuses an offer or accept whose signature does not match", async () => {
  const store = new LoanStore(":memory:");
  const lenderKey = generatePrivateKey();
  const borrowerKey = generatePrivateKey();
  const lender = privateKeyToAccount(lenderKey);
  const borrower = privateKeyToAccount(borrowerKey);
  const id = ("0x" + "11".repeat(32)) as Hex;
  const offer: Offer = {
    contract: lender.address, lender: lender.address, borrower: borrower.address,
    refereeA: lender.address, refereeB: borrower.address, principalUsdc: "5000000", owedUsdc: "5150000",
    dueAt: 1, lockBy: 1, collateralZat: "1000000", marginLtvBps: 6500, liquidationLtvBps: 7500,
    slippageBps: 200, lenderZec: "zLENDER",
  };
  const forged = await borrower.signMessage({ message: message("offer", id, offer) });
  await assert.rejects(handle(store, "POST", "/loans", { id, offer, lenderSig: forged }), /lender signature/);
  await handle(store, "POST", "/loans", { id, offer, lenderSig: await lender.signMessage({ message: message("offer", id, offer) }) });

  const accept: Accept = { offerDigest: offerDigest(id, offer), borrowerZec: "zBORROWER" };
  const swapped = { ...accept, borrowerZec: "zTHIEF" };
  const sig = await borrower.signMessage({ message: message("accept", id, accept) });
  await assert.rejects(handle(store, "POST", `/loans/${id}/accept`, { accept: swapped, borrowerSig: sig }), /borrower signature/);
  await handle(store, "POST", `/loans/${id}/accept`, { accept, borrowerSig: sig });
  assert.equal(store.get(id)!.accept!.borrowerZec, "zBORROWER");
});
