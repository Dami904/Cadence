import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const keeperAuthorization = process.env.KEEPER_AUTHORIZATION_ADDRESS;
  const identityRegistry = process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS;
  const reputationRegistry = process.env.ERC8004_REPUTATION_REGISTRY_ADDRESS;

  if (!keeperAuthorization || !identityRegistry || !reputationRegistry) {
    throw new Error(
      "Set KEEPER_AUTHORIZATION_ADDRESS, ERC8004_IDENTITY_REGISTRY_ADDRESS, and ERC8004_REPUTATION_REGISTRY_ADDRESS before redeploying TrustScoreRegistry."
    );
  }

  // Reuse the existing forwarder when CADENCE_FORWARDER_ADDRESS is already set — same reasoning
  // as redeploy-factory.ts, so this registry-only redeploy (picking up gas-abstracted
  // linkIdentity/unlinkIdentity) doesn't require re-pointing anything else at a new forwarder.
  const existingForwarder = process.env.CADENCE_FORWARDER_ADDRESS;
  const forwarderAddress = existingForwarder ?? (async () => {
    const forwarder = await ethers.deployContract("CadenceForwarder");
    await forwarder.waitForDeployment();
    return forwarder.getAddress();
  })();
  const resolvedForwarderAddress = typeof forwarderAddress === "string" ? forwarderAddress : await forwarderAddress;

  const trustScoreRegistry = await ethers.deployContract("TrustScoreRegistry", [
    identityRegistry,
    reputationRegistry,
    keeperAuthorization,
    resolvedForwarderAddress,
  ]);
  await trustScoreRegistry.waitForDeployment();

  console.table({
    keeperAuthorization,
    identityRegistry,
    reputationRegistry,
    forwarder: resolvedForwarderAddress,
    forwarderReused: Boolean(existingForwarder),
    trustScoreRegistry: await trustScoreRegistry.getAddress(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
