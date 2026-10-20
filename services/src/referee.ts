// A referee: a rules engine, not a person (BRIEF 4c). It watches the loanbook, the Base
// contract and the vault through its OWN party service, and signs only what the published
// rules allow:
//   - lock: the lender funded on Base and this referee sees the full collateral in the right
//     vault (3-of-4, the loanbook's address) -> confirmLock on Base (pays the borrower)
//   - release: Base says Repaid and the spend pays everything but the fee to the borrower's
//     signed payout address -> approve (BRIEF 4b)
//   - liquidation: the price rule is met (1h average, 3 exchanges) or the contract says the
//     loan is overdue, and the spend pays the lender at most what it is owed and the surplus
//     to the borrower in the same transaction -> approve (BRIEF 4a); once broadcast,
//     confirmLiquidation on Base
// Every decision goes to the loanbook as a signed log entry with its evidence.
import type { Hex } from "viem";
import { baseAs, getLoan, isOverdue } from "./base";
import { BASE_ADDRESS, type Role } from "./config";
import { offerDigest, type LoanbookClient, type LoanDoc } from "./loanbook";
import { partyFor, type Spend } from "./party";
import { checkLiquidation, checkRelease, liquidationReason, type Terms } from "./policy";
import { zecPrice } from "./price";
import { message, verify, type Fields } from "./sign";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

/// A fingerprint of the rules this guardian runs: sha256 of its rules engine and rule
/// functions, published in the operator list so anyone can compare it with the source.
export function codeFingerprint(): string {
  const h = createHash("sha256");
  for (const f of ["referee.ts", "policy.ts", "price.ts"]) h.update(readFileSync(join(__dirname, f)));
  return h.digest("hex");
}

const NAMES = { refereeA: "Guardian A", refereeB: "Guardian B" } as const;

export function termsOf(doc: LoanDoc): Terms {
  return {
    owedUsdc: BigInt(doc.offer.owedUsdc),
    collateralZat: BigInt(doc.offer.collateralZat),
    marginLtvBps: BigInt(doc.offer.marginLtvBps),
    liquidationLtvBps: BigInt(doc.offer.liquidationLtvBps),
    slippageBps: BigInt(doc.offer.slippageBps),
    lenderZec: doc.offer.lenderZec,
    borrowerZec: doc.accept!.borrowerZec,
  };
}

/// Both parties' signatures hold, and the accept refers to this exact offer.
export async function signaturesHold(doc: LoanDoc): Promise<boolean> {
  if (!doc.accept || !doc.borrowerSig) return false;
  if (doc.accept.offerDigest !== offerDigest(doc.id, doc.offer)) return false;
  return (
    (await verify(doc.offer.lender, "offer", doc.id, doc.offer, doc.lenderSig)) &&
    (await verify(doc.offer.borrower, "accept", doc.id, doc.accept, doc.borrowerSig))
  );
}

