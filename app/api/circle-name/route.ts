import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress, verifyMessage, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { getSql } from "@/lib/db";
import { ajoCircleAbi, cadenceContracts, circleFactoryAbi } from "@/lib/contracts";

const NAME_MAX_LENGTH = 60;
// Signatures only prove wallet control for a short window, so a captured signature can't be
// replayed later to rename a circle the signer no longer has any say over.
const SIGNATURE_FRESHNESS_MS = 5 * 60 * 1000;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

function writeMessage(circleAddress: Address, name: string, timestamp: number) {
  return `Cadence circle name update\ncircle: ${circleAddress}\nname: ${name}\ntimestamp: ${timestamp}`;
}

export async function GET(request: NextRequest) {
  const single = request.nextUrl.searchParams.get("address");
  const batch = request.nextUrl.searchParams.get("addresses");
  const addresses = (batch ? batch.split(",") : single ? [single] : []).filter((a) => isAddress(a));
  if (addresses.length === 0) {
    return NextResponse.json({ error: "No valid address supplied" }, { status: 400 });
  }

  const sql = getSql();
  const rows = (await sql`
    SELECT circle_address, name FROM circle_names WHERE circle_address = ANY(${addresses.map((a) => a.toLowerCase())})
  `) as { circle_address: string; name: string }[];

  const names = Object.fromEntries(rows.map((row) => [row.circle_address, row.name]));
  if (single) {
    return NextResponse.json({ name: names[single.toLowerCase()] ?? null });
  }
  return NextResponse.json({ names });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const circleAddress = body?.circleAddress;
  const address = body?.address;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const signature = body?.signature;
  const timestamp = body?.timestamp;

  if (!isAddress(circleAddress) || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  if (!name || name.length > NAME_MAX_LENGTH) {
    return NextResponse.json({ error: `Name must be 1-${NAME_MAX_LENGTH} characters` }, { status: 400 });
  }
  if (typeof signature !== "string" || !signature.startsWith("0x") || typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_FRESHNESS_MS) {
    return NextResponse.json({ error: "Sign a fresh request to name this circle." }, { status: 401 });
  }

  const isValidSignature = await verifyMessage({
    address,
    message: writeMessage(circleAddress, name, timestamp),
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!isValidSignature) {
    return NextResponse.json({ error: "Sign a fresh request to name this circle." }, { status: 401 });
  }

  // Only a real Cadence circle, and only its creator or a current member, can set its name —
  // otherwise anyone could label an arbitrary address, or a former member could keep renaming a
  // circle they already left. The creator check matters because right after deployment they
  // haven't called join() yet, so isMember() alone would reject naming at creation time.
  const isCircle = await publicClient.readContract({
    address: cadenceContracts.circleFactory,
    abi: circleFactoryAbi,
    functionName: "isCircle",
    args: [circleAddress],
  });
  if (!isCircle) {
    return NextResponse.json({ error: "Not a Cadence circle" }, { status: 400 });
  }
  const [creator, isMember] = await Promise.all([
    publicClient.readContract({ address: circleAddress, abi: ajoCircleAbi, functionName: "creator", args: [] }),
    publicClient.readContract({ address: circleAddress, abi: ajoCircleAbi, functionName: "isMember", args: [address] }),
  ]);
  if (!isMember && creator.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json({ error: "Only this circle's creator or a member can name it" }, { status: 403 });
  }

  const sql = getSql();
  await sql`
    INSERT INTO circle_names (circle_address, name, set_by, updated_at)
    VALUES (${circleAddress.toLowerCase()}, ${name}, ${address.toLowerCase()}, now())
    ON CONFLICT (circle_address) DO UPDATE SET
      name = excluded.name,
      set_by = excluded.set_by,
      updated_at = now()
  `;
  return NextResponse.json({ ok: true });
}
