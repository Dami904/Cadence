import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ERC-2771 relay", function () {
  async function deployFixture() {
    const { ethers } = hre;
    const [owner, memberTwo, relayer] = await ethers.getSigners();
    const token = await ethers.deployContract("MockUSDC");
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);
    const forwarder = await ethers.deployContract("CadenceForwarder");
    const factory = await ethers.deployContract("CircleFactory", [await authorization.getAddress(), await forwarder.getAddress()]);
    const contribution = 500_000_000n;
    const deadline = (await time.latest()) + 3_600;
    const formingDeadline = (await time.latest()) + 7 * 24 * 60 * 60;
    await factory.createCircle(await token.getAddress(), contribution, contribution * 2n, 2, 30 * 24 * 60 * 60, deadline, formingDeadline);
    const circle = await ethers.getContractAt("AjoCircle", await factory.circleAt(0));

    await token.mint(memberTwo.address, 5_000_000_000n);
    await token.connect(memberTwo).approve(await circle.getAddress(), 5_000_000_000n);

    return { ethers, owner, memberTwo, relayer, token, forwarder, factory, circle, contribution };
  }

  async function signForwardRequest(
    ethers: typeof import("hardhat")["ethers"],
    forwarder: any,
    signer: any,
    to: string,
    data: string,
  ) {
    const network = await ethers.provider.getNetwork();
    const nonce = await forwarder.nonces(signer.address);
    // Anchor to the chain's own clock, not wall-clock time — earlier tests in this run may have
    // fast-forwarded the simulated chain by weeks via time.increaseTo(), which persists for the
    // rest of the process and would otherwise make a wall-clock deadline look already expired.
    const latestBlock = await ethers.provider.getBlock("latest");
    const deadline = BigInt(latestBlock!.timestamp + 3600);
    const domain = { name: "Cadence", version: "1", chainId: network.chainId, verifyingContract: await forwarder.getAddress() };
    const types = {
      ForwardRequest: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint48" },
        { name: "data", type: "bytes" },
      ],
    };
    const value = { from: signer.address, to, value: 0n, gas: 300_000n, nonce, deadline, data };
    const signature = await signer.signTypedData(domain, types, value);
    return { from: signer.address, to, value: 0n, gas: 300_000n, deadline, data, signature };
  }

  it("lets a relayer submit join() on a member's behalf — msg.sender resolves to the signer, not the relayer, and the relayer pays gas", async function () {
    const { ethers, memberTwo, relayer, token, forwarder, circle } = await deployFixture();

    const data = circle.interface.encodeFunctionData("join");
    const request = await signForwardRequest(ethers, forwarder, memberTwo, await circle.getAddress(), data);

    expect(await forwarder.connect(relayer).verify(request)).to.equal(true);

    const relayerBalanceBefore = await ethers.provider.getBalance(relayer.address);
    const memberBalanceBefore = await ethers.provider.getBalance(memberTwo.address);

    const tx = await forwarder.connect(relayer).execute(request);
    const receipt = await tx.wait();

    expect(await circle.isMember(memberTwo.address)).to.equal(true);
    expect(await circle.memberCount()).to.equal(1n);
    expect(await token.balanceOf(memberTwo.address)).to.equal(4_000_000_000n);

    // The relayer's own wallet paid the gas; the member's ETH balance never moved.
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    expect(await ethers.provider.getBalance(relayer.address)).to.equal(relayerBalanceBefore - gasCost);
    expect(await ethers.provider.getBalance(memberTwo.address)).to.equal(memberBalanceBefore);
  });

  it("rejects a relayed request whose signer doesn't match the claimed from address", async function () {
    const { ethers, owner, memberTwo, relayer, forwarder, circle } = await deployFixture();

    const data = circle.interface.encodeFunctionData("join");
    const request = await signForwardRequest(ethers, forwarder, owner, await circle.getAddress(), data);
    request.from = memberTwo.address; // tampered: claims to be memberTwo but signed by owner

    expect(await forwarder.connect(relayer).verify(request)).to.equal(false);
    await expect(forwarder.connect(relayer).execute(request)).to.be.reverted;
  });
});
