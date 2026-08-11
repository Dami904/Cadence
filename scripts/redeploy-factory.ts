import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const keeperAuthorization = process.env.KEEPER_AUTHORIZATION_ADDRESS;

  if (!keeperAuthorization) {
    throw new Error("Set KEEPER_AUTHORIZATION_ADDRESS before redeploying CircleFactory.");
  }

  const forwarder = await ethers.deployContract("CadenceForwarder");
  await forwarder.waitForDeployment();

  const circleFactory = await ethers.deployContract("CircleFactory", [keeperAuthorization, await forwarder.getAddress()]);
  await circleFactory.waitForDeployment();

  console.table({
    keeperAuthorization,
    forwarder: await forwarder.getAddress(),
    circleFactory: await circleFactory.getAddress(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
