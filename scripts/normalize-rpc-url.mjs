import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const environmentPath = resolve(process.cwd(), ".env");
const content = readFileSync(environmentPath, "utf8");
const updated = content.replace(/^BASE_SEPOLIA_RPC_URL=wss:\/\//m, "BASE_SEPOLIA_RPC_URL=https://");

if (updated === content) throw new Error("BASE_SEPOLIA_RPC_URL was not a wss:// endpoint; no change made.");
writeFileSync(environmentPath, updated, { mode: 0o600 });
console.log("Converted the deployment RPC endpoint from wss:// to https://.");
