// The referees' rules (BRIEF sections 3-5), as pure functions. Units: zatoshi (1e-8 ZEC),
// USDC in micro-units (6 decimals), prices in micro-dollars per ZEC.
import type { Output } from "./party";

/// The most fee a vault spend may burn; outputs must account for everything else.
export const MAX_FEE_ZAT = 50_000n;
const ZAT_PER_ZEC = 100_000_000n;

/// What the lender signed (loanbook "offer") plus what the borrower added ("accept").
export interface Terms {
  owedUsdc: bigint; // principal + interest + fees
  collateralZat: bigint;
  marginLtvBps: bigint; // e.g. 6500 = 65%
  liquidationLtvBps: bigint; // e.g. 7500
  slippageBps: bigint; // buffer on the lender's share, e.g. 200 = 2%
  lenderZec: string;
  borrowerZec: string;
}

/// Loan-to-value in basis points: debt / (collateral x price).
export function ltvBps(owedUsdc: bigint, collateralZat: bigint, priceMicroUsd: bigint): bigint {
  const valueMicroUsd = (collateralZat * priceMicroUsd) / ZAT_PER_ZEC;
  if (valueMicroUsd === 0n) return 10n ** 9n;
  return (owedUsdc * 10_000n) / valueMicroUsd;
}

/// ZEC owed to the lender at a price: debt / price x (1 + slippage), rounded up.
export function lenderShareZat(owedUsdc: bigint, priceMicroUsd: bigint, slippageBps: bigint): bigint {
  const num = owedUsdc * ZAT_PER_ZEC * (10_000n + slippageBps);
  const den = priceMicroUsd * 10_000n;
  return (num + den - 1n) / den;
}

/// Why a liquidation is allowed now, or null if it is not.
export function liquidationReason(t: Terms, vaultZat: bigint, priceMicroUsd: bigint, overdue: boolean): string | null {
  if (overdue) return "deadline passed (contract isOverdue)";
  const ltv = ltvBps(t.owedUsdc, vaultZat, priceMicroUsd);
  if (ltv >= t.liquidationLtvBps) return `LTV ${Number(ltv) / 100}% >= ${Number(t.liquidationLtvBps) / 100}%`;
  return null;
}

/// A release after repayment: everything (less the fee) to the borrower's registered
/// address, in one output. Returns why it is refused, or null if it is fine.
export function checkRelease(outputs: Output[], t: Terms, vaultZat: bigint): string | null {
  if (outputs.length !== 1) return `release must have exactly 1 output, has ${outputs.length}`;
  const [o] = outputs;
  if (o.address !== t.borrowerZec) return "release must go to the borrower's registered address";
  const amount = BigInt(o.amount_zat);
  if (amount > vaultZat) return "release pays more than the vault holds";
  if (amount < vaultZat - MAX_FEE_ZAT) return "release must return everything but the fee to the borrower";
  return null;
}

/// A liquidation: at most the lender's computed share to the lender's registered address,
/// everything else (less the fee) to the borrower's registered address, in ONE transaction.
export function checkLiquidation(outputs: Output[], t: Terms, vaultZat: bigint, priceMicroUsd: bigint): string | null {
  const maxLender = lenderShareZat(t.owedUsdc, priceMicroUsd, t.slippageBps);
  const lender = outputs.filter((o) => o.address === t.lenderZec);
  const borrower = outputs.filter((o) => o.address === t.borrowerZec);
  if (lender.length !== 1) return "liquidation must pay the lender's registered address exactly once";
  if (lender.length + borrower.length !== outputs.length) return "liquidation pays an address that is neither party's registered address";
  if (borrower.length > 1) return "liquidation must pay the borrower at most once";
  const toLender = BigInt(lender[0].amount_zat);
  const toBorrower = borrower.length ? BigInt(borrower[0].amount_zat) : 0n;
  if (toLender > maxLender) return `lender share ${toLender} zat exceeds what is owed (${maxLender} zat at this price)`;
  if (toLender + toBorrower > vaultZat) return "liquidation pays more than the vault holds";
  if (toLender + toBorrower < vaultZat - MAX_FEE_ZAT) {
    return "liquidation must return the surplus to the borrower in the same transaction";
  }
  return null;
}
