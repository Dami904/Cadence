import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSql } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
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

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  if (email && (typeof email !== "string" || !EMAIL_RE.test(email))) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (typeof emailRemindersEnabled !== "boolean") {
    return NextResponse.json({ error: "Invalid emailRemindersEnabled" }, { status: 400 });
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
