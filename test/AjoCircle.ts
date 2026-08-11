import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("AjoCircle", function () {
  async function deployFixture() {
    const { ethers } = hre;
    const [owner, memberTwo, memberThree, keeper] = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSDC");
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    await authorization.setKeeper(keeper.address, true);
    const factory = await ethers.deployContract("CircleFactory", [await authorization.getAddress(), ethers.ZeroAddress]);
    const contribution = 500_000_000n;
    const deadline = (await time.latest()) + 3_600;
    await factory.createCircle(
      await token.getAddress(), contribution, contribution, 3, 30 * 24 * 60 * 60, deadline
    );
    const circle = await ethers.getContractAt("AjoCircle", await factory.circleAt(0));
    for (const member of [owner, memberTwo, memberThree]) {
      await token.mint(member.address, 5_000_000_000n);
      await token.connect(member).approve(await circle.getAddress(), 5_000_000_000n);
      await circle.connect(member).join();
    }
    return { owner, memberTwo, memberThree, keeper, token, authorization, factory, circle, contribution, deadline };
  }

  it("locks join order at circle start and pays the scheduled recipient after a default is covered", async function () {
    const { owner, memberTwo, memberThree, keeper, token, factory, circle, contribution, deadline } = await deployFixture();
    await circle.start();
    expect(await circle.creator()).to.equal(owner.address);
    expect((await factory.getCircle(await circle.getAddress())).status).to.equal(1n);
    await expect(circle.connect(owner).join()).to.be.revertedWithCustomError(circle, "InvalidStatus");

    await circle.connect(memberTwo).contribute();
    await circle.connect(memberThree).contribute();
    await time.increaseTo(deadline);
    await expect(circle.connect(keeper).executePayout(1)).to.be.revertedWithCustomError(circle, "FundingIncomplete");
    await expect(circle.connect(keeper).checkAndCoverDefault(1, owner.address))
      .to.emit(circle, "DefaultCovered").withArgs(1, owner.address, contribution);
    await expect(circle.connect(keeper).executePayout(1))
      .to.emit(circle, "PayoutExecuted").withArgs(1, owner.address, contribution * 3n);

    expect(await circle.currentRound()).to.equal(2n);
    expect(await circle.recipientForRound(2)).to.equal(memberTwo.address);
    expect(await circle.securityDepositBalance(owner.address)).to.equal(0n);
    expect(await token.balanceOf(owner.address)).to.equal(6_000_000_000n);
  });

  it("lets a member leave and reclaim their deposit while forming, but locks that in once the circle starts", async function () {
    const { memberThree, token, circle } = await deployFixture();
    const balanceBeforeLeave = await token.balanceOf(memberThree.address);

    await expect(circle.connect(memberThree).leave())
      .to.emit(circle, "MemberLeft").withArgs(memberThree.address, 500_000_000n);

    expect(await circle.isMember(memberThree.address)).to.equal(false);
    expect(await circle.securityDepositBalance(memberThree.address)).to.equal(0n);
    expect(await circle.memberCount()).to.equal(2n);
    expect(await token.balanceOf(memberThree.address)).to.equal(balanceBeforeLeave + 500_000_000n);

    // Circle is short a member again — cannot start until someone fills the slot.
    await expect(circle.start()).to.be.revertedWithCustomError(circle, "InvalidStatus");

    await circle.connect(memberThree).join();
    await circle.start();

    await expect(circle.connect(memberThree).leave()).to.be.revertedWithCustomError(circle, "InvalidStatus");
  });

  it("returns every member's deposit once the circle completes its final round", async function () {
    const { owner, memberTwo, memberThree, keeper, token, circle, deadline } = await deployFixture();
    await circle.start();

    let roundDeadline = deadline;
    for (const round of [1, 2, 3]) {
      await circle.connect(owner).contribute();
      await circle.connect(memberTwo).contribute();
      await circle.connect(memberThree).contribute();
      roundDeadline = Number(await circle.currentRoundDeadline());
      await time.increaseTo(roundDeadline);
      await circle.connect(keeper).executePayout(round);
    }

    expect(await circle.status()).to.equal(2n); // Completed
    for (const member of [owner, memberTwo, memberThree]) {
      expect(await circle.securityDepositBalance(member.address)).to.equal(0n);
      expect(await token.balanceOf(member.address)).to.equal(5_000_000_000n);
    }
  });

  it("lets another member cover a fellow member's deposit so a second default doesn't permanently stall the circle", async function () {
    const { owner, memberTwo, memberThree, keeper, circle, contribution, deadline } = await deployFixture();
    await circle.start();

    // Round 1: owner defaults, deposit drawn to zero, payout still ships.
    await circle.connect(memberTwo).contribute();
    await circle.connect(memberThree).contribute();
    await time.increaseTo(deadline);
    await circle.connect(keeper).checkAndCoverDefault(1, owner.address);
    await circle.connect(keeper).executePayout(1);
    expect(await circle.securityDepositBalance(owner.address)).to.equal(0n);

    // Round 2: owner defaults again with nothing left to draw — permanently stuck without help.
    await circle.connect(memberTwo).contribute();
    await circle.connect(memberThree).contribute();
    const round2Deadline = await circle.currentRoundDeadline();
    await time.increaseTo(round2Deadline);
    await expect(circle.connect(keeper).checkAndCoverDefault(2, owner.address))
      .to.be.revertedWithCustomError(circle, "DepositInsufficient");
    await expect(circle.connect(keeper).executePayout(2))
      .to.be.revertedWithCustomError(circle, "FundingIncomplete");

    // Another member rescues it — no admin, no single point of override.
    await expect(circle.connect(memberTwo).coverDeposit(owner.address))
      .to.emit(circle, "DepositCovered").withArgs(memberTwo.address, owner.address, contribution);
    expect(await circle.securityDepositBalance(owner.address)).to.equal(contribution);

    await expect(circle.connect(keeper).checkAndCoverDefault(2, owner.address))
      .to.emit(circle, "DefaultCovered").withArgs(2, owner.address, contribution);
    await expect(circle.connect(keeper).executePayout(2))
      .to.emit(circle, "PayoutExecuted").withArgs(2, memberTwo.address, contribution * 3n);
  });
});
