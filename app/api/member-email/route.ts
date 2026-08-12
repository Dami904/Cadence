import { NextRequest, NextResponse } from "next/server";
import { isAddress, verifyMessage, type Address } from "viem";
import { getSql } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Signatures only prove wallet control for a short window, so a captured signature can't be
// replayed indefinitely to keep re-reading or re-writing someone else's reminder settings.
const SIGNATURE_FRESHNESS_MS = 5 * 60 * 1000;

function readMessage(address: Address, timestamp: number) {
  return `Cadence settings read\naddress: ${address}\ntimestamp: ${timestamp}`;
}

function writeMessage(address: Address, email: string, emailRemindersEnabled: boolean, timestamp: number) {
  return `Cadence settings update\naddress: ${address}\nemail: ${email || "(none)"}\nemailRemindersEnabled: ${emailRemindersEnabled}\ntimestamp: ${timestamp}`;
}

async function verifyFresh(address: Address, message: string, signature: unknown, timestamp: unknown) {
  if (typeof signature !== "string" || !signature.startsWith("0x")) return false;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_FRESHNESS_MS) return false;
  return verifyMessage({ address, message, signature: signature as `0x${string}` });
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const signature = request.nextUrl.searchParams.get("signature");
  const timestampRaw = request.nextUrl.searchParams.get("timestamp");
  const timestamp = timestampRaw ? Number(timestampRaw) : NaN;

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  // Proves the caller controls this wallet before returning anything tied to it — without this,
  // any visitor could read another member's stored email off their address alone.
  const isValid = await verifyFresh(address, readMessage(address, timestamp), signature, timestamp).catch(() => false);
  if (!isValid) {
    return NextResponse.json({ error: "Sign a fresh request to view these settings." }, { status: 401 });
  }

  const sql = getSql();
  const rows = (await sql`
    SELECT email, email_reminders_enabled FROM member_emails WHERE wallet_address = ${address.toLowerCase()}
  `) as { email: string | null; email_reminders_enabled: boolean }[];
  return NextResponse.json({
    email: rows[0]?.email ?? null,
    emailRemindersEnabled: rows[0]?.email_reminders_enabled ?? true,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = body?.address;
  const email = body?.email;
  const emailRemindersEnabled = body?.emailRemindersEnabled;
  const signature = body?.signature;
  const timestamp = body?.timestamp;

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  if (email && (typeof email !== "string" || !EMAIL_RE.test(email))) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (typeof emailRemindersEnabled !== "boolean") {
    return NextResponse.json({ error: "Invalid emailRemindersEnabled" }, { status: 400 });
  }
  // The signed message binds the exact values being written, not just the address, so a captured
  // signature can only ever replay the same settings the owner actually approved — it can't be
  // reused to write something different.
  const isValid = await verifyFresh(
    address,
    writeMessage(address, typeof email === "string" ? email : "", emailRemindersEnabled, timestamp),
    signature,
    timestamp,
  ).catch(() => false);
  if (!isValid) {
    return NextResponse.json({ error: "Sign a fresh request to update these settings." }, { status: 401 });
  }

  const sql = getSql();
  await sql`
    INSERT INTO member_emails (wallet_address, email, email_reminders_enabled, updated_at)
    VALUES (${address.toLowerCase()}, ${email || null}, ${emailRemindersEnabled}, now())
    ON CONFLICT (wallet_address) DO UPDATE SET
      email = excluded.email,
      email_reminders_enabled = excluded.email_reminders_enabled,
      updated_at = now()
  `;
  return NextResponse.json({ ok: true });
}
