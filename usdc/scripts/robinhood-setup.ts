// Robinhood Chain testnet, once: Paxos's faucet for test USDG is not open everywhere, so the
// dollar side there uses Test USDC (contracts/test/TestUSDC.sol: 6 decimals, the same
// EIP-2612 permit as Circle's USDC, anyone can mint). Deploys it and HypothecLoans on it from
// the TEST lender wallet, records both in deployments/robinhood-testnet.json, sends each
// other test wallet a little ETH for fees and mints test dollars to the desks and borrower.
//   npx ts-node scripts/robinhood-setup.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import loansArtifact from "../artifacts/contracts/HypothecLoans.sol/HypothecLoans.json";
import tokenArtifact from "../artifacts/contracts/test/TestUSDC.sol/TestUSDC.json";
import { CHAINS } from "../../services/src/chains";

const c = CHAINS.robinhood;
const transport = http(c.rpcs[0], { timeout: 30_000, retryCount: 3 });
const pub = createPublicClient({ chain: c.chain, transport });
const wallets = JSON.parse(readFileSync(join(homedir(), ".hypothec", "testnet-wallets.json"), "utf8")).wallets as Record<string, { address: Address; key: Hex }>;
const deployer = createWalletClient({ chain: c.chain, transport, account: privateKeyToAccount(wallets.lender.key) });
const file = join(__dirname, "..", "deployments", "robinhood-testnet.json");

async function deploy(abi: unknown[], bytecode: string, args: unknown[]) {
  const hash = await deployer.deployContract({ abi, bytecode: bytecode as Hex, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy failed: ${hash}`);
  return { address: r.contractAddress, hash };
}

async function main() {
  const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const token = old?.usdc ? { address: old.usdc as Address, hash: old.tokenTx } : await deploy(tokenArtifact.abi, tokenArtifact.bytecode, []);
  console.log(`Test USDC ${token.address}`);
  const loans = old?.HypothecLoans ? { address: old.HypothecLoans as Address, hash: old.deployTx } : await deploy(loansArtifact.abi, loansArtifact.bytecode, [token.address]);
  console.log(`HypothecLoans ${loans.address}\n${c.explorer}/address/${loans.address}`);
  writeFileSync(file, JSON.stringify({
    network: c.label, chainId: c.chain.id, stable: "tUSDC", usdc: token.address, tokenTx: token.hash,
    HypothecLoans: loans.address, deployTx: loans.hash, deployedAt: old?.deployedAt ?? new Date().toISOString(), previous: old?.previous ?? [],
  }, null, 2) + "\n");

  // Fees for the other wallets, and test dollars for the desks and the borrower.
  for (const who of ["lender2", "borrower", "refereeA", "refereeB"]) {
    const to = wallets[who].address;
    if ((await pub.getBalance({ address: to })) >= parseEther("0.0005")) continue;
    const hash = await deployer.sendTransaction({ to, value: parseEther("0.001") });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`0.001 ETH -> ${who}`);
  }
  for (const [who, amount] of [["lender", 20_000_000n], ["lender2", 20_000_000n], ["borrower", 5_000_000n]] as const) {
    const hash = await deployer.writeContract({ address: token.address, abi: tokenArtifact.abi, functionName: "mint", args: [wallets[who].address, amount] });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`${Number(amount) / 1e6} tUSDC -> ${who}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
