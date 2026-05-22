import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";

dotenv.config();

// Primary deploy key: prefer DEPLOYER_PRIVATE_KEY, fall back to PLATFORM_PRIVATE_KEY
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PLATFORM_PRIVATE_KEY || "";
const platformKey = process.env.PLATFORM_PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun"
    }
  },
  networks: {
    hardhat: {
      chainId: 1337
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: deployerKey && platformKey ? [deployerKey, platformKey] : undefined,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || process.env.RPC_URL || "",
      chainId: 84532,
      // Deploy script uses [0]=deployer [1]=platformSigner — both keys required
      accounts: deployerKey && platformKey && deployerKey !== platformKey
        ? [deployerKey, platformKey]
        : deployerKey
        ? [deployerKey]
        : [],
    },
    arcTestnet: {
      url: process.env.ARC_TESTNET_RPC_URL || "https://testnet.rpc.arc.network",
      chainId: 298, // Assuming 298 or similar, using generic
      accounts: deployerKey && platformKey && deployerKey !== platformKey
        ? [deployerKey, platformKey]
        : deployerKey
        ? [deployerKey]
        : [],
    }
  }
};

export default config;
