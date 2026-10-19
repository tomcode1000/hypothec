// Open desks (D14), the top-up suggestion and short terms for the deadline rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkDesk, DEMO_TERMS, lockWindow, quote, topUpToStartZat, type DeskTerms } from "../src/desks";
import { handle, LoanStore } from "../src/loanbook";
import { ltvBps } from "../src/policy";
import { message } from "../src/sign";
import { ZEC_ADDRESS } from "../src/zec";

const ZEC = "uregtest1pztwkegallegrv2q2nrx06lk40agnp2qqjcan5wy2h4vcfwvyy70jchh64acc7h4yha4avsqzpu87dqppxl8z9erx3kugye67cdtyljp";
// Two guardians from the operator list (registered in the loanbook tests below).
const gKeys = [generatePrivateKey(), generatePrivateKey()];
const [gA, gB] = gKeys.map((k) => privateKeyToAccount(k).address);
const terms = (owner: `0x${string}`, over: Partial<DeskTerms> = {}): DeskTerms => ({ ...DEMO_TERMS, owner, lenderZec: ZEC, guardianA: gA, guardianB: gB, at: 1, ...over });
async function registerGuardians(store: LoanStore) {
  for (const [i, key] of gKeys.entries()) {
    const info = { address: privateKeyToAccount(key).address, name: `Guardian ${"AB"[i]}`, operator: "Test operator", feeBps: 10, code: "a".repeat(64), at: Date.now() };
    await handle(store, "POST", "/guardians", { info, sig: await privateKeyToAccount(key).signMessage({ message: message("guardian", info.address, info, "guardian") }) });
  }
}
const signDesk = (key: `0x${string}`, t: DeskTerms) => privateKeyToAccount(key).signMessage({ message: message("desk", t.owner, t, "desk") });

test("desk terms: the levels must be in order and leave room for a surplus", () => {
  const owner = privateKeyToAccount(generatePrivateKey()).address;
  assert.equal(checkDesk(terms(owner), ZEC_ADDRESS), null);
  assert.match(checkDesk(terms(owner, { startLtvBps: 7000 }), ZEC_ADDRESS)!, /start LTV/);
  assert.match(checkDesk(terms(owner, { marginLtvBps: 8000 }), ZEC_ADDRESS)!, /margin-call LTV/);
  assert.match(checkDesk(terms(owner, { liquidationLtvBps: 9400 }), ZEC_ADDRESS)!, /95%/);
  assert.match(checkDesk(terms(owner, { termSeconds: 60 }), ZEC_ADDRESS)!, /10 minutes/);
  assert.match(checkDesk(terms(owner, { lenderZec: "t1notshielded" }), ZEC_ADDRESS)!, /shielded/);
  assert.match(checkDesk(terms(owner, { name: "<script>" }), ZEC_ADDRESS)!, /name/);
  assert.match(checkDesk(terms(owner, { guardianB: gA }), ZEC_ADDRESS)!, /different operators/);
  assert.match(checkDesk(terms(owner, { guardianA: owner }), ZEC_ADDRESS)!, /own guardian/);
});

test("quote: interest runs for the desk's term in seconds", () => {
  const ninety = quote(5_000_000n, 1000, DEMO_TERMS);
  assert.equal(ninety.owedUsdc, 5_147_945n); // 5 x (1 + 12% x 90/365)
  assert.equal(ninety.collateralZat, 1_000_000n); // 5 USDC at 50% LTV and $1,000 = 0.01 ZEC
  const tenMinutes = quote(5_000_000n, 1000, { ...DEMO_TERMS, termSeconds: 600 });
  assert.equal(tenMinutes.owedUsdc, 5_000_011n);
  assert.equal(lockWindow(600), 300);
  assert.equal(lockWindow(DEMO_TERMS.termSeconds), 86_400);
});

test("top-up: the suggested amount brings the loan back to the start LTV", () => {
  const owed = 5_150_000n;
  const vault = 1_000_000n;
  const dip = 720_000_000n; // $720
  assert.ok(ltvBps(owed, vault, dip) >= 6500n);
  const add = topUpToStartZat(owed, vault, dip, 5000n);
  assert.ok(add > 0n);
  assert.ok(ltvBps(owed, vault + add, dip) <= 5000n);
  assert.ok(ltvBps(owed, vault + add - 2n, dip) > 5000n - 1n); // and not much more than needed
  assert.equal(topUpToStartZat(owed, vault, 2_000_000_000n, 5000n), 0n); // healthy: nothing to add
});

