import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("CircleFactory", function () {
  async function deployFixture() {
    const { ethers } = hre;
    const [owner, memberTwo, memberThree] = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSDC");
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    const factory = await ethers.deployContract("CircleFactory", [await authorization.getAddress(), ethers.ZeroAddress]);
    const contribution = 500_000_000n;
    const deadline = (await time.latest()) + 3_600;
    return { owner, memberTwo, memberThree, token, authorization, factory, contribution, deadline };
  }

  it("deploys a circle, records discovery metadata, and emits CircleCreated", async function () {
    const { owner, token, factory, contribution, deadline } = await deployFixture();

    expect(await factory.circleCount()).to.equal(0n);

    const tx = await factory.createCircle(await token.getAddress(), contribution, contribution, 3, 30 * 24 * 60 * 60, deadline);
    const circleAddress = await factory.circleAt(0);
    await expect(tx).to.emit(factory, "CircleCreated").withArgs(circleAddress, 3n, await token.getAddress(), owner.address);

    expect(await factory.circleCount()).to.equal(1n);
    expect(await factory.isCircle(circleAddress)).to.equal(true);

    const record = await factory.getCircle(circleAddress);
    expect(record.circle).to.equal(circleAddress);
    expect(record.targetMemberCount).to.equal(3n);
    expect(record.status).to.equal(0n);
  });

  it("rejects onCircleStatusChanged from anything but the circle itself, and reflects real status transitions", async function () {
    const { owner, memberTwo, memberThree, token, factory, contribution, deadline } = await deployFixture();

    await factory.createCircle(await token.getAddress(), contribution, contribution, 3, 30 * 24 * 60 * 60, deadline);
    const circleAddress = await factory.circleAt(0);
    const circle = await hre.ethers.getContractAt("AjoCircle", circleAddress);

    await expect(factory.onCircleStatusChanged(1)).to.be.revertedWithCustomError(factory, "CircleOnly");

    for (const member of [owner, memberTwo, memberThree]) {
      await token.mint(member.address, 5_000_000_000n);
      await token.connect(member).approve(circleAddress, 5_000_000_000n);
      await circle.connect(member).join();
    }

    await expect(circle.start()).to.emit(factory, "CircleStatusUpdated").withArgs(circleAddress, 1);
    expect((await factory.getCircle(circleAddress)).status).to.equal(1n);
  });
});
