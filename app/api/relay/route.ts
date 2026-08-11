import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, isHex, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getSql } from "@/lib/db";
import { cadenceContracts, circleFactoryAbi, forwarderAbi } from "@/lib/contracts";

const RATE_LIMIT_PER_DAY = 20;
const MAX_REQUEST_GAS = 500_000n;

// Only these calls are ever sponsored — even against a trusted target, arbitrary calldata isn't
// forwarded. Selectors are derived from the same ABIs the frontend already uses, not hardcoded,
// so this list can't silently drift from what the contracts actually expose.
const SPONSORED_SELECTORS = new Set([
  toFunctionSelector("createCircle(address,uint256,uint256,uint256,uint256,uint256)"),
  toFunctionSelector("join()"),
  toFunctionSelector("leave()"),
  toFunctionSelector("contribute()"),
  toFunctionSelector("start()"),
  toFunctionSelector("replenishDeposit()"),
  toFunctionSelector("coverDeposit(address)"),
]);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

function getRelayerAccount() {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) return null;
  return privateKeyToAccount(key as `0x${string}`);
}

export async function POST(request: NextRequest) {
  if (cadenceContracts.forwarder === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ error: "Relayer not configured" }, { status: 503 });
  }
  const account = getRelayerAccount();
  if (!account) {
    return NextResponse.json({ error: "Relayer not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const { from, to, value, gas, deadline, data, signature } = body ?? {};

  if (!isAddress(from) || !isAddress(to) || !isHex(data) || !isHex(signature)) {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  let valueBig: bigint, gasBig: bigint, deadlineBig: bigint;
  try {
    valueBig = BigInt(value);
    gasBig = BigInt(gas);
    deadlineBig = BigInt(deadline);
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  if (valueBig !== 0n) {
    return NextResponse.json({ error: "Only zero-value calls are relayed" }, { status: 400 });
  }
  if (gasBig <= 0n || gasBig > MAX_REQUEST_GAS) {
    return NextResponse.json({ error: "Requested gas out of bounds" }, { status: 400 });
  }
  const selector = data.slice(0, 10) as `0x${string}`;
  if (!SPONSORED_SELECTORS.has(selector)) {
    return NextResponse.json({ error: "This action isn't eligible for gas sponsorship" }, { status: 400 });
  }

  const isFactory = to.toLowerCase() === cadenceContracts.circleFactory.toLowerCase();
  if (!isFactory) {
    const isCircle = await publicClient.readContract({
      address: cadenceContracts.circleFactory,
      abi: circleFactoryAbi,
      functionName: "isCircle",
      args: [to],
    });
    if (!isCircle) {
      return NextResponse.json({ error: "Target isn't a Cadence contract" }, { status: 400 });
    }
  } else if (selector !== toFunctionSelector("createCircle(address,uint256,uint256,uint256,uint256,uint256)")) {
    return NextResponse.json({ error: "That action isn't valid on the factory" }, { status: 400 });
  }

  const sql = getSql();
  const [{ count }] = (await sql`
    SELECT COUNT(*)::int AS count FROM relay_requests
    WHERE wallet_address = ${from.toLowerCase()} AND created_at > now() - interval '24 hours'
  `) as { count: number }[];
  if (count >= RATE_LIMIT_PER_DAY) {
    return NextResponse.json({ error: "Sponsored-gas limit reached for this wallet today — try again later or use your own gas." }, { status: 429 });
  }

  const forwardRequest = { from, to, value: valueBig, gas: gasBig, deadline: Number(deadlineBig), data, signature };

  const isValid = await publicClient.readContract({
    address: cadenceContracts.forwarder,
    abi: forwarderAbi,
    functionName: "verify",
    args: [forwardRequest],
  });
  if (!isValid) {
    return NextResponse.json({ error: "Request signature is invalid or expired" }, { status: 400 });
  }

  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

  let hash: `0x${string}`;
  try {
    hash = await walletClient.writeContract({
      address: cadenceContracts.forwarder,
      abi: forwarderAbi,
      functionName: "execute",
      args: [forwardRequest],
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Relay submission failed" }, { status: 502 });
  }

  await sql`INSERT INTO relay_requests (wallet_address, tx_hash) VALUES (${from.toLowerCase()}, ${hash})`;

  return NextResponse.json({ hash });
}
