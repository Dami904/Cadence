import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { getSql } from "@/lib/db";
import { cadenceContracts, circleFactoryAbi, forwarderAbi } from "@/lib/contracts";
import { isRelayValidationError, validateRelayRequest, validateTargetSelector } from "@/lib/relayValidation";

const RATE_LIMIT_PER_DAY = 20;
const KEEPERHUB_WAIT_TIMEOUT_MS = 30_000;

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
  const parsed = validateRelayRequest(body ?? {});
  if (isRelayValidationError(parsed)) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const { from, to, value: valueBig, gas: gasBig, deadline: deadlineBig, data, signature, selector } = parsed;

  const isFactory = to.toLowerCase() === cadenceContracts.circleFactory.toLowerCase();
  const isTrustScoreRegistry = to.toLowerCase() === cadenceContracts.trustScoreRegistry.toLowerCase();
  const isCircle =
    !isFactory && !isTrustScoreRegistry
      ? await publicClient.readContract({ address: cadenceContracts.circleFactory, abi: circleFactoryAbi, functionName: "isCircle", args: [to] })
      : false;
  const targetError = validateTargetSelector({ selector, isFactory, isTrustScoreRegistry, isCircle });
  if (targetError) {
    return NextResponse.json({ error: targetError.error }, { status: targetError.status });
  }

  const sql = getSql();
  // Being one SQL statement closes the JS-level race, but under READ COMMITTED it doesn't close
  // the DB-level one on its own: two truly concurrent requests for the same wallet can each take
  // their own snapshot of `recent` before either commits, both see a count under the limit, and
  // both insert. pg_advisory_xact_lock(hashtext(wallet)) fixes that — it's a transaction-scoped
  // lock keyed to this wallet, so a second concurrent request for the *same* wallet blocks until
  // the first one's implicit single-statement transaction finishes, and only then reads a count
  // that already reflects it. Different wallets hash to (almost certainly) different lock keys,
  // so they still run fully in parallel. The `recent` CTE is joined against `lock` specifically
  // so the planner can't evaluate the count before the lock is actually held.
  const [reservation] = (await sql`
    WITH lock AS (
      SELECT pg_advisory_xact_lock(hashtext(${from.toLowerCase()})) AS acquired
    ),
    recent AS (
      SELECT COUNT(*)::int AS count FROM relay_requests, lock
      WHERE wallet_address = ${from.toLowerCase()} AND created_at > now() - interval '24 hours'
    )
    INSERT INTO relay_requests (wallet_address, tx_hash)
    SELECT ${from.toLowerCase()}, NULL FROM recent WHERE recent.count < ${RATE_LIMIT_PER_DAY}
    RETURNING id
  `) as { id: number }[];
  if (!reservation) {
    return NextResponse.json({ error: "Sponsored-gas limit reached for this wallet today — try again later or use your own gas." }, { status: 429 });
  }
  const reservationId = reservation.id;
  // Any path below that doesn't end in a real tx hash releases the reservation, so a failed
  // attempt (bad signature, webhook down, KeeperHub timeout, etc.) never eats into the wallet's
  // daily sponsored-gas quota — matching the original behavior where only successes were logged.
  const fail = async (error: string, status: number) => {
    await sql`DELETE FROM relay_requests WHERE id = ${reservationId}`;
    return NextResponse.json({ error }, { status });
  };

  const forwardRequest = { from, to, value: valueBig, gas: gasBig, deadline: Number(deadlineBig), data, signature };

  const isValid = await publicClient.readContract({
    address: cadenceContracts.forwarder,
    abi: forwarderAbi,
    functionName: "verify",
    args: [forwardRequest],
  });
  if (!isValid) {
    return fail("Request signature is invalid or expired", 400);
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
      return await fail("Relay submission failed", 502);
    }
    ({ executionId } = (await triggerResponse.json()) as { executionId: string });
  } catch {
    return await fail("Relay submission failed", 502);
  }

  let result: KeeperHubWaitResponse;
  try {
    const waitResponse = await fetch(
      `https://app.keeperhub.com/api/workflows/executions/${executionId}/wait?timeoutMs=${KEEPERHUB_WAIT_TIMEOUT_MS}`,
      { headers: { Authorization: `Bearer ${orgApiKey}` } },
    );
    if (!waitResponse.ok) {
      return await fail("Relay execution failed", 502);
    }
    result = (await waitResponse.json()) as KeeperHubWaitResponse;
  } catch {
    return await fail("Relay execution failed", 502);
  }

  if (!result.completed || result.status !== "success" || result.transactionHashes.length === 0) {
    return await fail(result.error ?? "Relay execution failed", 502);
  }

  const hash = result.transactionHashes[0].hash;

  await sql`UPDATE relay_requests SET tx_hash = ${hash} WHERE id = ${reservationId}`;

  return NextResponse.json({ hash });
}
