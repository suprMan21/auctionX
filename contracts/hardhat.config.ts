import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// S-ANCHOR1: the only contract deployed from here is OwnershipRegistry (not an
// NFT). AuctionXNFT.sol is the superseded ERC-721 from before the token-first
// pivot and is kept for history only.
//
// DEPLOYER_PRIVATE_KEY is a throwaway key used once to pay for the deploy; it
// gets no role in the registry. Base mainnet is deliberately absent until
// counsel signs off (Decisions DB 2026-10-27).
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // HARDHAT_CHAIN_ID=84532 lets the backend's opt-in end-to-end test run the
    // real chain client against a local node (backend anchoring.chain.test.ts).
    hardhat: { chainId: Number(process.env.HARDHAT_CHAIN_ID) || 31337 },
    baseSepolia: {
      chainId: 84532,
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  // Etherscan API v2: one key covers Basescan.
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY ?? "" },
  sourcify: { enabled: false },
};

export default config;
