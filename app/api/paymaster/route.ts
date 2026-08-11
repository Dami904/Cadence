import { NextRequest, NextResponse } from "next/server";

// ERC-7677 paymaster proxy. The wallet talks to this route, never to CDP's real endpoint —
// that URL has our Client API Key baked into it and must never reach the browser. This just
// forwards the JSON-RPC body through; CDP's own configured contract/selector allowlist (set in
// the CDP Portal, not here) is what actually decides which calls get sponsored.
export async function POST(request: NextRequest) {
  const url = process.env.CDP_PAYMASTER_URL;
  if (!url) {
    return NextResponse.json({ error: { message: "Paymaster not configured" } }, { status: 503 });
  }

  const body = await request.text();
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await upstream.text();
  return new NextResponse(data, { status: upstream.status, headers: { "Content-Type": "application/json" } });
}
