import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wallet } from "ethers";

const environmentPath = resolve(process.cwd(), ".env");
const existing = existsSync(environmentPath) ? readFileSync(environmentPath, "utf8") : "";

if (/^DEPLOYER_PRIVATE_KEY=/m.test(existing) || /^DEPLOYER_ADDRESS=/m.test(existing)) {
  throw new Error("Refusing to overwrite an existing deployer wallet in .env.");
}

const wallet = Wallet.createRandom();
const additions = [
  "# Local Base Sepolia deployer wallet. Keep this file private.",
  `DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`,
  `DEPLOYER_ADDRESS=${wallet.address}`,
  "NEXT_PUBLIC_CHAIN_ID=84532",
  "",
].join("\n");

writeFileSync(environmentPath, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${additions}`, { mode: 0o600 });
console.log(wallet.address);