export function startReferee(role: "refereeA" | "refereeB", loanbook: LoanbookClient, intervalMs = 3000) {
  const me = BASE_ADDRESS[role];
  const base = baseAs(role as Role);
  const lockConfirmed = new Set<string>();
  const approved = new Map<string, "release" | "liquidation">();
  const liquidationRecorded = new Set<string>();
  const lastNote = new Map<string, string>();
  const say = (s: string) => console.log(`[${role}] ${s}`);

  // On the operator list: register (signed) and keep a signed heartbeat going.
  const register = async () => {
    const info = { address: me, name: NAMES[role], operator: process.env.HYPOTHEC_OPERATOR ?? "Hypothec team (demo)", feeBps: 10, code: codeFingerprint(), at: Date.now() };
    await loanbook.registerGuardian(info, await base.signMessage(message("guardian", me, info, "guardian")));
    say(`on the operator list, code ${info.code.slice(0, 12)}`);
  };
  const beat = async () => {
    const at = Date.now();
    await loanbook.heartbeat(me, at, await base.signMessage(message("heartbeat", me, { at }, "guardian"))).catch(async (e) => {
      if (/no such guardian/.test(String(e))) await register().catch(() => undefined);
    });
  };
  register().catch((e) => say(`could not register yet: ${(e as Error).message}`));
  setInterval(beat, 30_000);

  async function log(loan: Hex, kind: string, data: Fields) {
    const sig = await base.signMessage(message(`log:${kind}`, loan, data));
    await loanbook.event(loan, { actor: role, kind, data, sig });
  }
  /// Logs a refusal or a wait once per (subject, reason), not on every tick.
  async function noteOnce(loan: Hex, subject: string, kind: string, reason: string, data: Fields = {}) {
    if (lastNote.get(subject) === reason) return;
    lastNote.set(subject, reason);
    say(`${kind} ${subject}: ${reason}`);
    await log(loan, kind, { subject, reason, ...data });
  }

  async function review(doc: LoanDoc) {
    const id = doc.id;
    if (doc.offer.refereeA !== me && doc.offer.refereeB !== me) return;
    if (!doc.accept || !doc.vault) return;
    if (!(await signaturesHold(doc))) return noteOnce(id, id, "refuse", "lender or borrower signature does not hold");
    const terms = termsOf(doc);
    const onchain = await getLoan(id);
    // This referee's own key share for this loan (its party host keeps one per loan).
    // This guardian's seat on this loan: the desk names its two guardians, A and B.
    const seat: Role = doc.offer.refereeA === me ? "refereeA" : "refereeB";
    const party = await partyFor(id, seat);

    let vault;
    try {
      vault = await party.vault();
    } catch {
      return; // this referee's key setup has not finished yet
    }
    if (vault.address !== doc.vault.address || vault.threshold !== 3 || vault.members !== 4) {
      return noteOnce(id, id, "refuse", "the loanbook's vault is not this referee's 3-of-4 vault");
    }
    const balance = await party.balance();
    const vaultZat = BigInt(balance.total_zat);

    // 1. Lock
    const mine = doc.offer.refereeA === me ? onchain.lockA : onchain.lockB;
    if (onchain.statusName === "Funded" && !mine && !lockConfirmed.has(id)) {
      if (BigInt(balance.spendable_zat) >= terms.collateralZat) {
        const tx = await base.loans("confirmLock", [id]);
        lockConfirmed.add(id);
        say(`lock confirmed: ${balance.spendable_zat} zat in the vault, ${tx}`);
        await log(id, "lock-confirmed", { vaultZat: balance.spendable_zat, required: doc.offer.collateralZat, tx });
      } else {
        await noteOnce(id, `${id}:lock`, "waiting", `vault has ${balance.spendable_zat} of ${doc.offer.collateralZat} zat`);
      }
    }

    // 2. Spends proposed in the vault
    const spends: Spend[] = await party.spends();
    for (const s of spends) {
      if (s.status !== "Open" || approved.has(s.id)) continue;
      let kind: "release" | "liquidation";
      let reason: string | null;
      let evidence: Fields = {};
      if (onchain.statusName === "Repaid" || onchain.statusName === "Cancelled") {
        // Repaid, or cancelled (the lock never completed and the desk took its USDC back):
        // either way the ZEC is the borrower's, and goes only to its signed address.
        kind = "release";
        reason = checkRelease(s.outputs, terms, vaultZat);
        evidence = onchain.statusName === "Repaid"
          ? { rule: "repaid on Base", repaidUsdc: onchain.repaid.toString() }
          : { rule: "cancelled on Base: no USDC was paid out to the borrower" };
      } else if (onchain.statusName === "Active") {
        kind = "liquidation";
        const price = await zecPrice().catch((e) => e as Error);
        if (price instanceof Error) {
          await noteOnce(id, s.id, "refuse", `no price (need all 3 feeds): ${price.message}`);
          continue;
        }
        const overdue = await isOverdue(id);
        const why = liquidationReason(terms, vaultZat, price.microUsd, overdue);
        evidence = { priceUsd: Number(price.microUsd) / 1e6, priceSource: price.source, ...price.detail, rule: why ?? "none" };
        reason = why === null ? "no liquidation rule is met at this price" : checkLiquidation(s.outputs, terms, vaultZat, price.microUsd);
      } else {
        await noteOnce(id, s.id, "refuse", `loan is ${onchain.statusName} on Base`);
        continue;
      }
      if (reason !== null) {
        await noteOnce(id, s.id, "refuse", `${kind}: ${reason}`, evidence);
        continue;
      }
      const a = await party.approve(s.id);
      approved.set(s.id, kind);
      say(`approved ${kind} ${s.id} (fee ${a.fee_zat} zat)`);
      await log(id, `approve-${kind}`, { spend: s.id, feeZat: a.fee_zat, ...evidence });
    }

    // 3. After a liquidation this referee approved is broadcast, record it on Base.
    if (onchain.statusName === "Active" && !liquidationRecorded.has(id)) {
      const done = spends.find((s) => s.txid && approved.get(s.id) === "liquidation");
      if (done) {
        const tx = await base.loans("confirmLiquidation", [id]);
        liquidationRecorded.add(id);
        say(`liquidation recorded on Base: ${tx}`);
        await log(id, "liquidation-recorded", { zcashTx: done.txid!, tx });
      }
    }
  }

  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const doc of await loanbook.all()) {
        await review(doc).catch((e) => say(`error on ${doc.id}: ${(e as Error).message}`));
      }
    } catch (e) {
      say(`loanbook unreachable: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }, intervalMs);
  say(`running as ${me}`);
  return () => clearInterval(timer);
}
