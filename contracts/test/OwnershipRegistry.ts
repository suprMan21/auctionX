import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const ID = "0x" + "ab".repeat(32);
const ROOT = "0x" + "cd".repeat(32);

const deploy = async () => {
  const [deployer, owner, writer, stranger, newWriter, newOwner] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("OwnershipRegistry", deployer);
  const registry = await Registry.deploy(owner.address, writer.address);
  await registry.waitForDeployment();
  return { registry, deployer, owner, writer, stranger, newWriter, newOwner };
};

describe("OwnershipRegistry", () => {
  describe("deploy", () => {
    it("sets owner and writer; the deployer gets no role", async () => {
      const { registry, deployer, owner, writer } = await deploy();
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.writer()).to.equal(writer.address);
      await expect(registry.connect(deployer).anchor(ID)).to.be.revertedWithCustomError(registry, "NotWriter");
      await expect(registry.connect(deployer).setWriter(deployer.address))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("refuses a zero writer or a writer that is the owner", async () => {
      const [, owner] = await ethers.getSigners();
      const Registry = await ethers.getContractFactory("OwnershipRegistry");
      await expect(Registry.deploy(owner.address, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(Registry, "ZeroAddress");
      await expect(Registry.deploy(owner.address, owner.address))
        .to.be.revertedWithCustomError(Registry, "WriterIsOwner");
    });
  });

  describe("writes", () => {
    it("the writer can anchor an Ownership ID and a root", async () => {
      const { registry, writer } = await deploy();
      await expect(registry.connect(writer).anchor(ID))
        .to.emit(registry, "OwnershipAnchored").withArgs(ID, anyValue);
      await expect(registry.connect(writer).anchorRoot(ROOT))
        .to.emit(registry, "RootAnchored").withArgs(ROOT, anyValue);
    });

    it("any other caller reverts, including the owner", async () => {
      const { registry, owner, stranger } = await deploy();
      for (const who of [owner, stranger]) {
        await expect(registry.connect(who).anchor(ID)).to.be.revertedWithCustomError(registry, "NotWriter");
        await expect(registry.connect(who).anchorRoot(ROOT)).to.be.revertedWithCustomError(registry, "NotWriter");
      }
    });

    it("the event timestamp is the block time", async () => {
      const { registry, writer } = await deploy();
      const tx = await registry.connect(writer).anchorRoot(ROOT);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const parsed = registry.interface.parseLog(receipt!.logs[0]);
      expect(parsed!.args.timestamp).to.equal(BigInt(block!.timestamp));
    });
  });

  describe("writer rotation", () => {
    it("only the owner can rotate; the old writer reverts immediately", async () => {
      const { registry, owner, writer, stranger, newWriter } = await deploy();
      await expect(registry.connect(stranger).setWriter(stranger.address))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      await expect(registry.connect(writer).setWriter(stranger.address))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

      await expect(registry.connect(owner).setWriter(newWriter.address))
        .to.emit(registry, "WriterChanged").withArgs(writer.address, newWriter.address);

      await expect(registry.connect(writer).anchor(ID)).to.be.revertedWithCustomError(registry, "NotWriter");
      await expect(registry.connect(newWriter).anchor(ID)).to.emit(registry, "OwnershipAnchored");
    });

    it("setting the writer to zero stops every write", async () => {
      const { registry, owner, writer } = await deploy();
      await registry.connect(owner).setWriter(ethers.ZeroAddress);
      await expect(registry.connect(writer).anchorRoot(ROOT)).to.be.revertedWithCustomError(registry, "NotWriter");
    });

    it("the owner cannot appoint itself writer", async () => {
      const { registry, owner } = await deploy();
      await expect(registry.connect(owner).setWriter(owner.address))
        .to.be.revertedWithCustomError(registry, "WriterIsOwner");
    });
  });

  describe("ownership", () => {
    it("cannot be renounced", async () => {
      const { registry, owner, stranger } = await deploy();
      await expect(registry.connect(owner).renounceOwnership())
        .to.be.revertedWithCustomError(registry, "RenounceDisabled");
      await expect(registry.connect(stranger).renounceOwnership())
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("the writer can never be lined up as owner, nor a pending owner as writer", async () => {
      const { registry, owner, writer, newOwner } = await deploy();
      await expect(registry.connect(owner).transferOwnership(writer.address))
        .to.be.revertedWithCustomError(registry, "WriterIsOwner");
      await registry.connect(owner).transferOwnership(newOwner.address);
      await expect(registry.connect(owner).setWriter(newOwner.address))
        .to.be.revertedWithCustomError(registry, "WriterIsOwner");
    });

    it("moves in two steps and the new owner then controls rotation", async () => {
      const { registry, owner, newOwner, newWriter } = await deploy();
      await registry.connect(owner).transferOwnership(newOwner.address);
      expect(await registry.owner()).to.equal(owner.address);
      await registry.connect(newOwner).acceptOwnership();
      expect(await registry.owner()).to.equal(newOwner.address);
      await expect(registry.connect(owner).setWriter(newWriter.address))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      await registry.connect(newOwner).setWriter(newWriter.address);
      expect(await registry.writer()).to.equal(newWriter.address);
    });
  });

  it("keeps no per-item state: the only storage is owner, pending owner and writer", async () => {
    const { registry, writer } = await deploy();
    const addr = await registry.getAddress();
    await registry.connect(writer).anchor(ID);
    // Slots 0..2 hold owner, pendingOwner, writer; nothing else is ever written.
    for (let slot = 3; slot < 8; slot++) {
      expect(await ethers.provider.getStorage(addr, slot)).to.equal(ethers.ZeroHash);
    }
  });
});
