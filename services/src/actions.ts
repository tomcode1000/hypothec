// The borrower's and the lender's actions, shared by the web API (api.ts) and the scripted
// run (flow.ts). Nothing here decides for a referee: the referees run on their own
// (serve.ts) and act only through their own keys and rules.
import { formatUnits, keccak256, toHex, type Hex } from "viem";
import { baseAs, getLoan, usdcBalance } from "./base";
import { BASE_ADDRESS, baseAddress, CONTROL_URL, LOANBOOK_URL, LOANS, PRICE_OVERRIDE_FILE, ROLES, TEST_ZEC_ADDRESS, type Role } from "./config";
import { DEMO_TERMS, lockWindow, quote, type DeskTerms } from "./desks";
import { LoanbookClient, offerDigest, type Accept, type LoanDoc, type Offer } from "./loanbook";
import { partyFor, type Party, type Output } from "./party";
import { lenderShareZat, MAX_FEE_ZAT } from "./policy";
import { zecPrice } from "./price";
import { message } from "./sign";
import { ZEC_NETWORK } from "./zec";
import { existsSync, rmSync, writeFileSync } from "fs";

export const loanbook = new LoanbookClient(LOANBOOK_URL);
const borrower = baseAs("borrower");
/// The test lenders the scripted runs act as: two, so a borrow can be split (D16).
export type TestLender = "lender" | "lender2";
/// Which test lender a desk's wallet is, if this process holds its key (desk agents, D18).
export const testLenderOf = (owner: string): TestLender | null =>
  (["lender", "lender2"] as const).find((w) => baseAddress(w).toLowerCase() === owner.toLowerCase()) ?? null;
const lenders = { lender: baseAs("lender"), lender2: baseAs("lender2") };

