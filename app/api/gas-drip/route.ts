import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { getSql } from "@/lib/db";

// Same bar the faucet page already uses for "you have enough gas" — if a wallet already clears
// it (its own funds, or an earlier drip that predates this table), skip sending more.
const SKIP_THRESHOLD_WEI = 300_000_000_000_000n;
const KEEPERHUB_WAIT_TIMEOUT_MS = 30_000;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

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

  // Any path below that doesn't end in "sent" or "skipped_funded" releases the reservation, so a
  // failed attempt (webhook down, KeeperHub timeout) doesn't permanently lock this wallet out of
  // ever getting a drip — the next connect just retries.
  const fail = async (error: string, status: number) => {
    await sql`DELETE FROM gas_drips WHERE wallet_address = ${address.toLowerCase()}`;
    return NextResponse.json({ error }, { status });
  };

  const balance = await publicClient.getBalance({ address }).catch(() => null);
  if (balance !== null && balance >= SKIP_THRESHOLD_WEI) {
    await sql`UPDATE gas_drips SET status = 'skipped_funded' WHERE wallet_address = ${address.toLowerCase()}`;
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
