// The dollar side (Base Sepolia or Robinhood Chain testnet, chains.ts): the HypothecLoans
// contract and its stablecoin, as seen by one role.
import {
  createPublicClient, createWalletClient, fallback, http, erc20Abi,
  type Abi, type Address, type Hash, type Hex,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { baseKey, EXPLORER, LOANS, LOANS_ABI, USDC, VAULT, VAULT_BLOCK, type BaseWallet } from "./config";
import vaultArtifact from "../../usdc/artifacts/contracts/vault/HypothecVault.sol/HypothecVault.json";

export const VAULT_ABI = vaultArtifact.abi as Abi;
import { CHAIN } from "./chains";

// The public RPC sometimes takes more than viem's default 10 s to answer; a resent signed
// transaction has the same hash, so retrying a send cannot pay twice.
// Public RPC providers in turn: when one stops answering, calls go to the next.
const rpc = fallback(CHAIN.rpcs.map((url) => http(url, { timeout: 30_000, retryCount: 3 })));
export const pub = createPublicClient({ chain: CHAIN.chain, transport: rpc });

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
  const w = createWalletClient({ chain: CHAIN.chain, transport: rpc, account: privateKeyToAccount(baseKey(role), { nonceManager }) });
  async function call(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { request } = await retry(() => pub.simulateContract({ address, abi, functionName, args, account: w.account } as any));
    // Gas as estimated, with room: a shielded payout inserts a note into the vault's tree
    // and a spend verifies a proof, both far above a plain transfer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const est = await retry(() => pub.estimateContractGas({ address, abi, functionName, args, account: w.account } as any)).catch(() => 300_000n);
    const gas = (est * 13n) / 10n + 20_000n;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash: Hash = await w.writeContract({ ...(request as any), gas });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} failed: ${EXPLORER}/tx/${hash}`);
    return `${EXPLORER}/tx/${hash}`;
  }
  return {
    address: w.account.address,
    loans: (fn: string, args: readonly unknown[]) => call(LOANS, LOANS_ABI, fn, args),
    vault: (fn: string, args: readonly unknown[]) => {
      if (!VAULT) throw new Error("no shielded vault on this chain");
      return call(VAULT, VAULT_ABI, fn, args);
    },
    approveUsdc: (amount: bigint) => call(USDC, erc20Abi as Abi, "approve", [LOANS, amount]),
    signMessage: (message: string) => w.signMessage({ message }),
  };
}

/*
  The vault's public record, for browsers: every note commitment in tree order and every spent
  nullifier. Read from the vault's events, in chunks from its deployment block, and kept: each
  call reads only the blocks since the last.
*/
const vaultSeen = { to: 0n, leaves: [] as string[], nullifiers: new Set<string>() };
const COMMIT_EVENT = { type: "event", name: "NewCommitment", inputs: [{ name: "commitment", type: "uint256", indexed: false }, { name: "index", type: "uint256", indexed: false }] } as const;
const NULLIFIER_EVENT = { type: "event", name: "NewNullifier", inputs: [{ name: "nullifier", type: "uint256", indexed: false }] } as const;
let vaultReading: Promise<void> | null = null;
export async function vaultRecord() {
  if (!VAULT) return null;
  vaultReading ??= (async () => {
    const head = await retry(() => pub.getBlockNumber());
    let from = vaultSeen.to ? vaultSeen.to + 1n : VAULT_BLOCK;
    while (from <= head) {
      const to = from + 4_999n < head ? from + 4_999n : head;
      const [commits, nulls] = await Promise.all([
        retry(() => pub.getLogs({ address: VAULT, event: COMMIT_EVENT, fromBlock: from, toBlock: to })),
        retry(() => pub.getLogs({ address: VAULT, event: NULLIFIER_EVENT, fromBlock: from, toBlock: to })),
      ]);
      for (const l of commits) vaultSeen.leaves[Number(l.args.index)] = String(l.args.commitment);
      for (const l of nulls) vaultSeen.nullifiers.add(String(l.args.nullifier));
      vaultSeen.to = to;
      from = to + 1n;
    }
  })().finally(() => (vaultReading = null));
  await vaultReading;
  return { vault: VAULT, leaves: vaultSeen.leaves, nullifiers: [...vaultSeen.nullifiers], block: vaultSeen.to.toString() };
}
