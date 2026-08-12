"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

type DripStatus = "idle" | "checking" | "sent" | "quiet";

// Fires once per connected address, ever — the server enforces the "ever" part via a Postgres
// reservation (see app/api/gas-drip), so this can safely re-run on every connect without
// re-sending anything after the first successful (or not-needed) attempt. The `attempted` ref
// only guards against firing twice for the same address within one page session. No wallet
// signature is involved, so this never interrupts the user with a prompt.
export function useGasDripOnboarding() {
  const { address } = useAccount();
  const [status, setStatus] = useState<DripStatus>("idle");
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!address || attempted.current === address) return;
    attempted.current = address;
    setStatus("checking");

    fetch("/api/gas-drip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => setStatus(ok && data.status === "sent" ? "sent" : "quiet"))
      .catch(() => setStatus("quiet"));
  }, [address]);

  return status;
}