/// The price a desk sizes collateral at: the referees' own feed (1h average, 3
/// exchanges), so the borrower is quoted on the number that will judge the loan.
/// An exchange that times out once should not fail a whole offer: try a few times.
export async function sizingPriceUsd(): Promise<number> {
  for (let i = 1; ; i++) {
    try {
      return Number((await zecPrice()).microUsd) / 1e6;
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function control(path: string, body: unknown) {
  const res = await fetch(CONTROL_URL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok?: boolean; error?: string; err?: string };
  if (!res.ok || !json.ok) throw new Error(`control ${path}: ${json.error ?? json.err}`);
}
export const mine = (blocks: number) => control("/mine", { blocks });

/// Testnet confirms in minutes, not the second a regtest block takes: waits stretch.
const PATIENCE = ZEC_NETWORK === "test" ? 10 : 1;

export async function until<T>(what: string, f: () => Promise<T | undefined | false>, timeoutMs = 300_000, every = 3000): Promise<T> {
  const end = Date.now() + timeoutMs * PATIENCE;
  for (;;) {
    const v = await f().catch(() => undefined);
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

/// A desk's offer for a request, on that desk's published terms: the loanbook entry it
/// signs and the terms it posts on Base (amounts as decimal strings, for the browser
/// wallet). Sized at the live price.
export async function buildOffer(principalUsdc: bigint, desk: DeskTerms, borrowerAddr: Hex) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const id = keccak256(toHex(`hypothec-${now}-${principalUsdc}-${borrowerAddr}`)) as Hex;
  const q = quote(principalUsdc, await sizingPriceUsd(), desk);
  const offer: Offer = {
    contract: LOANS,
    lender: desk.owner,
    borrower: borrowerAddr,
    refereeA: BASE_ADDRESS.refereeA,
    refereeB: BASE_ADDRESS.refereeB,
    principalUsdc: q.principalUsdc.toString(),
    owedUsdc: q.owedUsdc.toString(),
    dueAt: Number(now) + desk.termSeconds,
    lockBy: Number(now) + lockWindow(desk.termSeconds),
    collateralZat: q.collateralZat.toString(),
    marginLtvBps: desk.marginLtvBps,
    liquidationLtvBps: desk.liquidationLtvBps,
    slippageBps: desk.slippageBps,
    lenderZec: desk.lenderZec,
  };
  const terms = {
    borrower: offer.borrower, refereeA: offer.refereeA, refereeB: offer.refereeB, repayTo: offer.lender,
    principal: offer.principalUsdc, owed: offer.owedUsdc, dueAt: String(offer.dueAt), lockBy: String(offer.lockBy),
  };
  return { id, offer, terms };
}

/// Test runs: a test lender opens its desk, signed with its test key. Overrides let a run
/// use a short term (the deadline path) or a second desk's own terms.
export async function openTestDesk(over: Partial<typeof DEMO_TERMS> = {}, who: TestLender = "lender") {
  const terms: DeskTerms = { ...DEMO_TERMS, ...over, owner: baseAddress(who), lenderZec: TEST_ZEC_ADDRESS[who], at: Date.now() };
  const sig = await lenders[who].signMessage(message("desk", terms.owner, terms, "desk"));
  return (await loanbook.openDesk(terms, sig)).terms;
}

/// Scripted runs (flow.ts): a test desk's offer signed with its test lender key.
export async function lenderOffer(principalUsdc: bigint, desk: DeskTerms, who: TestLender = "lender", basket?: string, borrowerAddr: Hex = BASE_ADDRESS.borrower) {
  const lender = lenders[who];
  const { id, offer, terms } = await buildOffer(principalUsdc, desk, borrowerAddr);
  const tx = await lender.loans("offer", [id, {
    ...terms, principal: BigInt(terms.principal), owed: BigInt(terms.owed), dueAt: BigInt(terms.dueAt), lockBy: BigInt(terms.lockBy),
  }]);
  await loanbook.offer(id, offer, await lender.signMessage(message("offer", id, offer)), basket);
  return { id, offer, tx };
}

/// Scripted runs (flow.ts): the borrower accepts with the test borrower key and the test
/// wallet's ZEC address. The web app has the borrower's own wallet do this.
export async function borrowerAccept(id: Hex, offer: Offer, payoutTo: Hex = BASE_ADDRESS.borrower) {
  const tx = await borrower.loans("accept", [id, payoutTo]);
  const accept: Accept = { offerDigest: offerDigest(id, offer), borrowerZec: TEST_ZEC_ADDRESS.borrower };
  await loanbook.accept(id, accept, await borrower.signMessage(message("accept", id, accept)));
  return { tx };
}

/// The four parties' apps run the DKG together. In the demo they all run on one machine.
/// Each stage goes to the loan's log, so the screens can show the vault being made:
/// the borrower opens it, the desk and both guardians join, all four see the same safety
/// number, then each makes its share of one key (the whole key never exists anywhere).
export async function keySetup(id: Hex) {
  const note = (actor: string, kind: string, data: Record<string, string | number> = {}) =>
    loanbook.event(id, { actor, kind, data }).catch(() => undefined);
  const party = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await partyFor(id, r)]))) as Record<Role, Party>;
  for (const r of ROLES) await party[r].identity().catch(() => undefined); // exists after a restart
  const { invite } = await party.borrower.createVault(`Loan ${id.slice(0, 10)}`, 3, 4);
  await note("borrower", "vault-open");
  for (const r of ["lender", "refereeA", "refereeB"] as Role[]) {
    await party[r].join(invite);
    await note(r, "vault-join");
  }
  await party.borrower.seal();
  const safety = await Promise.all(ROLES.map(async (r) => (await party[r].members()).safety_number));
  if (new Set(safety).size !== 1) throw new Error(`safety numbers differ: ${safety}`);
  await note("borrower", "safety-number", { number: safety[0] });
  const vaults = await Promise.all(ROLES.map((r, i) => party[r].keygen(safety[i])));
  const vault = vaults[0].address;
  if (vaults.some((v) => v.address !== vault)) throw new Error("parties derived different vaults");
  await loanbook.vault(id, vault, invite);
  return { vault, safetyNumber: safety[0] };
}

