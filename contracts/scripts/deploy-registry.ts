/**
 * Deploys OwnershipRegistry (S-ANCHOR1) to Base Sepolia. Not an NFT.
 *
 *   REGISTRY_OWNER   Boss's hardware-wallet address (can only rotate the writer)
 *   REGISTRY_WRITER  the KMS writer address printed by scripts/anchor/create-writer-key.sh
 *   DEPLOYER_PRIVATE_KEY  throwaway funded key; it gets no role
 *
 *   npx hardhat run scripts/deploy-registry.ts --network baseSepolia
 *
 * Prints the address and deploy block for the backend env
 * (ANCHOR_REGISTRY_ADDRESS, ANCHOR_REGISTRY_DEPLOY_BLOCK).
 */
import { ethers, network, run } from "hardhat";

const need = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value || !ethers.isAddress(value)) throw new Error(`${name} must be an address`);
  return ethers.getAddress(value);
};

async function main() {
  if (network.config.chainId !== 84532) throw new Error("Ph1 deploys to Base Sepolia (84532) only");

  const owner = need("REGISTRY_OWNER");
  const writer = need("REGISTRY_WRITER");
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  if ([owner, writer].includes(deployer.address)) {
    throw new Error("The deployer must be a separate throwaway key");
  }

  console.log(`Deployer ${deployer.address}\nOwner    ${owner}\nWriter   ${writer}`);
  const registry = await ethers.deployContract("OwnershipRegistry", [owner, writer]);
  const tx = registry.deploymentTransaction();
  await registry.waitForDeployment();
  const receipt = await tx!.wait(2);

  const address = await registry.getAddress();
  console.log(`\nANCHOR_REGISTRY_ADDRESS=${address}`);
  console.log(`ANCHOR_REGISTRY_DEPLOY_BLOCK=${receipt!.blockNumber}`);
  console.log(`Deploy tx https://sepolia.basescan.org/tx/${receipt!.hash}`);

  if (process.env.ETHERSCAN_API_KEY) {
    await run("verify:verify", { address, constructorArguments: [owner, writer] });
  } else {
    console.log("ETHERSCAN_API_KEY not set: verify later with\n" +
      `  npx hardhat verify --network baseSepolia ${address} ${owner} ${writer}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