test("the loanbook lists a desk only with its owner's signature, one name per desk", async () => {
  const store = new LoanStore(":memory:");
  const aKey = generatePrivateKey();
  // A desk naming guardians that are not on the operator list is refused.
  const early = terms(privateKeyToAccount(aKey).address);
  await assert.rejects(handle(store, "POST", "/desks", { terms: early, sig: await signDesk(aKey, early) }), /operator list/);
  await registerGuardians(store);
  const bKey = generatePrivateKey();
  const a = terms(privateKeyToAccount(aKey).address);
  await assert.rejects(handle(store, "POST", "/desks", { terms: a, sig: await signDesk(bKey, a) }), /signature/);
  await handle(store, "POST", "/desks", { terms: a, sig: await signDesk(aKey, a) });
  const b = terms(privateKeyToAccount(bKey).address, { name: "desk a" });
  await assert.rejects(handle(store, "POST", "/desks", { terms: b, sig: await signDesk(bKey, b) }), /name/);
  const a2 = { ...a, aprBps: 900, at: 2 };
  await handle(store, "POST", "/desks", { terms: a2, sig: await signDesk(aKey, a2) });
  const listed = (await handle(store, "GET", "/desks", {})) as { terms: DeskTerms }[];
  assert.equal(listed.length, 1);
  assert.equal(listed[0].terms.aprBps, 900);
});

test("fill: one borrow across several desks' orders, cheapest first", async () => {
  const { fill } = await import("../src/desks");
  const a = privateKeyToAccount(generatePrivateKey()).address;
  const b = privateKeyToAccount(generatePrivateKey()).address;
  const c = privateKeyToAccount(generatePrivateKey()).address;
  const orders = [
    { owner: a, aprBps: 1200, remainingUsdc: 30_000_000n },
    { owner: b, aprBps: 900, remainingUsdc: 2_000_000n },
    { owner: c, aprBps: 1500, remainingUsdc: 10_000_000n },
  ];
  // 35 = 2 from the 9% desk, 30 from the 12% desk, 3 from the 15% desk.
  const all = fill(35_000_000n, orders);
  assert.deepEqual(all.pieces.map((p) => [p.desk, p.principalUsdc]), [[b, 2_000_000n], [a, 30_000_000n], [c, 3_000_000n]]);
  assert.equal(all.unfilledUsdc, 0n);
  // Only the desks the borrower ticked; what they cannot cover is reported.
  const picked = fill(35_000_000n, orders, [a]);
  assert.deepEqual(picked.pieces.map((p) => p.principalUsdc), [30_000_000n]);
  assert.equal(picked.unfilledUsdc, 5_000_000n);
  // Same rate: the larger order first, so fewer loans.
  const tie = fill(5_000_000n, [{ owner: a, aprBps: 1000, remainingUsdc: 1_000_000n }, { owner: b, aprBps: 1000, remainingUsdc: 8_000_000n }]);
  assert.deepEqual(tie.pieces.map((p) => p.desk), [b]);
});

test("operator list: a guardian registers with its own signature and stays online with signed heartbeats", async () => {
  const { ONLINE_MS } = await import("../src/loanbook");
  const store = new LoanStore(":memory:");
  const key = generatePrivateKey();
  const me = privateKeyToAccount(key);
  const info = { address: me.address, name: "Guardian C", operator: "Another operator", feeBps: 10, code: "b".repeat(64), at: Date.now() };
  const other = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(handle(store, "POST", "/guardians", { info, sig: await other.signMessage({ message: message("guardian", info.address, info, "guardian") }) }), /signature/);
  await handle(store, "POST", "/guardians", { info, sig: await me.signMessage({ message: message("guardian", info.address, info, "guardian") }) });
  const at = Date.now();
  await assert.rejects(handle(store, "POST", "/guardians/heartbeat", { address: me.address, at, sig: await other.signMessage({ message: message("heartbeat", me.address, { at }, "guardian") }) }), /signature/);
  await handle(store, "POST", "/guardians/heartbeat", { address: me.address, at, sig: await me.signMessage({ message: message("heartbeat", me.address, { at }, "guardian") }) });
  const old = at - 10 * 60_000;
  await assert.rejects(handle(store, "POST", "/guardians/heartbeat", { address: me.address, at: old, sig: await me.signMessage({ message: message("heartbeat", me.address, { at: old }, "guardian") }) }), /too old/);
  const listed = (await handle(store, "GET", "/guardians", {})) as { info: { name: string }; lastSeen: number }[];
  assert.equal(listed[0].info.name, "Guardian C");
  assert.ok(Date.now() - listed[0].lastSeen < ONLINE_MS);
});
