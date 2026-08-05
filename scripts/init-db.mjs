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
