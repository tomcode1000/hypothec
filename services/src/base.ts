// Base Sepolia: the HypothecLoans contract and USDC, as seen by one role.
import {
  createPublicClient, createWalletClient, fallback, http, erc20Abi,
  type Abi, type Address, type Hash, type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { baseKey, EXPLORER, LOANS, LOANS_ABI, USDC, type BaseWallet } from "./config";

// The public RPC sometimes takes more than viem's default 10 s to answer; a resent signed
// transaction has the same hash, so retrying a send cannot pay twice.
// Two public RPC providers: when one stops answering, calls go to the other.
const rpc = fallback([
  http(process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org", { timeout: 30_000, retryCount: 3 }),
  http("https://base-sepolia-rpc.publicnode.com", { timeout: 30_000, retryCount: 3 }),
]);
export const pub = createPublicClient({ chain: baseSepolia, transport: rpc });

export const STATUS = ["None", "Offered", "Accepted", "Funded", "Active", "Repaid", "Liquidated", "Cancelled"] as const;
export type LoanStatus = (typeof STATUS)[number];

export interface OnchainLoan {
  lender: Address;
  borrower: Address;
  refereeA: Address;
  refereeB: Address;
  repayTo: Address;
  payoutTo: Address;
  principal: bigint;
  owed: bigint;
  repaid: bigint;
  dueAt: bigint;
  lockBy: bigint;
  status: number;
  lockA: boolean;
  lockB: boolean;
  liqA: boolean;
  liqB: boolean;
}

/// The public RPC is a pool of nodes that can lag a block: retry reads and simulations.
export async function retry<T>(f: () => Promise<T>, tries = 10): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export async function getLoan(id: Hex): Promise<OnchainLoan & { statusName: LoanStatus }> {
  const l = (await retry(() => pub.readContract({ address: LOANS, abi: LOANS_ABI, functionName: "getLoan", args: [id] }))) as OnchainLoan;
  return { ...l, statusName: STATUS[l.status] };
}

/// What funding a loan takes from the lender: the principal and both guardians' fees.
export async function fundingAmount(id: Hex): Promise<bigint> {
  return (await retry(() => pub.readContract({ address: LOANS, abi: LOANS_ABI, functionName: "fundingAmount", args: [id] }))) as bigint;
}

/// Base's own clock (the latest block's time, in seconds): what the contract's deadlines are
/// judged by, whatever this machine's clock says.
export async function chainNow(): Promise<number> {
  return Number((await retry(() => pub.getBlock({ blockTag: "latest" }))).timestamp);
}

export async function isOverdue(id: Hex): Promise<boolean> {
  return (await retry(() => pub.readContract({ address: LOANS, abi: LOANS_ABI, functionName: "isOverdue", args: [id] }))) as boolean;
}

export async function usdcBalance(a: Address): Promise<bigint> {
  return retry(() => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] }));
}

/// A role's write access: checks each call against the chain first, sends with a fixed gas
/// limit, waits for success and returns the explorer link.
export function baseAs(role: BaseWallet) {
  const w = createWalletClient({ chain: baseSepolia, transport: rpc, account: privateKeyToAccount(baseKey(role), { nonceManager }) });
  async function call(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { request } = await retry(() => pub.simulateContract({ address, abi, functionName, args, account: w.account } as any));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash: Hash = await w.writeContract({ ...(request as any), gas: 300_000n });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} failed: ${EXPLORER}/tx/${hash}`);
    return `${EXPLORER}/tx/${hash}`;
  }
  return {
    address: w.account.address,
    loans: (fn: string, args: readonly unknown[]) => call(LOANS, LOANS_ABI, fn, args),
    approveUsdc: (amount: bigint) => call(USDC, erc20Abi as Abi, "approve", [LOANS, amount]),
    signMessage: (message: string) => w.signMessage({ message }),
  };
}
