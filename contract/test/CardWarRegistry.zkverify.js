const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CardWarRegistry zkVerify integration", function () {
  async function deployFixture() {
    const [owner, operator, other] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CardWarRegistry");
    const MockZkVerify = await ethers.getContractFactory("MockZkVerify");
    const domainId = 7;

    const registry = await Registry.deploy(domainId);
    await registry.waitForDeployment();
    const mock = await MockZkVerify.deploy();
    await mock.waitForDeployment();

    return { registry, mock, owner, operator, other, domainId };
  }

  it("allows only owner to set zkVerify", async function () {
    const { registry, mock, other } = await deployFixture();
    await expect(registry.connect(other).updateZkVerify(await mock.getAddress())).to.be
      .reverted;
    await expect(registry.updateZkVerify(await mock.getAddress()))
      .to.emit(registry, "ZkVerifyUpdated")
      .withArgs(await mock.getAddress());
  });

  it("forwards verifyProofAggregation to zkVerify contract", async function () {
    const { registry, mock, domainId } = await deployFixture();
    await registry.updateZkVerify(await mock.getAddress());

    const aggregationId = 123;
    const leaf = ethers.keccak256(ethers.toUtf8Bytes("leaf"));
    const merklePath = [ethers.keccak256(ethers.toUtf8Bytes("path0"))];
    const leafCount = 2;
    const leafIndex = 0;

    const isVerified = await registry.verifyProofAggregation(
      aggregationId,
      leaf,
      merklePath,
      leafCount,
      leafIndex,
    );

    expect(isVerified).to.equal(true);
  });

  it("allows only operator/owner to record verification", async function () {
    const { registry, mock, operator, other, domainId } = await deployFixture();
    await registry.updateZkVerify(await mock.getAddress());
    await registry.setOperator(operator.address, true);

    const gameKey = ethers.keccak256(ethers.toUtf8Bytes("game-1"));
    const aggregationId = 123;
    const leaf = ethers.keccak256(ethers.toUtf8Bytes("leaf"));
    const merklePath = [ethers.keccak256(ethers.toUtf8Bytes("path0"))];
    const leafCount = 2;
    const leafIndex = 0;

    await expect(
      registry.connect(other).recordProofAggregationVerification(
        gameKey,
        aggregationId,
        leaf,
        merklePath,
        leafCount,
        leafIndex,
      ),
    ).to.be.revertedWith("Not operator");

    await expect(
      registry.connect(operator).recordProofAggregationVerification(
        gameKey,
        aggregationId,
        leaf,
        merklePath,
        leafCount,
        leafIndex,
      ),
    )
      .to.emit(registry, "ProofAggregationVerified")
      .withArgs(gameKey, domainId, aggregationId, leaf, true, operator.address);
  });

  it("reverts record call when proof is invalid", async function () {
    const { registry, mock } = await deployFixture();
    await registry.updateZkVerify(await mock.getAddress());
    await mock.setVerifyResult(false);

    const gameKey = ethers.keccak256(ethers.toUtf8Bytes("game-2"));
    const leaf = ethers.keccak256(ethers.toUtf8Bytes("leaf"));
    const merklePath = [ethers.keccak256(ethers.toUtf8Bytes("path0"))];

    await expect(
      registry.recordProofAggregationVerification(
        gameKey,
        456,
        leaf,
        merklePath,
        2,
        0,
      ),
    ).to.be.revertedWith("Aggregation proof invalid");
  });
});
