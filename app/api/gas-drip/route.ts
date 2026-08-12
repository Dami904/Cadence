import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { getSql } from "@/lib/db";

// Same bar the faucet page already uses for "you have enough gas" — if a wallet already clears
// it (its own funds, or an earlier drip that predates this table), skip sending more.
const SKIP_THRESHOLD_WEI = 300_000_000_000_000n;
const KEEPERHUB_WAIT_TIMEOUT_MS = 30_000;
// The per-wallet reservation below stops the same address from ever being paid twice, but not a
// caller who just generates a fresh address each time — this bounds how many drips one IP can
// trigger per hour, independent of how many distinct wallets it uses.
const IP_RATE_LIMIT_PER_HOUR = 5;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

function clientIp(request: NextRequest): string {
  // Vercel (and most proxies) set x-forwarded-for as "client, proxy1, proxy2" — the first entry
  // is the original caller. Falls back to x-real-ip, then a constant bucket so local/dev requests
  // still share one rate limit instead of bypassing it entirely with an empty key.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.KEEPERHUB_GAS_DRIP_WEBHOOK_URL;
  const webhookKey = process.env.KH_API_KEY;
  const orgApiKey = process.env.KH_ORG_API_KEY;
  if (!webhookUrl || !webhookKey || !orgApiKey) {
    return NextResponse.json({ error: "Gas drip not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const address = body?.address;

  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  // No signature required here, unlike /api/relay and /api/circle-name — this only ever moves a
  // tiny, fixed, one-shot amount of worthless testnet ETH (capped by the reservation below and
  // by the KeeperHub workflow's own hardcoded amount), and a signature wouldn't actually stop
  // abuse anyway: anyone can sign for a throwaway address they just generated. Skipping it avoids
  // popping an unrequested wallet prompt the instant a brand-new wallet lands on the app.

  const sql = getSql();
  // Reserves this wallet before doing anything else — a wallet that already has a row here
  // (sent, skipped, or a concurrent in-flight attempt) is never considered again.
  const [reservation] = (await sql`
    INSERT INTO gas_drips (wallet_address, status) VALUES (${address.toLowerCase()}, 'pending')
    ON CONFLICT (wallet_address) DO NOTHING
    RETURNING wallet_address
  `) as { wallet_address: string }[];
  if (!reservation) {
    return NextResponse.json({ ok: true, status: "already-handled" });
  }

  // Second reservation, this time by IP rather than wallet: the check above only ever fires once
  // per address, so on its own it does nothing to stop a script generating unlimited fresh
  // addresses. Same atomic count-then-insert shape as /api/relay's per-wallet limit, just keyed
  // differently. Only runs once we know this is a genuinely new wallet — an already-handled wallet
  // never reaches here, so repeat calls for it don't burn IP budget for nothing.
  const ip = clientIp(request);
  const [ipReservation] = (await sql`
    WITH recent AS (
      SELECT COUNT(*)::int AS count FROM gas_drip_ip_requests
      WHERE ip_address = ${ip} AND created_at > now() - interval '1 hour'
    )
    INSERT INTO gas_drip_ip_requests (ip_address)
    SELECT ${ip} FROM recent WHERE recent.count < ${IP_RATE_LIMIT_PER_HOUR}
    RETURNING id
  `) as { id: number }[];
  if (!ipReservation) {
    await sql`DELETE FROM gas_drips WHERE wallet_address = ${address.toLowerCase()}`;
    return NextResponse.json({ error: "Too many new wallets from this network — try again later." }, { status: 429 });
  }
  const ipReservationId = ipReservation.id;

  // Any path below that doesn't end in "sent" releases both reservations, so a failed attempt
  // (webhook down, KeeperHub timeout) doesn't permanently lock this wallet out of ever getting a
  // drip, and doesn't burn this IP's hourly budget on something that never actually sent funds.
  const fail = async (error: string, status: number) => {
    await sql`DELETE FROM gas_drips WHERE wallet_address = ${address.toLowerCase()}`;
    await sql`DELETE FROM gas_drip_ip_requests WHERE id = ${ipReservationId}`;
    return NextResponse.json({ error }, { status });
  };

  const balance = await publicClient.getBalance({ address }).catch(() => null);
  if (balance !== null && balance >= SKIP_THRESHOLD_WEI) {
    await sql`UPDATE gas_drips SET status = 'skipped_funded' WHERE wallet_address = ${address.toLowerCase()}`;
    // No funds actually moved, so this shouldn't count against the IP's send budget either.
    await sql`DELETE FROM gas_drip_ip_requests WHERE id = ${ipReservationId}`;
    return NextResponse.json({ ok: true, status: "skipped_funded" });
  }

  let executionId: string;
  try {
    const triggerResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${webhookKey}` },
      body: JSON.stringify({ to: address }),
    });
    if (!triggerResponse.ok) return await fail("Gas drip submission failed", 502);
    ({ executionId } = (await triggerResponse.json()) as { executionId: string });
  } catch {
    return await fail("Gas drip submission failed", 502);
  }

  let result: { status: string; completed: boolean; transactionHashes: { hash: `0x${string}` }[]; error: string | null };
  try {
    const waitResponse = await fetch(
      `https://app.keeperhub.com/api/workflows/executions/${executionId}/wait?timeoutMs=${KEEPERHUB_WAIT_TIMEOUT_MS}`,
      { headers: { Authorization: `Bearer ${orgApiKey}` } },
    );
    if (!waitResponse.ok) return await fail("Gas drip execution failed", 502);
    result = await waitResponse.json();
  } catch {
    return await fail("Gas drip execution failed", 502);
  }

  if (!result.completed || result.status !== "success" || result.transactionHashes.length === 0) {
    return await fail(result.error ?? "Gas drip execution failed", 502);
  }

  const hash = result.transactionHashes[0].hash;
  await sql`UPDATE gas_drips SET status = 'sent', tx_hash = ${hash} WHERE wallet_address = ${address.toLowerCase()}`;
  return NextResponse.json({ ok: true, status: "sent", hash });
}
