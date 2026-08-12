"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { getLogsChunked } from "./chainLogs";
import { cadenceContracts, circleFactoryAbi } from "./contracts";

const circleCreatedEvent = circleFactoryAbi.find((item) => item.type === "event" && item.name === "CircleCreated")!;

// Every circle the factory has ever created, not just ones this wallet belongs to — and
// deliberately doesn't require a connected wallet at all, unlike useCadenceCircles. Backs the
// public /browse page so a visitor (or a hackathon judge) can see the product working live
// without connecting anything first.
export function useAllCircles() {
  const publicClient = usePublicClient();
  const configured = cadenceContracts.isConfigured;

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!configured || !publicClient) {
      setAddresses([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = cadenceContracts.factoryDeployBlock;

      const createdLogs = await getLogsChunked<{ args: { circle: Address } }>(publicClient, {
        address: cadenceContracts.circleFactory,
        event: circleCreatedEvent,
        fromBlock,
        toBlock: latest,
      });

      // Newest first, so the most recently created circles — the ones most likely to still be
      // forming and worth looking at — surface at the top instead of the oldest ones.
      const unique = Array.from(new Set(createdLogs.map((log) => log.args.circle))).reverse();
      if (!cancelled) {
        setAddresses(unique);
        setIsLoading(false);
      }
    })().catch(() => {
      if (!cancelled) {
        setAddresses([]);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [configured, publicClient]);

  return { isLoading, addresses };
}
