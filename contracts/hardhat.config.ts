import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "cancun",
    },
  },
  networks: {
    baseSepolia: {
      chainId: 84532,
      url: process.env.BASE_RPC_URL || "https://sepolia.base.org",
      accounts: process.env.MINTER_PRIVATE_KEY
        ? [process.env.MINTER_PRIVATE_KEY]
        : [],
    },
  },
};

export default config;
