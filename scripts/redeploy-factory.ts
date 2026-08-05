import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const keeperAuthorization = process.env.KEEPER_AUTHORIZATION_ADDRESS;

  if (!keeperAuthorization) {
    throw new Error("Set KEEPER_AUTHORIZATION_ADDRESS before redeploying CircleFactory.");
  }

  const circleFactory = await ethers.deployContract("CircleFactory", [keeperAuthorization]);
  await circleFactory.waitForDeployment();

  console.table({
    keeperAuthorization,
    circleFactory: await circleFactory.getAddress(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
