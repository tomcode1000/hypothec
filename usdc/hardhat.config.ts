import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // Live testnet (docs/USDC.md). The deployer key comes from the environment, never a file
    // in this folder.
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org",
      chainId: 84532,
      accounts: process.env.HYPOTHEC_DEPLOYER_KEY ? [process.env.HYPOTHEC_DEPLOYER_KEY] : [],
    },
  },
};

export default config;
