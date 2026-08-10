import "dotenv/config";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const address = process.env.CIRCLE_FACTORY_ADDRESS;
if (!address) throw new Error("Set CIRCLE_FACTORY_ADDRESS in .env first.");

const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

async function hasCodeAt(blockNumber) {
  const code = await client.getCode({ address, blockNumber });
  return Boolean(code) && code !== "0x";
}

const latest = await client.getBlockNumber();
if (!(await hasCodeAt(latest))) throw new Error("No code at this address at the latest block — check CIRCLE_FACTORY_ADDRESS.");

let lo = 0n;
let hi = latest;
while (lo < hi) {
  const mid = lo + (hi - lo) / 2n;
  // eslint-disable-next-line no-await-in-loop
  if (await hasCodeAt(mid)) hi = mid;
  else lo = mid + 1n;
}

console.log(String(lo));
