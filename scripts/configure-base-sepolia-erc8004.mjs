import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const identityRegistry = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const reputationRegistry = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const environmentPath = resolve(process.cwd(), ".env");
const existing = existsSync(environmentPath) ? readFileSync(environmentPath, "utf8") : "";
const additions = [];

if (!/^ERC8004_IDENTITY_REGISTRY_ADDRESS=/m.test(existing)) additions.push(`ERC8004_IDENTITY_REGISTRY_ADDRESS=${identityRegistry}`);
if (!/^ERC8004_REPUTATION_REGISTRY_ADDRESS=/m.test(existing)) additions.push(`ERC8004_REPUTATION_REGISTRY_ADDRESS=${reputationRegistry}`);

if (additions.length) appendFileSync(environmentPath, `${existing && !existing.endsWith("\n") ? "\n" : ""}${additions.join("\n")}\n`);
console.log(`${identityRegistry}\n${reputationRegistry}`);
