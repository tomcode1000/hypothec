// One complete Hypothec loan on Base Sepolia with Circle's test USDC (docs/DECISIONS.md D5,
// D6): deploys HypothecLoans once (address saved in deployments/base-sepolia.json), tops up
// the borrower and referees, then offer -> accept -> fund -> both referees confirm the lock
// (the borrower is paid 5 USDC) -> borrower repays 5.15 -> Repaid.
// Wallets: ~/.hypothec/testnet-wallets.json (scripts/new-wallets.ts). TESTNET ONLY.
//   npx ts-node scripts/live-loan.ts
import {
  createPublicClient, createWalletClient, http, erc20Abi, keccak256, toHex,
  parseEther, formatEther, formatUnits, type Hash, type Address, type Abi,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import artifact from "../artifacts/contracts/HypothecLoans.sol/HypothecLoans.json";

const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Circle, Base Sepolia
const EXPLORER = "https://sepolia.basescan.org";
const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));
const PRINCIPAL = usdc(5);
const OWED = usdc(5.15); // 5 + 3% (12% APR for 3 months)
const GAS_TOPUP = parseEther("0.0005");

const wallets = JSON.parse(readFileSync(join(homedir(), ".hypothec", "testnet-wallets.json"), "utf8")).wallets;
const rpc = http(process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org");
const pub = createPublicClient({ chain: baseSepolia, transport: rpc });
const wallet = (role: string) =>
  createWalletClient({ chain: baseSepolia, transport: rpc, account: privateKeyToAccount(wallets[role].key) });
const lender = wallet("lender"), borrower = wallet("borrower"), refA = wallet("refereeA"), refB = wallet("refereeB");
const abi = artifact.abi as Abi;

/// Waits for the receipt and returns its block: reads pinned to that block are never stale
/// (the public RPC can answer from a node a block behind).
async function done(what: string, hash: Hash) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${what} failed: ${EXPLORER}/tx/${hash}`);
  console.log(`${what.padEnd(34)} ${EXPLORER}/tx/${hash}`);
  return r.blockNumber;
}
/// The public RPC is a pool of nodes that can lag a block or two: a read pinned to a fresh
/// block may get "block not found", and a simulation may see old state. Retry those.
async function retry<T>(what: string, f: () => Promise<T>, tries = 10): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries) throw e;
      console.log(`  (${what}: node behind, retry ${i})`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
/// Checks a contract call against the chain (retrying past lagging nodes), then sends it with
/// a fixed gas limit so the send does not depend on a node's estimate.
type Wallet = ReturnType<typeof wallet>;
async function send(w: Wallet, call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { request } = await retry(`check ${call.functionName}`, () => pub.simulateContract({ ...call, account: w.account } as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return w.writeContract({ ...(request as any), gas: 300_000n });
}
const STATUS = ["None", "Offered", "Accepted", "Funded", "Active", "Repaid", "Liquidated", "Cancelled"];

async function main() {
  const deployFile = join(__dirname, "..", "deployments", "base-sepolia.json");
  let loans: Address;
  if (existsSync(deployFile)) {
    loans = JSON.parse(readFileSync(deployFile, "utf8")).HypothecLoans;
    console.log(`contract (existing)                ${EXPLORER}/address/${loans}`);
  } else {
    const hash = await lender.deployContract({ abi, bytecode: artifact.bytecode as `0x${string}`, args: [USDC] });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (!r.contractAddress) throw new Error("deploy failed");
    loans = r.contractAddress;
    mkdirSync(join(__dirname, "..", "deployments"), { recursive: true });
    writeFileSync(deployFile, JSON.stringify({ network: "base-sepolia", chainId: 84532, usdc: USDC, HypothecLoans: loans, deployTx: hash }, null, 2) + "\n");
    console.log(`contract deployed                  ${EXPLORER}/address/${loans}`);
  }

  // Fees for the other three; 1 USDC to the borrower so it can pay the interest.
  for (const w of [borrower, refA, refB]) {
    if ((await pub.getBalance({ address: w.account.address })) < GAS_TOPUP / 2n) {
      await done(`gas -> ${w.account.address.slice(0, 10)}`, await lender.sendTransaction({ to: w.account.address, value: GAS_TOPUP }));
    }
  }
  const bal = (a: Address, blockNumber?: bigint) =>
    retry("balance", () => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a], blockNumber }));
  const getLoan = (id: `0x${string}`, blockNumber?: bigint) =>
    retry("getLoan", async () => (await pub.readContract({ address: loans, abi, functionName: "getLoan", args: [id], blockNumber })) as { status: number; repaid: bigint });
  if ((await bal(borrower.account.address)) < OWED - PRINCIPAL) {
    await done("1 USDC -> borrower (for interest)", await send(lender, { address: USDC, abi: erc20Abi as Abi, functionName: "transfer", args: [borrower.account.address, usdc(1)] }));
  }

  // `npx ts-node scripts/live-loan.ts <loan id>` resumes an Active loan at the repayment.
  let id = process.argv[2] as `0x${string}` | undefined;
  if (id) {
    console.log(`loan ${id} (resuming: ${STATUS[(await getLoan(id)).status]})`);
  } else {
    const now = BigInt(Math.floor(Date.now() / 1000));
    id = keccak256(toHex(`hypothec-demo-${now}`));
    const terms = {
      borrower: borrower.account.address,
      refereeA: refA.account.address,
      refereeB: refB.account.address,
      repayTo: lender.account.address,
      principal: PRINCIPAL,
      owed: OWED,
      dueAt: now + 90n * 86_400n,
      lockBy: now + 86_400n,
    };
    console.log(`loan ${id}`);
    await done("1 offer (lender)", await send(lender, { address: loans, abi, functionName: "offer", args: [id, terms] }));
    await done("2 accept + referees (borrower)", await send(borrower, { address: loans, abi, functionName: "accept", args: [id, borrower.account.address] }));
    await done("3a approve 5 USDC (lender)", await send(lender, { address: USDC, abi: erc20Abi as Abi, functionName: "approve", args: [loans, PRINCIPAL] }));
    const funded = await done("3b fund (lender)", await send(lender, { address: loans, abi, functionName: "fund", args: [id] }));
    await done("4a lock confirmed (referee A)", await send(refA, { address: loans, abi, functionName: "confirmLock", args: [id] }));
    const active = await done("4b lock confirmed (referee B)", await send(refB, { address: loans, abi, functionName: "confirmLock", args: [id] }));
    const paid = (await bal(borrower.account.address, active)) - (await bal(borrower.account.address, funded));
    console.log(`borrower received ${formatUnits(paid, 6)} USDC`);
    if (paid !== PRINCIPAL) throw new Error("borrower was not paid the principal");
  }
  if (STATUS[(await getLoan(id)).status] !== "Active") throw new Error("loan is not Active");

  await done("5a approve 5.15 USDC (borrower)", await send(borrower, { address: USDC, abi: erc20Abi as Abi, functionName: "approve", args: [loans, OWED] }));
  const repaid = await done("5b repay (borrower)", await send(borrower, { address: loans, abi, functionName: "repay", args: [id, OWED] }));

  const loan = await getLoan(id, repaid);
  const status = STATUS[loan.status];
  console.log(`status ${status}, repaid ${formatUnits(loan.repaid, 6)} USDC`);
  if (status !== "Repaid") throw new Error("loan not repaid");
  console.log(`lender ETH left ${formatEther(await pub.getBalance({ address: lender.account.address, blockNumber: repaid }))}, USDC ${formatUnits(await bal(lender.account.address, repaid), 6)}`);
  console.log("LIVE LOAN: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
