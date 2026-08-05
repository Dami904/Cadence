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
    const factory = await ethers.deployContract("CircleFactory", [await authorization.getAddress()]);
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
});
