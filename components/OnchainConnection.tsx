"use client";

import { ExternalLink, Radio, WalletCards } from "lucide-react";
import { zeroAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { cadenceContracts, circleFactoryAbi } from "../lib/contracts";

export function OnchainConnection() {
  const { address, isConnected, chain } = useAccount();
  const configured = cadenceContracts.circleFactory !== zeroAddress;
  const { data: circleCount, isLoading } = useReadContract({ address: cadenceContracts.circleFactory, abi: circleFactoryAbi, functionName: "circleCount", query: { enabled: configured } });
  if (!configured) return <div className="onchain-status setup"><Radio size={15} /><span><b>Demo data</b> · Add deployed contract addresses to enable live reads.</span></div>;
  return <div className="onchain-status live"><WalletCards size={15} /><span><b>{isConnected ? "Wallet connected" : "Read-only mode"}</b> · {isLoading ? "Loading circles…" : `${circleCount ?? 0n} circles discovered`} {chain?.name ? `on ${chain.name}` : "on Base Sepolia"}</span>{address && <ExternalLink size={14} />}</div>;
}
