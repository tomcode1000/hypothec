// Where everything is. The Zcash side runs in WSL (e2e/stack.sh); Windows reaches it on
// localhost. Base side: the deployed HypothecLoans (usdc/deployments) and the four TEST
// wallets in ~/.hypothec/testnet-wallets.json (outside OneDrive).
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Abi, Address, Hex } from "viem";
import { ZEC_NETWORK } from "./zec";
import artifact from "../../usdc/artifacts/contracts/HypothecLoans.sol/HypothecLoans.json";

export const ROLES = ["borrower", "lender", "refereeA", "refereeB"] as const;
export type Role = (typeof ROLES)[number];

export const CONTROL_URL = "http://127.0.0.1:7899";
export const LOANBOOK_PORT = Number(process.env.HYPOTHEC_LOANBOOK_PORT ?? 7900);
export const LOANBOOK_URL = process.env.HYPOTHEC_LOANBOOK ?? `http://127.0.0.1:${LOANBOOK_PORT}`;

export const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Circle, Base Sepolia
export const EXPLORER = "https://sepolia.basescan.org";
export const LOANS_ABI = artifact.abi as Abi;
export const LOANS: Address = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "usdc", "deployments", "base-sepolia.json"), "utf8"),
).HypothecLoans;

// Read when present: the rules and loanbook tests (CI) run without any wallet file, and a
// role's key is asked for only when something acts as that role.
const WALLETS_FILE = join(homedir(), ".hypothec", "testnet-wallets.json");
const wallets: Record<string, { address: Address; key: Hex }> = existsSync(WALLETS_FILE) ? JSON.parse(readFileSync(WALLETS_FILE, "utf8")).wallets : {};
export const BASE_ADDRESS: Record<Role, Address> = Object.fromEntries(ROLES.map((r) => [r, wallets[r]?.address])) as Record<Role, Address>;
/// The four roles' wallets, plus "lender2": a second test lender, so a borrow can be split
/// across two desks run by different wallets (D16).
export type BaseWallet = Role | "lender2";
const wallet = (who: BaseWallet) => {
  const w = wallets[who];
  if (!w) throw new Error(`no test wallet "${who}" in ${WALLETS_FILE}`);
  return w;
};
export const baseKey = (who: BaseWallet): Hex => wallet(who).key;
export const baseAddress = (who: BaseWallet): Address => wallet(who).address;

// Stand-ins for the parties' own Zcash wallets. Regtest: addresses 1, 2 and 3 of zafe's
// throwaway example key (crates/zafe-core/examples/vault_address.rs, deterministic). Testnet:
// the desks' liquidation shares go to that key's testnet addresses (spare TAZ, not recovered),
// and the borrower's payouts to the test wallet (e2e/testnet-wallet.sh), so released
// collateral comes back to the wallet that locked it. In the product these come from the
// desk's ZEC wallet and a fresh address in the borrower's wallet.
const ZEC_STAND_INS = {
  regtest: {
    lender: "uregtest1pztwkegallegrv2q2nrx06lk40agnp2qqjcan5wy2h4vcfwvyy70jchh64acc7h4yha4avsqzpu87dqppxl8z9erx3kugye67cdtyljp",
    borrower: "uregtest13qn3zjg3ed308qf7psghwhzdezv94t8zsvms2np2cuccg7ts7f5554lclgrhzwlpdlct7qhc2wm20gawh6fxmfkuuct8z4d0luqmh34s",
    lender2: "uregtest1qwe5qgz0w6mgj8fwy7t7auqp9z34zpvwzvmjaa0hpm6a6uusy4z8htuungn68x7kekxust3mcdxtz8phfvu6cjyjpvhu9fz7qcuru0xr",
  },
  test: {
    lender: "utest1jc3kt7hevp0ytyfu235dskw34xkx0pjdrw5av0dgzekzmqt4hy9apkcx2meh8rj8g6gv3tw3vk7mq2ae9ktggnk4mhh7pdsse56sa36x",
    borrower: "utest1yjp5pvfak0ay4zds4eka35ce8sk43lr8nhqsf69nxne79evplwv952ldv2fucwu83nns3x0rxdxvr3m33s0jh67gjrqqzalwvvrf893z",
    lender2: "utest12xtpgmhnyhg9yu0xceayhv54re7gxfujusey5na6mndn5yq6tv94euagcuzlx48ey7jatvdqgpz6e82njrwnsc974c2fn00qs599svwe",
  },
};
export const TEST_ZEC_ADDRESS = { ...ZEC_STAND_INS[ZEC_NETWORK === "test" ? "test" : "regtest"] };
// A host runs its own test wallet (deploy/start.sh): the borrower's payouts go back to it.
if (process.env.HYPOTHEC_TEST_WALLET_ZEC) TEST_ZEC_ADDRESS.borrower = process.env.HYPOTHEC_TEST_WALLET_ZEC;

/// Price override for the demo's "price feed" slider (BUILD-PLAN referee/): when this file
/// exists both referees use its price instead of the live feeds, and log that they did.
export const PRICE_OVERRIDE_FILE = join(homedir(), ".hypothec", "price-override.json");
