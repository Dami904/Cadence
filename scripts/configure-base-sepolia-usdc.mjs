import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const environmentPath = resolve(process.cwd(), ".env");
const existing = existsSync(environmentPath) ? readFileSync(environmentPath, "utf8") : "";
const additions = [];

if (!/^USDC_ADDRESS=/m.test(existing)) additions.push(`USDC_ADDRESS=${USDC_ADDRESS}`);
if (!/^NEXT_PUBLIC_USDC_ADDRESS=/m.test(existing)) additions.push(`NEXT_PUBLIC_USDC_ADDRESS=${USDC_ADDRESS}`);

if (additions.length) appendFileSync(environmentPath, `${existing && !existing.endsWith("\n") ? "\n" : ""}${additions.join("\n")}\n`);
console.log(USDC_ADDRESS);
