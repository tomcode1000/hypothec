// Creates the four Base Sepolia TEST wallets for the demo (lender, borrower, two referees)
// and saves their keys outside this folder: ~/.hypothec/testnet-wallets.json.
// Testnet only. Never send real funds to these keys. Refuses to overwrite existing wallets.
//   npx ts-node scripts/new-wallets.ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const dir = join(homedir(), ".hypothec");
const file = join(dir, "testnet-wallets.json");
if (existsSync(file)) {
  console.error(`${file} already exists; not overwriting`);
  process.exit(1);
}
const roles = ["lender", "borrower", "refereeA", "refereeB"] as const;
const wallets = Object.fromEntries(
  roles.map((role) => {
    const key = generatePrivateKey();
    return [role, { address: privateKeyToAccount(key).address, key }];
  }),
);
mkdirSync(dir, { recursive: true });
writeFileSync(file, JSON.stringify({ network: "base-sepolia", note: "TESTNET ONLY", wallets }, null, 2) + "\n", { mode: 0o600 });
console.log(`saved ${file}`);
for (const role of roles) console.log(`${role.padEnd(9)} ${wallets[role].address}`);