export async function lenderFund(id: Hex, principalUsdc: bigint, who: TestLender = "lender") {
  const lender = lenders[who];
  const approve = await lender.approveUsdc(principalUsdc);
  const tx = await lender.loans("fund", [id]);
  await loanbook.event(id, { actor: "lender", kind: "funded", data: { status: "Funded" } });
  return { approve, tx };
}

/// The test wallet sends the collateral to the vault (regtest faucet, or the testnet test
/// wallet), standing in for the borrower's own Zcash wallet.
export async function lockFromTestWallet(id: Hex, vault: string, collateralZat: bigint) {
  return (await lockManyFromTestWallet([{ id, vault, zat: collateralZat }]))[0];
}

/// Locks several loans of one borrow at once, standing in for the borrower's wallet. A real
/// wallet pays all the vaults in one transaction from a ZIP 321 request (one output per
/// vault); so does the testnet test wallet. The regtest faucet sends one payment per vault,
/// then the blocks are mined together.
export async function lockManyFromTestWallet(locks: { id: Hex; vault: string; zat: bigint }[]) {
  await control("/fund", { payments: locks.map((l) => ({ address: l.vault, zec: Number(l.zat) / 1e8 })) });
  await mine(12);
  const out = [];
  for (const l of locks) {
    const p = await partyFor(l.id, "borrower");
    out.push(await until(`the lock of ${l.id.slice(0, 10)} to be spendable`, async () => {
      const b = await p.balance();
      if (BigInt(b.spendable_zat) >= l.zat) return b;
      await mine(1);
    }));
  }
  return out;
}

/// The test wallet adds collateral to a running loan's vault, standing in for the
/// borrower's wallet. The referees judge the loan on the vault's live balance, so a
/// top-up lowers the LTV the moment it is confirmed; nobody has to sign anything.
export async function topUpFromTestWallet(id: Hex, vault: string, zat: bigint) {
  const borrower = await partyFor(id, "borrower");
  const before = BigInt((await borrower.balance()).total_zat);
  await control("/fund", { address: vault, zec: Number(zat) / 1e8 });
  await mine(12);
  const after = await until("the top-up to be spendable", async () => {
    const b = await borrower.balance();
    if (BigInt(b.spendable_zat) >= before + zat) return b;
    await mine(1);
  });
  await loanbook.event(id, { actor: "borrower", kind: "top-up", data: { zat: zat.toString(), vaultZat: String(after.total_zat) } });
  return after;
}

export async function borrowerRepay(id: Hex, owedUsdc: bigint) {
  const approve = await borrower.approveUsdc(owedUsdc);
  const tx = await borrower.loans("repay", [id, owedUsdc]);
  await until("the contract to show Repaid", async () => (await getLoan(id)).statusName === "Repaid", 120_000, 2000);
  return { approve, tx };
}

/// Proposes outputs paying `rest` everything left after `fixed` and the fee. The wallet
/// computes the fee; if the first guess is short, its InsufficientFunds error says by how much.
export async function proposeAll(p: Party, fixed: Output[], restAddress: string, total: bigint, memo: string) {
  let fee = 10_000n;
  const fixedSum = fixed.reduce((s, o) => s + BigInt(o.amount_zat), 0n);
  for (let i = 0; i < 4; i++) {
    try {
      const outputs = [...fixed, { address: restAddress, amount_zat: Number(total - fixedSum - fee) }];
      const { id } = await p.propose(outputs, memo);
      return { id, outputs, fee };
    } catch (e) {
      const m = /available: Zatoshis\((\d+)\), required: Zatoshis\((\d+)\)/.exec((e as Error).message);
      if (!m) throw e;
      fee += BigInt(m[2]) - BigInt(m[1]);
    }
  }
  throw new Error("could not settle the fee");
}

