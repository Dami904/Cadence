import { neon } from "@neondatabase/serverless";
import "dotenv/config";

const sql = neon(process.env.NEON_CONNECTION_STRING);

await sql`
  CREATE TABLE IF NOT EXISTS member_emails (
    wallet_address TEXT PRIMARY KEY,
    email TEXT,
    email_reminders_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

await sql`ALTER TABLE member_emails ALTER COLUMN email DROP NOT NULL`;
await sql`ALTER TABLE member_emails ADD COLUMN IF NOT EXISTS email_reminders_enabled BOOLEAN NOT NULL DEFAULT true`;

console.log("member_emails table ready");

// Tracks every relayed (gas-sponsored) meta-transaction so /api/relay can rate-limit per wallet
// without trusting anything client-supplied — the relayer wallet pays real gas per request.
await sql`
  CREATE TABLE IF NOT EXISTS relay_requests (
    id BIGSERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS relay_requests_wallet_time_idx ON relay_requests (wallet_address, created_at)`;

console.log("relay_requests table ready");

// The circle name entered at creation has nowhere onchain to live — createCircle() takes no
// name parameter — so it's stored here, keyed by the deployed circle address, instead of being
// silently discarded the moment the create flow finishes.
await sql`
  CREATE TABLE IF NOT EXISTS circle_names (
    circle_address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_by TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

console.log("circle_names table ready");

// Tracks the one-time starter-ETH drip so a wallet is only ever considered once, no matter how
// many times /api/gas-drip gets called across future logins — see app/api/gas-drip.
await sql`
  CREATE TABLE IF NOT EXISTS gas_drips (
    wallet_address TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    tx_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

console.log("gas_drips table ready");

// Second throttle layer for /api/gas-drip, independent of the per-wallet one-shot reservation
// above: that reservation stops the same address from ever being paid twice, but does nothing
// to stop one caller from generating unlimited fresh addresses. This caps how many drips a single
// IP can trigger in a rolling window, regardless of how many distinct wallets it uses.
await sql`
  CREATE TABLE IF NOT EXISTS gas_drip_ip_requests (
    id BIGSERIAL PRIMARY KEY,
    ip_address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS gas_drip_ip_requests_ip_time_idx ON gas_drip_ip_requests (ip_address, created_at)`;

console.log("gas_drip_ip_requests table ready");
