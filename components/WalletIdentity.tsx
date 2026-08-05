"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

export function WalletIdentity({ placement }: { placement: "header" | "sidebar" }) {
  const { address, chain, isConnected } = useAccount();

  if (placement === "header") {
    return <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />;
  }

  const initials = isConnected && address ? address.slice(2, 4).toUpperCase() : "—";
  return (
    <div className="profile-block" aria-live="polite">
      <div className="avatar avatar-teal small">{initials}</div>
      <div>
        <strong>{isConnected && address ? shortAddress(address) : "Wallet not connected"}</strong>
        <span>{isConnected ? chain?.name ?? "Unsupported network" : "Connect to Base Sepolia"}</span>
      </div>
    </div>
  );
}