async function approvedAndSent(p: Party, spendId: string) {
  await p.approve(spendId);
  await until(`3 approvals on ${spendId}`, async () => {
    const s = (await p.spends()).find((x) => x.id === spendId);
    return s && s.approvals >= 3;
  });
  const { txid } = await p.send(spendId);
  await mine(2);
  await until("the vault to be empty", async () => (await p.balance()).total_zat === 0);
  return txid;
}

/// Borrower: ask for the ZEC back to the registered address. Waits for the referees.
export async function borrowerRelease(id: Hex) {
  const doc = await loanbook.get(id);
  if (!doc.accept) throw new Error("the loan has no accepted payout address");
  const borrower = await partyFor(id, "borrower");
  const total = BigInt((await borrower.balance()).total_zat);
  const spend = await proposeAll(borrower, [], doc.accept.borrowerZec, total, "Hypothec: released after repayment");
  const txid = await approvedAndSent(borrower, spend.id);
  await loanbook.event(id, { actor: "borrower", kind: "released", data: { status: "Released", zcashTx: txid } });
  return { txid, amountZat: spend.outputs[0].amount_zat, feeZat: Number(spend.fee) };
}

/// What a liquidation asks under the most the referees allow (see lenderLiquidate).
export const SHARE_MARGIN_BPS = 10n;

/// Lender: one transaction paying its share at this price and the surplus to the borrower.
/// Waits for the referees, then for them to record it on Base.
export async function lenderLiquidate(id: Hex, owedUsdc: bigint, priceMicroUsd: bigint) {
  const doc = await loanbook.get(id);
  if (!doc.accept) throw new Error("the loan has no accepted payout address");
  const lenderZec = doc.offer.lenderZec;
  const borrowerZec = doc.accept.borrowerZec;
  const lender = await partyFor(id, "lender");
  const total = BigInt((await lender.balance()).total_zat);
  // The referees check the share against the 1-hour average at the moment they look, which
  // drifts from the price this proposal was sized at. Asking 0.1% under the maximum keeps a
  // proposal valid through that drift; the difference goes to the borrower as surplus.
  const share = (lenderShareZat(owedUsdc, priceMicroUsd, BigInt(doc.offer.slippageBps)) * (10_000n - SHARE_MARGIN_BPS)) / 10_000n;
  // A price that fell straight through the line can leave the vault worth less than the
  // debt: then the lender takes everything (less the fee) and there is no surplus. The
  // referees' rule allows exactly that and nothing more (policy.checkLiquidation).
  const underwater = share + MAX_FEE_ZAT >= total;
  const spend = underwater
    ? await proposeAll(lender, [], lenderZec, total, "Hypothec: liquidation (no surplus)")
    : await proposeAll(lender, [{ address: lenderZec, amount_zat: Number(share) }], borrowerZec, total, "Hypothec: liquidation");
  const txid = await approvedAndSent(lender, spend.id);
  const result = {
    txid,
    lenderZat: underwater ? spend.outputs[0].amount_zat : Number(share),
    surplusZat: underwater ? 0 : spend.outputs[1].amount_zat,
    feeZat: Number(spend.fee),
  };
  await loanbook.event(id, { actor: "lender", kind: "liquidated", data: { status: "Liquidated", zcashTx: txid, lenderZat: result.lenderZat, surplusZat: result.surplusZat, feeZat: result.feeZat } });
  await until("the referees to record the liquidation on Base", async () => (await getLoan(id)).statusName === "Liquidated", 300_000, 4000);
  return result;
}

export function setPriceOverride(usd: number | null) {
  if (usd === null) {
    if (existsSync(PRICE_OVERRIDE_FILE)) rmSync(PRICE_OVERRIDE_FILE);
  } else {
    writeFileSync(PRICE_OVERRIDE_FILE, JSON.stringify({ usd, setBy: "lender desk demo control", at: new Date().toISOString() }));
  }
}

export async function borrowerUsdc() {
  return formatUnits(await usdcBalance(BASE_ADDRESS.borrower), 6);
}

export type { LoanDoc };
