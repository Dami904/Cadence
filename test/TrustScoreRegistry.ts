import { expect } from "chai";
import hre from "hardhat";

describe("TrustScoreRegistry", function () {
  it("records ERC-8004 feedback only through an authorized keeper", async function () {
    const { ethers } = hre;
    const [owner, member, keeper] = await ethers.getSigners();
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    const identity = await ethers.deployContract("MockERC8004IdentityRegistry");
    const reputation = await ethers.deployContract("MockERC8004ReputationRegistry");
    const forwarder = await ethers.deployContract("CadenceForwarder");
    await identity.setOwner(42, member.address);
    const registry = await ethers.deployContract("TrustScoreRegistry", [
      await identity.getAddress(), await reputation.getAddress(), await authorization.getAddress(), await forwarder.getAddress(),
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

  it("records a default via recordDefault, and skips outcome recording for a member with no linked identity", async function () {
    const { ethers } = hre;
    const [owner, member, unlinkedMember, keeper] = await ethers.getSigners();
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    const identity = await ethers.deployContract("MockERC8004IdentityRegistry");
    const reputation = await ethers.deployContract("MockERC8004ReputationRegistry");
    const forwarder = await ethers.deployContract("CadenceForwarder");
    await identity.setOwner(7, member.address);
    const registry = await ethers.deployContract("TrustScoreRegistry", [
      await identity.getAddress(), await reputation.getAddress(), await authorization.getAddress(), await forwarder.getAddress(),
    ]);
    await authorization.setKeeper(keeper.address, true);
    await registry.connect(member).linkIdentity(7);

    await expect(registry.connect(keeper).recordDefault(member.address))
      .to.emit(registry, "OutcomeRecorded").withArgs(member.address, 7, -100, "cadence-contribution-default");
    expect(await reputation.feedbackCount()).to.equal(1n);
    const feedback = await reputation.feedback(0);
    expect(feedback.value).to.equal(-100n);
    expect(feedback.tag1).to.equal("cadence-contribution-default");

    // A member who never linked an ERC-8004 identity has nowhere to post feedback to — skip,
    // don't revert, so one unlinked member can't block the keeper workflow processing everyone else.
    await expect(registry.connect(keeper).recordDefault(unlinkedMember.address))
      .to.emit(registry, "OutcomeSkipped").withArgs(unlinkedMember.address, "ERC-8004 identity not linked");
    expect(await reputation.feedbackCount()).to.equal(1n);
  });
});
