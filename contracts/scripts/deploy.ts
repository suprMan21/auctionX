import { ethers } from "hardhat";

async function main() {
  const AuctionXNFT = await ethers.getContractFactory("AuctionXNFT");
  const nft = await AuctionXNFT.deploy();
  await nft.waitForDeployment();

  const address = await nft.getAddress();
  console.log("AuctionXNFT deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
