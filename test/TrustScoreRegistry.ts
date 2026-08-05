import { expect } from "chai";
import hre from "hardhat";

describe("TrustScoreRegistry", function () {
  it("records ERC-8004 feedback only through an authorized keeper", async function () {
    const { ethers } = hre;
    const [owner, member, keeper] = await ethers.getSigners();
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    const identity = await ethers.deployContract("MockERC8004IdentityRegistry");
    const reputation = await ethers.deployContract("MockERC8004ReputationRegistry");
    await identity.setOwner(42, member.address);
    const registry = await ethers.deployContract("TrustScoreRegistry", [
      await identity.getAddress(), await reputation.getAddress(), await authorization.getAddress(),
    ]);

    await registry.connect(member).linkIdentity(42);
    await expect(registry.recordCompletion(member.address)).to.be.revertedWithCustomError(registry, "KeeperOnly");
    await authorization.setKeeper(keeper.address, true);
    await expect(registry.connect(keeper).recordCompletion(member.address))
      .to.emit(registry, "OutcomeRecorded").withArgs(member.address, 42, 100, "cadence-circle-completion");

    expect(await reputation.feedbackCount()).to.equal(1n);
    const feedback = await reputation.feedback(0);
    expect(feedback.agentId).to.equal(42n);
    expect(feedback.value).to.equal(100n);
    expect(feedback.tag1).to.equal("cadence-circle-completion");
  });
});
