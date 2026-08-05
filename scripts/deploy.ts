import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const identityRegistry = process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS;
  const reputationRegistry = process.env.ERC8004_REPUTATION_REGISTRY_ADDRESS;
  const keeperWallet = process.env.KEEPERHUB_WALLET_ADDRESS;

  if (!identityRegistry || !reputationRegistry || !keeperWallet) {
    throw new Error(
      "Set ERC8004_IDENTITY_REGISTRY_ADDRESS, ERC8004_REPUTATION_REGISTRY_ADDRESS, and KEEPERHUB_WALLET_ADDRESS before deployment."
    );
  }

  const keeperAuthorization = await ethers.deployContract("KeeperAuthorization", [deployer.address]);
  await keeperAuthorization.waitForDeployment();
  await (await keeperAuthorization.setKeeper(keeperWallet, true)).wait();

  const trustScoreRegistry = await ethers.deployContract("TrustScoreRegistry", [
    identityRegistry,
    reputationRegistry,
    await keeperAuthorization.getAddress(),
  ]);
  await trustScoreRegistry.waitForDeployment();

  const circleFactory = await ethers.deployContract("CircleFactory", [await keeperAuthorization.getAddress()]);
  await circleFactory.waitForDeployment();

  console.table({
    deployer: deployer.address,
    keeperAuthorization: await keeperAuthorization.getAddress(),
    trustScoreRegistry: await trustScoreRegistry.getAddress(),
    circleFactory: await circleFactory.getAddress(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
