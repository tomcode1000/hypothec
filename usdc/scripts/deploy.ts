// Deploys the dollar side to one chain from the TEST lender wallet: the shielded vault (its
// proof verifier, circomlib's Poseidon hashers, HypothecVault) and HypothecLoans wired to it,
// and records them in deployments/<chain>.json (the services and the web app read them).
// The addresses it replaces are kept as `previous`: loans made on them stay readable there,
// but the app works with one contract at a time.
//   npx ts-node scripts/deploy.ts base         Base Sepolia, Circle's test USDC
//   npx ts-node scripts/deploy.ts robinhood    Robinhood Chain testnet, Test USDC
// Needs shield/ installed (npm ci there) for the Poseidon contracts.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createPublicClient, createWalletClient, fallback, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import loansArtifact from "../artifacts/contracts/HypothecLoans.sol/HypothecLoans.json";
import vaultArtifact from "../artifacts/contracts/vault/HypothecVault.sol/HypothecVault.json";
import verifierArtifact from "../artifacts/contracts/vault/SpendVerifier.sol/SpendVerifier.json";
import { CHAINS, type ChainInfo } from "../../services/src/chains";

const which = (process.argv[2] ?? "base") as ChainInfo["key"];
const c = CHAINS[which];
if (!c) throw new Error(`usage: deploy.ts ${Object.keys(CHAINS).join("|")}`);
const transport = fallback(c.rpcs.map((url) => http(url, { timeout: 30_000, retryCount: 3 })));
const pub = createPublicClient({ chain: c.chain, transport });
const key = JSON.parse(readFileSync(join(homedir(), ".hypothec", "testnet-wallets.json"), "utf8")).wallets.lender.key as Hex;
const deployer = createWalletClient({ chain: c.chain, transport, account: privateKeyToAccount(key) });

async function deploy(name: string, abi: unknown, bytecode: string, args: unknown[] = []) {
  const hash = await deployer.deployContract({ abi: abi as Abi, bytecode: bytecode as Hex, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`${name}: deploy failed ${hash}`);
  console.log(`${name.padEnd(14)} ${r.contractAddress}`);
  return { address: r.contractAddress, hash, block: r.blockNumber };
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const circomlibjs = require(join(__dirname, "..", "..", "shield", "node_modules", "circomlibjs"));
  const file = join(__dirname, "..", "deployments", c.deployments);
  const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;

  const verifier = await deploy("SpendVerifier", verifierArtifact.abi, verifierArtifact.bytecode);
  const p2 = await deploy("Poseidon2", circomlibjs.poseidonContract.generateABI(2), circomlibjs.poseidonContract.createCode(2));
  const p3 = await deploy("Poseidon3", circomlibjs.poseidonContract.generateABI(3), circomlibjs.poseidonContract.createCode(3));
  const vault = await deploy("HypothecVault", vaultArtifact.abi, vaultArtifact.bytecode, [c.stable.address, verifier.address, p2.address, p3.address]);
  const loans = await deploy("HypothecLoans", loansArtifact.abi, loansArtifact.bytecode, [c.stable.address, vault.address]);
  const hash = await deployer.writeContract({ address: vault.address, abi: vaultArtifact.abi as Abi, functionName: "setLoans", args: [loans.address] });
  await pub.waitForTransactionReceipt({ hash });

  const next = {
    network: c.label,
    chainId: c.chain.id,
    usdc: c.stable.address,
    stable: c.stable.symbol,
    HypothecLoans: loans.address,
    deployTx: loans.hash,
    HypothecVault: vault.address,
    vaultBlock: Number(vault.block),
    SpendVerifier: verifier.address,
    Poseidon2: p2.address,
    Poseidon3: p3.address,
    deployedAt: new Date().toISOString(),
    previous: old ? [{ HypothecLoans: old.HypothecLoans, deployTx: old.deployTx }, ...(old.previous ?? [])] : [],
  };
  if (old?.tokenTx) Object.assign(next, { tokenTx: old.tokenTx });
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  console.log(`${c.explorer}/address/${loans.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
