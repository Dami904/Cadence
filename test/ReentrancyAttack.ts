import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Every other test in this repo funds circles with MockUSDC, which is well-behaved and has no
// hooks — so nonReentrant is asserted everywhere but never actually exercised against a token
// that tries to abuse it. This file uses MaliciousReentrantERC20, which can be armed to call back
// into AjoCircle mid-transfer, to prove the guard holds against a genuinely hostile asset.
//
// Both tests deliberately satisfy the access-control check (onlyKeeper / onlyMember) for the
// reentrant call too, either by authorizing the token itself as a keeper, or by having the token
// itself be a genuine circle member (via an impersonated signer). That isolates what's actually
// under test — nonReentrant — from the access-control layer, which would otherwise block a naive
// reentrant attempt on its own and leave nonReentrant itself unexercised.
describe("AjoCircle reentrancy resistance against a hostile ERC20", function () {
  it("rejects a payout recipient's token trying to re-enter executePayout mid-transfer", async function () {
    const { ethers } = hre;
    const [owner, memberTwo, keeper] = await ethers.getSigners();
    const token = await ethers.deployContract("MaliciousReentrantERC20");
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    await authorization.setKeeper(keeper.address, true);
    // The reentrant call's msg.sender is the token contract itself — authorizing it as a keeper
    // too means a failure here can only be nonReentrant doing its job, not onlyKeeper incidentally
    // blocking an unauthorized caller.
    await authorization.setKeeper(await token.getAddress(), true);
    const factory = await ethers.deployContract("CircleFactory", [await authorization.getAddress(), ethers.ZeroAddress]);
    const contribution = 500_000_000n;
    const deposit = contribution * 2n;
    const deadline = (await time.latest()) + 3_600;
    const formingDeadline = (await time.latest()) + 7 * 24 * 60 * 60;
    await factory.createCircle(await token.getAddress(), contribution, deposit, 2, 30 * 24 * 60 * 60, deadline, formingDeadline);
    const circle = await ethers.getContractAt("AjoCircle", await factory.circleAt(0));

    for (const member of [owner, memberTwo]) {
      await token.mint(member.address, 5_000_000_000n);
      await token.connect(member).approve(await circle.getAddress(), 5_000_000_000n);
      await circle.connect(member).join();
    }
    await circle.start();
    await circle.connect(owner).contribute();
    await circle.connect(memberTwo).contribute();
    await time.increaseTo(deadline);

    // Arms the token so the safeTransfer() call inside executePayout(1) — paying the round 1
    // recipient — calls straight back into executePayout(1) again before the first call finishes.
    await token.arm(await circle.getAddress(), circle.interface.encodeFunctionData("executePayout", [1]));

    const potBefore = await token.balanceOf(await circle.getAddress());
    await expect(circle.connect(keeper).executePayout(1)).to.be.revertedWithCustomError(circle, "ReentrancyGuardReentrantCall");

    // The whole outer call reverted along with the reentrant attempt — nothing was left
    // half-applied: still round 1, funding untouched, pot still fully sitting in the contract.
    expect(await circle.currentRound()).to.equal(1n);
    expect(await circle.currentRoundFunding()).to.equal(contribution * 2n);
    expect(await token.balanceOf(await circle.getAddress())).to.equal(potBefore);
  });

  it("rejects a member token trying to re-enter contribute mid-transferFrom", async function () {
    const { ethers, network } = hre;
    const [owner, keeper] = await ethers.getSigners();
    const token = await ethers.deployContract("MaliciousReentrantERC20");
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    await authorization.setKeeper(keeper.address, true);
    const factory = await ethers.deployContract("CircleFactory", [await authorization.getAddress(), ethers.ZeroAddress]);
    const contribution = 500_000_000n;
    const deposit = contribution * 2n;
    const deadline = (await time.latest()) + 3_600;
    const formingDeadline = (await time.latest()) + 7 * 24 * 60 * 60;
    await factory.createCircle(await token.getAddress(), contribution, deposit, 2, 30 * 24 * 60 * 60, deadline, formingDeadline);
    const circle = await ethers.getContractAt("AjoCircle", await factory.circleAt(0));
    const tokenAddress = await token.getAddress();

    // The token contract is itself made a genuine circle member — not a shortcut around onlyMember,
    // but the only way to prove nonReentrant specifically, rather than onlyMember incidentally,
    // is what blocks the reentrant contribute() below. Impersonation lets the test drive
    // transactions as the token's own address, exactly like a real hostile token's hook would run
    // in the token contract's own execution context.
    await network.provider.send("hardhat_setBalance", [tokenAddress, "0x56BC75E2D63100000"]); // 100 ETH for gas
    const tokenSigner = await ethers.getImpersonatedSigner(tokenAddress);
    await token.mint(tokenAddress, 5_000_000_000n);
    await token.connect(tokenSigner).approve(await circle.getAddress(), 5_000_000_000n);
    await circle.connect(tokenSigner).join();

    await token.mint(owner.address, 5_000_000_000n);
    await token.connect(owner).approve(await circle.getAddress(), 5_000_000_000n);
    await circle.connect(owner).join();
    await circle.start();

    // Arms the token so the safeTransferFrom() call inside its own contribute() — pulling this
    // round's contribution from the token's own balance — calls straight back into contribute()
    // again for the same member, same round, before the first call finishes.
    await token.arm(await circle.getAddress(), circle.interface.encodeFunctionData("contribute"));

    // Plain try/catch rather than revertedWithCustomError() here: hardhat-chai-matchers'
    // decoding of that matcher doesn't cleanly resolve a revert reached through an impersonated
    // signer (ethers.getImpersonatedSigner) — the transaction does revert with exactly
    // ReentrancyGuardReentrantCall, confirmed directly in the raw error below, the matcher just
    // can't parse it from that specific call path.
    let threw = false;
    let reason = "";
    try {
      await circle.connect(tokenSigner).contribute({ gasLimit: 500_000 });
    } catch (err) {
      threw = true;
      reason = err instanceof Error ? err.message : String(err);
    }
    expect(threw, "expected the reentrant contribute() call to revert").to.equal(true);
    expect(reason).to.include("ReentrancyGuardReentrantCall");

    // The whole reentrant transaction reverted, which rolls back every state change made during
    // it — including arm()'s own one-shot disarm — so the token is still armed at this point.
    // Nothing was recorded from the reverted attempt either way; explicitly disarming here just
    // proves the token-as-member can still contribute cleanly once it stops trying to misbehave.
    await token.disarm();
    expect(await circle.contributed(1, tokenAddress)).to.equal(false);
    expect(await circle.currentRoundFunding()).to.equal(0n);
    await expect(circle.connect(tokenSigner).contribute())
      .to.emit(circle, "ContributionMade").withArgs(1, tokenAddress, contribution);
  });
});
