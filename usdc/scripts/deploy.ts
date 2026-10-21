// Deploys HypothecLoans from the TEST lender wallet to one of the dollar-side chains and
// records it in deployments/<chain>.json (the services and the web app read the address from
// there). The address it replaces is kept as `previous`: loans made on it stay readable there,
// but the app works with one contract at a time.
//   npx ts-node scripts/deploy.ts base         Base Sepolia, Circle's test USDC
//   npx ts-node scripts/deploy.ts robinhood    Robinhood Chain testnet, Paxos's test USDG
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createPublicClient, createWalletClient, fallback, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "../artifacts/contracts/HypothecLoans.sol/HypothecLoans.json";
import { CHAINS, type ChainInfo } from "../../services/src/chains";

const which = (process.argv[2] ?? "base") as ChainInfo["key"];
const c = CHAINS[which];
if (!c) throw new Error(`usage: deploy.ts ${Object.keys(CHAINS).join("|")}`);
const transport = fallback(c.rpcs.map((url) => http(url, { timeout: 30_000, retryCount: 3 })));
const pub = createPublicClient({ chain: c.chain, transport });
const key = JSON.parse(readFileSync(join(homedir(), ".hypothec", "testnet-wallets.json"), "utf8")).wallets.lender.key as Hex;
const deployer = createWalletClient({ chain: c.chain, transport, account: privateKeyToAccount(key) });

async function main() {
  const file = join(__dirname, "..", "deployments", c.deployments);
  const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const hash = await deployer.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: [c.stable.address] });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy failed: ${hash}`);
  const next = {
    network: c.label,
    chainId: c.chain.id,
    usdc: c.stable.address,
    stable: c.stable.symbol,
    HypothecLoans: r.contractAddress,
    deployTx: hash,
    deployedAt: new Date().toISOString(),
    previous: old ? [{ HypothecLoans: old.HypothecLoans, deployTx: old.deployTx }, ...(old.previous ?? [])] : [],
  };
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  console.log(`HypothecLoans on ${c.label}: ${r.contractAddress}\n${c.explorer}/address/${r.contractAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
