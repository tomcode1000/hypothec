// The dollar side of a loan runs on one EVM test chain per deployment, chosen with
// HYPOTHEC_CHAIN: "base" (Base Sepolia, Circle's test USDC) or "robinhood" (Robinhood Chain
// testnet, Paxos's test USDG). Both stablecoins have 6 decimals and an EIP-2612 permit, so
// the contract and every flow are the same; only addresses, names and links differ.
import { defineChain, type Address, type Chain } from "viem";
import { baseSepolia } from "viem/chains";

export interface ChainInfo {
  key: "base" | "robinhood";
  chain: Chain;
  /// "Base Sepolia"; `short` is what the copy says ("USDC on Base").
  label: string;
  short: string;
  rpcs: string[];
  explorer: string;
  /// The stablecoin lent and repaid, and its EIP-2612 permit domain.
  stable: { address: Address; symbol: string; permitName: string; permitVersion: string; mintable?: boolean };
  faucets: { gas: string; stable: string };
  /// usdc/deployments/<file>: where the loan contract's address is recorded.
  deployments: string;
}

const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
  testnet: true,
});

export const CHAINS: Record<ChainInfo["key"], ChainInfo> = {
  base: {
    key: "base",
    chain: baseSepolia,
    label: "Base Sepolia",
    short: "Base",
    rpcs: [process.env.HYPOTHEC_RPC ?? process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
    explorer: "https://sepolia.basescan.org",
    stable: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", symbol: "USDC", permitName: "USDC", permitVersion: "2" },
    faucets: { gas: "https://www.alchemy.com/faucets/base-sepolia", stable: "https://faucet.circle.com/" },
    deployments: "base-sepolia.json",
  },
  robinhood: {
    key: "robinhood",
    chain: robinhoodTestnet,
    label: "Robinhood Chain testnet",
    short: "Robinhood Chain",
    rpcs: [process.env.HYPOTHEC_RPC ?? "https://rpc.testnet.chain.robinhood.com"],
    explorer: "https://explorer.testnet.chain.robinhood.com",
    // Test USDC (usdc/contracts/test/TestUSDC.sol, scripts/robinhood-setup.ts): Paxos's test
    // USDG faucet is not open in every country, so anyone can mint this one from the app.
    // Paxos USDG here is 0x7E955252E15c84f5768B83c41a71F9eba181802F (permit "Global Dollar" v1).
    stable: { address: "0xdc821cdb076a1b2c5d1ada9a242f33b97d34f0a5", symbol: "tUSDC", permitName: "USDC", permitVersion: "2", mintable: true },
    faucets: { gas: "https://faucet.testnet.chain.robinhood.com/", stable: "" },
    deployments: "robinhood-testnet.json",
  },
};

const pick = (process.env.HYPOTHEC_CHAIN ?? "base").toLowerCase();
if (!(pick in CHAINS)) throw new Error(`HYPOTHEC_CHAIN must be one of ${Object.keys(CHAINS).join(", ")}, not "${pick}"`);
export const CHAIN: ChainInfo = CHAINS[pick as ChainInfo["key"]];
