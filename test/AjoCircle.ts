import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("AjoCircle", function () {
  async function deployFixture() {
    const { ethers } = hre;
    const [owner, memberTwo, memberThree, keeper, outsider] = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSDC");
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    await authorization.setKeeper(keeper.address, true);
    const factory = await ethers.deployContract("CircleFactory", [await authorization.getAddress(), ethers.ZeroAddress]);
    const contribution = 500_000_000n;
    const deposit = contribution * 2n;
    const deadline = (await time.latest()) + 3_600;
    const formingDeadline = (await time.latest()) + 7 * 24 * 60 * 60;
    await factory.createCircle(
      await token.getAddress(), contribution, deposit, 3, 30 * 24 * 60 * 60, deadline, formingDeadline
    );
    const circle = await ethers.getContractAt("AjoCircle", await factory.circleAt(0));
    for (const member of [owner, memberTwo, memberThree]) {
      await token.mint(member.address, 5_000_000_000n);
      await token.connect(member).approve(await circle.getAddress(), 5_000_000_000n);
      await circle.connect(member).join();
    }
    return { owner, memberTwo, memberThree, keeper, outsider, token, authorization, factory, circle, contribution, deposit, deadline, formingDeadline };
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
    expect(await circle.securityDepositBalance(owner.address)).to.equal(contribution);
    expect(await token.balanceOf(owner.address)).to.equal(5_500_000_000n);
  });

  it("lets a member leave and reclaim their deposit while forming, but locks that in once the circle starts", async function () {
    const { memberThree, token, circle, deposit } = await deployFixture();
    const balanceBeforeLeave = await token.balanceOf(memberThree.address);

    await expect(circle.connect(memberThree).leave())
      .to.emit(circle, "MemberLeft").withArgs(memberThree.address, deposit);

    expect(await circle.isMember(memberThree.address)).to.equal(false);
    expect(await circle.securityDepositBalance(memberThree.address)).to.equal(0n);
    expect(await circle.memberCount()).to.equal(2n);
    expect(await token.balanceOf(memberThree.address)).to.equal(balanceBeforeLeave + deposit);

    // Circle is short a member again — cannot start until someone fills the slot.
    await expect(circle.start()).to.be.revertedWithCustomError(circle, "InvalidStatus");

    await circle.connect(memberThree).join();
    await circle.start();

    await expect(circle.connect(memberThree).leave()).to.be.revertedWithCustomError(circle, "InvalidStatus");
  });

  it("cancels a circle abandoned past its forming deadline and lets remaining members pull their own refund", async function () {
    const { ethers } = hre;
    const [owner, memberTwo, , , outsider] = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSDC");
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    const factory = await ethers.deployContract("CircleFactory", [await authorization.getAddress(), ethers.ZeroAddress]);
    const contribution = 500_000_000n;
    const deposit = contribution * 2n;
    const deadline = (await time.latest()) + 3_600;
    const formingDeadline = (await time.latest()) + 3_600;
    // Target of 3, only 2 ever join — this circle never fills and its creator disappears.
    await factory.createCircle(await token.getAddress(), contribution, deposit, 3, 30 * 24 * 60 * 60, deadline, formingDeadline);
    const circle = await ethers.getContractAt("AjoCircle", await factory.circleAt(0));
    for (const member of [owner, memberTwo]) {
      await token.mint(member.address, 5_000_000_000n);
      await token.connect(member).approve(await circle.getAddress(), 5_000_000_000n);
      await circle.connect(member).join();
    }

    await expect(circle.connect(outsider).cancelIfExpired()).to.be.revertedWithCustomError(circle, "DeadlineNotReached");
    await expect(circle.connect(owner).withdrawAfterCancel()).to.be.revertedWithCustomError(circle, "InvalidStatus");

    await time.increaseTo(formingDeadline);
    // Anyone can trigger it — same permission model as start(), no admin role.
    await expect(circle.connect(outsider).cancelIfExpired()).to.emit(circle, "CircleCancelled");
    expect(await circle.status()).to.equal(3n); // Cancelled
    expect((await factory.getCircle(await circle.getAddress())).status).to.equal(3n);

    await expect(circle.connect(outsider).cancelIfExpired()).to.be.revertedWithCustomError(circle, "InvalidStatus");

    const balanceBefore = await token.balanceOf(owner.address);
    await expect(circle.connect(owner).withdrawAfterCancel())
      .to.emit(circle, "DepositReturned").withArgs(owner.address, deposit);
    expect(await token.balanceOf(owner.address)).to.equal(balanceBefore + deposit);

    // Pull-pattern: can't withdraw twice, and a non-member never had anything to withdraw.
    await expect(circle.connect(owner).withdrawAfterCancel()).to.be.revertedWithCustomError(circle, "NothingToWithdraw");
    await expect(circle.connect(outsider).withdrawAfterCancel()).to.be.revertedWithCustomError(circle, "MemberOnly");
  });

  it("returns every member's deposit once the circle completes its final round", async function () {
    const { owner, memberTwo, memberThree, keeper, token, circle, deposit, deadline } = await deployFixture();
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
      // 3 contributions out + deposit out, one full pot in + deposit back at completion — nets to zero.
      expect(await token.balanceOf(member.address)).to.equal(5_000_000_000n);
    }
    void deposit;
  });

  it("lets another member cover a fellow member's deposit so a third default doesn't permanently stall the circle", async function () {
    const { owner, memberTwo, memberThree, keeper, circle, contribution, deposit, deadline } = await deployFixture();
    await circle.start();

    // Round 1: owner defaults, deposit drawn from 2x to 1x contribution — still enough to self-cover once more.
    await circle.connect(memberTwo).contribute();
    await circle.connect(memberThree).contribute();
    await time.increaseTo(deadline);
    await expect(circle.connect(keeper).checkAndCoverDefault(1, owner.address))
      .to.emit(circle, "DefaultCovered").withArgs(1, owner.address, contribution);
    await circle.connect(keeper).executePayout(1);
    expect(await circle.securityDepositBalance(owner.address)).to.equal(contribution);

    // Round 2: owner defaults again, deposit drawn to exactly zero.
    await circle.connect(memberTwo).contribute();
    await circle.connect(memberThree).contribute();
    let roundDeadline = await circle.currentRoundDeadline();
    await time.increaseTo(roundDeadline);
    await expect(circle.connect(keeper).checkAndCoverDefault(2, owner.address))
      .to.emit(circle, "DefaultCovered").withArgs(2, owner.address, contribution);
    await circle.connect(keeper).executePayout(2);
    expect(await circle.securityDepositBalance(owner.address)).to.equal(0n);

    // Round 3: owner defaults a third time with nothing left to draw — permanently stuck without help.
    await circle.connect(memberTwo).contribute();
    await circle.connect(memberThree).contribute();
    roundDeadline = await circle.currentRoundDeadline();
    await time.increaseTo(roundDeadline);
    await expect(circle.connect(keeper).checkAndCoverDefault(3, owner.address))
      .to.emit(circle, "DefaultUncovered").withArgs(3, owner.address);
    await expect(circle.connect(keeper).executePayout(3))
      .to.be.revertedWithCustomError(circle, "FundingIncomplete");

    // Another member rescues it — no admin, no single point of override.
    await expect(circle.connect(memberTwo).coverDeposit(owner.address))
      .to.emit(circle, "DepositCovered").withArgs(memberTwo.address, owner.address, deposit);
    expect(await circle.securityDepositBalance(owner.address)).to.equal(deposit);

    await expect(circle.connect(keeper).checkAndCoverDefault(3, owner.address))
      .to.emit(circle, "DefaultCovered").withArgs(3, owner.address, contribution);
    await expect(circle.connect(keeper).executePayout(3))
      .to.emit(circle, "PayoutExecuted").withArgs(3, memberThree.address, contribution * 3n)
      .and.to.emit(circle, "CircleCompleted").withArgs(3);
  });

  it("rejects joining twice and joining a circle that's already full", async function () {
    const { owner, outsider, circle, token } = await deployFixture();

    await expect(circle.connect(owner).join()).to.be.revertedWithCustomError(circle, "AlreadyMember");

    await token.mint(outsider.address, 5_000_000_000n);
    await token.connect(outsider).approve(await circle.getAddress(), 5_000_000_000n);
    await expect(circle.connect(outsider).join()).to.be.revertedWithCustomError(circle, "CircleFull");
  });

  it("rejects contributing twice in the same round and contributing after the window closes", async function () {
    const { owner, memberTwo, circle, deadline } = await deployFixture();
    await circle.start();

    await circle.connect(owner).contribute();
    await expect(circle.connect(owner).contribute()).to.be.revertedWithCustomError(circle, "AlreadyContributed");

    await time.increaseTo(deadline);
    await expect(circle.connect(memberTwo).contribute()).to.be.revertedWithCustomError(circle, "ContributionWindowClosed");
  });

  it("rejects checking a default or executing a payout before the round deadline is reached", async function () {
    const { owner, memberTwo, memberThree, keeper, circle } = await deployFixture();
    await circle.start();
    await circle.connect(memberTwo).contribute();
    await circle.connect(memberThree).contribute();

    await expect(circle.connect(keeper).checkAndCoverDefault(1, owner.address))
      .to.be.revertedWithCustomError(circle, "DeadlineNotReached");
    await expect(circle.connect(keeper).executePayout(1))
      .to.be.revertedWithCustomError(circle, "DeadlineNotReached");
  });
});
