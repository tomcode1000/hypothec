// Deploys HypothecLoans to Base Sepolia from the TEST lender wallet and records it in
// deployments/base-sepolia.json (the services and the web app read the address from there).
// The address it replaces is kept as `previous`: loans made on it stay readable there, but
// the app works with one contract at a time.
//   npx ts-node scripts/deploy.ts
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createPublicClient, createWalletClient, fallback, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "../artifacts/contracts/HypothecLoans.sol/HypothecLoans.json";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const transport = fallback([http("https://sepolia.base.org", { timeout: 30_000, retryCount: 3 }), http("https://base-sepolia-rpc.publicnode.com", { timeout: 30_000, retryCount: 3 })]);
const pub = createPublicClient({ chain: baseSepolia, transport });
const key = JSON.parse(readFileSync(join(homedir(), ".hypothec", "testnet-wallets.json"), "utf8")).wallets.lender.key as Hex;
const deployer = createWalletClient({ chain: baseSepolia, transport, account: privateKeyToAccount(key) });

async function main() {
  const file = join(__dirname, "..", "deployments", "base-sepolia.json");
  const old = JSON.parse(readFileSync(file, "utf8"));
  const hash = await deployer.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: [USDC] });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy failed: ${hash}`);
  const next = {
    network: "base-sepolia",
    chainId: 84532,
    usdc: USDC,
    HypothecLoans: r.contractAddress,
    deployTx: hash,
    deployedAt: new Date().toISOString(),
    previous: [{ HypothecLoans: old.HypothecLoans, deployTx: old.deployTx }, ...(old.previous ?? [])],
  };
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  console.log(`HypothecLoans ${r.contractAddress}\nhttps://sepolia.basescan.org/address/${r.contractAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
