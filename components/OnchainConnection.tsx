"use client";

import Link from "next/link";
import { ArrowRight, Radio, WalletCards } from "lucide-react";
import { zeroAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { cadenceContracts, circleFactoryAbi } from "../lib/contracts";

type Props = {
  myCircleCount?: number;
  isLoadingMyCircles?: boolean;
};

export function OnchainConnection({ myCircleCount, isLoadingMyCircles }: Props) {
  const { isConnected, chain } = useAccount();
  const configured = cadenceContracts.circleFactory !== zeroAddress;
  // Only needed for the disconnected/read-only view — once a wallet is connected,
  // the badge reports that wallet's own circles instead of the network-wide total,
  // since the two numbers look similar but mean very different things.
  const { data: networkCircleCount, isLoading: isLoadingNetworkCount } = useReadContract({
    address: cadenceContracts.circleFactory,
    abi: circleFactoryAbi,
    functionName: "circleCount",
    query: { enabled: configured && !isConnected },
  });

  if (!configured) {
    return (
      <div className="onchain-status setup">
        <Radio size={15} /><span><b>Demo data</b> · Add deployed contract addresses to enable live reads.</span>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="onchain-status live">
        <WalletCards size={15} />
        <span>
          <b>Read-only mode</b> · {isLoadingNetworkCount ? "Loading…" : `${networkCircleCount ?? 0n} circles live`} {chain?.name ? `on ${chain.name}` : "on Base Sepolia"}
        </span>
      </div>
    );
  }

  const loading = isLoadingMyCircles ?? false;
  const count = myCircleCount ?? 0;

  return (
    <Link href="/circles" className="onchain-status live onchain-status-link">
      <WalletCards size={15} />
      <span>
        <b>Wallet connected</b> · {loading ? "Loading your circles…" : `${count} circle${count === 1 ? "" : "s"} you belong to`} {chain?.name ? `on ${chain.name}` : "on Base Sepolia"}
      </span>
      <ArrowRight size={14} />
    </Link>
  );
}
