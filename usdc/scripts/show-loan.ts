// Prints a loan's state on Base Sepolia and the four wallets' USDC balances.
//   npx ts-node scripts/show-loan.ts <loan id>
import { createPublicClient, http, erc20Abi, formatUnits, type Address, type Abi } from "viem";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import artifact from "../artifacts/contracts/HypothecLoans.sol/HypothecLoans.json";

const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const STATUS = ["None", "Offered", "Accepted", "Funded", "Active", "Repaid", "Liquidated", "Cancelled"];

async function main() {
  const id = process.argv[2] as `0x${string}`;
  const loans = JSON.parse(readFileSync(join(__dirname, "..", "deployments", "base-sepolia.json"), "utf8")).HypothecLoans as Address;
  const wallets = JSON.parse(readFileSync(join(homedir(), ".hypothec", "testnet-wallets.json"), "utf8")).wallets;
  const pub = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org") });
  console.log(`block ${await pub.getBlockNumber()}`);
  if (id) {
    const l = (await pub.readContract({ address: loans, abi: artifact.abi as Abi, functionName: "getLoan", args: [id] })) as Record<string, unknown>;
    console.log(`loan ${id}: ${STATUS[l.status as number]}, principal ${formatUnits(l.principal as bigint, 6)}, owed ${formatUnits(l.owed as bigint, 6)}, repaid ${formatUnits(l.repaid as bigint, 6)}`);
  }
  console.log(`contract USDC ${formatUnits(await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [loans] }), 6)}`);
  for (const role of Object.keys(wallets)) {
    const b = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallets[role].address] });
    console.log(`${role.padEnd(9)} USDC ${formatUnits(b, 6)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
