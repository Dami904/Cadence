import { expect } from "chai";
import hre from "hardhat";
import { ZeroAddress } from "ethers";

describe("KeeperAuthorization", function () {
  it("lets only the owner authorize or revoke keepers", async function () {
    const { ethers } = hre;
    const [owner, other, keeper] = await ethers.getSigners();
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);

    expect(await authorization.isKeeper(keeper.address)).to.equal(false);

    await expect(authorization.connect(other).setKeeper(keeper.address, true))
      .to.be.revertedWithCustomError(authorization, "OwnableUnauthorizedAccount")
      .withArgs(other.address);

    await expect(authorization.setKeeper(keeper.address, true))
      .to.emit(authorization, "KeeperAuthorizationUpdated").withArgs(keeper.address, true);
    expect(await authorization.isKeeper(keeper.address)).to.equal(true);

    await expect(authorization.setKeeper(keeper.address, false))
      .to.emit(authorization, "KeeperAuthorizationUpdated").withArgs(keeper.address, false);
    expect(await authorization.isKeeper(keeper.address)).to.equal(false);
  });

  it("rejects authorizing the zero address", async function () {
    const { ethers } = hre;
    const [owner] = await ethers.getSigners();
    const authorization = await ethers.deployContract("KeeperAuthorization", [owner.address]);

    await expect(authorization.setKeeper(ZeroAddress, true)).to.be.revertedWithCustomError(authorization, "ZeroAddress");
  });
});
