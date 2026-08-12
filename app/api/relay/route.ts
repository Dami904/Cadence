import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress, isHex, toFunctionSelector } from "viem";
import { baseSepolia } from "viem/chains";
import { getSql } from "@/lib/db";
import { cadenceContracts, circleFactoryAbi, forwarderAbi } from "@/lib/contracts";

const RATE_LIMIT_PER_DAY = 20;
const MAX_REQUEST_GAS = 500_000n;
const KEEPERHUB_WAIT_TIMEOUT_MS = 30_000;

const CREATE_CIRCLE_SIGNATURE = "createCircle(address,uint256,uint256,uint256,uint256,uint256,uint256)";

// Only these calls are ever sponsored — even against a trusted target, arbitrary calldata isn't
// forwarded. Selectors are derived from the same ABIs the frontend already uses, not hardcoded,
// so this list can't silently drift from what the contracts actually expose.
const SPONSORED_SELECTORS = new Set([
  toFunctionSelector(CREATE_CIRCLE_SIGNATURE),
  toFunctionSelector("join()"),
  toFunctionSelector("leave()"),
  toFunctionSelector("cancelIfExpired()"),
  toFunctionSelector("withdrawAfterCancel()"),
  toFunctionSelector("contribute()"),
  toFunctionSelector("start()"),
  toFunctionSelector("replenishDeposit()"),
  toFunctionSelector("coverDeposit(address)"),
]);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

type KeeperHubTransactionHash = { hash: `0x${string}`; nodeId: string; nodeName: string };
type KeeperHubWaitResponse = {
  status: "success" | "error" | "cancelled";
  completed: boolean;
  transactionHashes: KeeperHubTransactionHash[];
  error: string | null;
};

export async function POST(request: NextRequest) {
  if (cadenceContracts.forwarder === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ error: "Relayer not configured" }, { status: 503 });
  }
  const webhookUrl = process.env.KEEPERHUB_RELAY_WEBHOOK_URL;
  const webhookKey = process.env.KH_API_KEY;
  const orgApiKey = process.env.KH_ORG_API_KEY;
  if (!webhookUrl || !webhookKey || !orgApiKey) {
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
  } else if (selector !== toFunctionSelector(CREATE_CIRCLE_SIGNATURE)) {
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

  // The KeeperHub webhook trigger's own output wraps everything under a top-level "data" key, so a
  // payload field literally named "data" collides with it and can't be read back out — sent as
  // "calldata" instead, which the workflow's nodes reference accordingly.
  let executionId: string;
  try {
    const triggerResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${webhookKey}` },
      body: JSON.stringify({
        from,
        to,
        value: valueBig.toString(),
        gas: gasBig.toString(),
        deadline: Number(deadlineBig),
        calldata: data,
        signature,
      }),
    });
    if (!triggerResponse.ok) {
      return NextResponse.json({ error: "Relay submission failed" }, { status: 502 });
    }
    ({ executionId } = (await triggerResponse.json()) as { executionId: string });
  } catch {
    return NextResponse.json({ error: "Relay submission failed" }, { status: 502 });
  }

  let result: KeeperHubWaitResponse;
  try {
    const waitResponse = await fetch(
      `https://app.keeperhub.com/api/workflows/executions/${executionId}/wait?timeoutMs=${KEEPERHUB_WAIT_TIMEOUT_MS}`,
      { headers: { Authorization: `Bearer ${orgApiKey}` } },
    );
    if (!waitResponse.ok) {
      return NextResponse.json({ error: "Relay execution failed" }, { status: 502 });
    }
    result = (await waitResponse.json()) as KeeperHubWaitResponse;
  } catch {
    return NextResponse.json({ error: "Relay execution failed" }, { status: 502 });
  }

  if (!result.completed || result.status !== "success" || result.transactionHashes.length === 0) {
    return NextResponse.json({ error: result.error ?? "Relay execution failed" }, { status: 502 });
  }

  const hash = result.transactionHashes[0].hash;

  await sql`INSERT INTO relay_requests (wallet_address, tx_hash) VALUES (${from.toLowerCase()}, ${hash})`;

  return NextResponse.json({ hash });
}
