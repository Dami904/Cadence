import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const keeperAuthorization = process.env.KEEPER_AUTHORIZATION_ADDRESS;

  if (!keeperAuthorization) {
    throw new Error("Set KEEPER_AUTHORIZATION_ADDRESS before redeploying CircleFactory.");
  }

  // Reuse the existing forwarder when CADENCE_FORWARDER_ADDRESS is already set, so a factory-only
  // redeploy (e.g. AjoCircle's constructor gaining a new param) doesn't orphan every already-deployed
  // circle from the forwarder they were built to trust, or require re-authorizing meta-tx relaying
  // against a brand-new forwarder address for no reason.
  const existingForwarder = process.env.CADENCE_FORWARDER_ADDRESS;
  const forwarderAddress = existingForwarder ?? (async () => {
    const forwarder = await ethers.deployContract("CadenceForwarder");
    await forwarder.waitForDeployment();
    return forwarder.getAddress();
  })();
  const resolvedForwarderAddress = typeof forwarderAddress === "string" ? forwarderAddress : await forwarderAddress;

  const circleFactory = await ethers.deployContract("CircleFactory", [keeperAuthorization, resolvedForwarderAddress]);
  await circleFactory.waitForDeployment();

  console.table({
    keeperAuthorization,
    forwarder: resolvedForwarderAddress,
    forwarderReused: Boolean(existingForwarder),
    circleFactory: await circleFactory.getAddress(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
