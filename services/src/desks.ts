// Lending desks (docs/DECISIONS.md D14). Anyone with a Base wallet can open a desk: it
// publishes its terms, signed with that wallet, and lends from it. Borrowers pick a desk
// from the list. One desk per wallet; publishing again replaces its terms for new loans
// (a loan keeps the terms signed into its offer). Units as in policy.ts.
import type { Address } from "viem";
import type { Fields } from "./sign";

/// What a desk publishes and signs (kind "desk", id = its owner's address).
export interface DeskTerms extends Fields {
  owner: Address;
  name: string;
  aprBps: number;
  /// Loan length. Short terms (minutes) exist for testing the deadline rule.
  termSeconds: number;
  startLtvBps: number;
  marginLtvBps: number;
  liquidationLtvBps: number;
  slippageBps: number;
  /// The order: how much this desk lends in all, in USDC base units. Borrowers fill
  /// against what is left of it (this minus its open loans).
  maxUsdc: number;
  /// The desk's Zcash address for liquidation shares, signed into every offer it posts.
  lenderZec: string;
  /// The two guardians from the operator list this desk works with; every offer names
  /// them and the borrower sees them before accepting.
  guardianA: Address;
  guardianB: Address;
  at: number;
}

export interface Desk {
  terms: DeskTerms;
  sig: `0x${string}`;
}

export const MIN_TERM_SECONDS = 600;
export const MAX_TERM_SECONDS = 365 * 86_400;
const DAY = 86_400;

/// Why these terms cannot be published, or null if they can.
export function checkDesk(t: DeskTerms, zecAddress: RegExp): string | null {
  if (!/^[\w .,'&-]{1,32}$/.test(t.name)) return "name: 1 to 32 letters, digits or spaces";
  const ints = ["aprBps", "termSeconds", "startLtvBps", "marginLtvBps", "liquidationLtvBps", "slippageBps", "maxUsdc", "at"] as const;
  for (const k of ints) if (!Number.isSafeInteger(t[k]) || t[k] < 0) return `${k} must be a whole number`;
  if (t.aprBps > 10_000) return "rate must be at most 100% APR";
  if (t.maxUsdc < 100_000 || t.maxUsdc > 1_000_000_000_000) return "order must be between 0.1 and 1,000,000 USDC";
  if (t.termSeconds < MIN_TERM_SECONDS || t.termSeconds > MAX_TERM_SECONDS) return "term must be between 10 minutes and 365 days";
  if (!(t.startLtvBps >= 1000 && t.startLtvBps < t.marginLtvBps)) return "start LTV must be at least 10% and below the margin-call LTV";
  if (!(t.marginLtvBps < t.liquidationLtvBps)) return "margin-call LTV must be below the liquidation LTV";
  // At the liquidation line the vault must still cover the debt plus the price buffer, or
  // there would be no surplus to return even when liquidating on time.
  if (t.liquidationLtvBps * (10_000 + t.slippageBps) >= 10_000 * 9_500) return "liquidation LTV plus the price buffer must stay below 95%";
  if (t.slippageBps > 1000) return "price buffer must be at most 10%";
  if (!zecAddress.test(t.lenderZec)) return "the desk's ZEC address is not a shielded address on this chain";
  const hex = /^0x[0-9a-fA-F]{40}$/;
  if (!hex.test(String(t.guardianA)) || !hex.test(String(t.guardianB))) return "pick two guardians";
  const [a, b, o] = [t.guardianA, t.guardianB, t.owner].map((x) => String(x).toLowerCase());
  if (a === b) return "the two guardians must be different operators";
  if (a === o || b === o) return "a desk cannot be its own guardian";
  return null;
}

/// The lock deadline: a day, or half the term for a short test loan (the contract needs
/// lockBy < dueAt).
export const lockWindow = (termSeconds: number) => Math.min(DAY, Math.floor(termSeconds / 2));

/// Terms for a requested amount: owe = principal x (1 + APR x term), collateral sized at
/// the desk's start LTV.
export function quote(principalUsdc: bigint, priceUsd: number, d: Pick<DeskTerms, "aprBps" | "termSeconds" | "startLtvBps">) {
  const owed = principalUsdc + (principalUsdc * BigInt(d.aprBps) * BigInt(d.termSeconds)) / (10_000n * 365n * BigInt(DAY));
  const collateralZat = (principalUsdc * 100_000_000n * 10_000n) / (BigInt(d.startLtvBps) * BigInt(Math.round(priceUsd * 1e6)));
  return { principalUsdc, owedUsdc: owed, collateralZat };
}

/// ZEC to add so the loan is back at the desk's start LTV at this price (0 if it already is).
export function topUpToStartZat(owedUsdc: bigint, vaultZat: bigint, priceMicroUsd: bigint, startLtvBps: bigint): bigint {
  const needed = (owedUsdc * 100_000_000n * 10_000n + startLtvBps * priceMicroUsd - 1n) / (startLtvBps * priceMicroUsd);
  return needed > vaultZat ? needed - vaultZat : 0n;
}

/// The terms the demo's test lender publishes (flow.ts, and the desk page's "use the test
/// desk's terms"): the numbers Desk A had before desks were open (D6).
export const DEMO_TERMS = {
  name: "Desk A",
  aprBps: 1200,
  termSeconds: 90 * DAY,
  startLtvBps: 5000,
  marginLtvBps: 6500,
  liquidationLtvBps: 7500,
  slippageBps: 200,
  maxUsdc: 10_000_000,
};

/// One borrow split across desks: each piece becomes its own loan with its own vault,
/// on that desk's terms (D16).
export interface Piece {
  desk: Address;
  principalUsdc: bigint;
}

/// Fills `amount` from the orders on offer, cheapest rate first (then the larger order, so
/// fewer loans). Only `pick` desks if given. Returns the pieces and what could not be filled.
export function fill(amount: bigint, orders: { owner: Address; aprBps: number; remainingUsdc: bigint }[], pick?: Address[]) {
  const allowed = pick?.map((a) => a.toLowerCase());
  const sorted = orders
    .filter((o) => o.remainingUsdc > 0n && (!allowed || allowed.includes(o.owner.toLowerCase())))
    .sort((a, b) => a.aprBps - b.aprBps || (b.remainingUsdc > a.remainingUsdc ? 1 : b.remainingUsdc < a.remainingUsdc ? -1 : 0));
  const pieces: Piece[] = [];
  let left = amount;
  for (const o of sorted) {
    if (left <= 0n) break;
    const take = o.remainingUsdc < left ? o.remainingUsdc : left;
    pieces.push({ desk: o.owner, principalUsdc: take });
    left -= take;
  }
  return { pieces, unfilledUsdc: left };
}
