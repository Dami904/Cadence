"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { cadenceContracts, trustScoreRegistryAbi, TRUST_SCORE_TAGS } from "./contracts";

const LOOKBACK_BLOCKS = 200_000n;

export type TrustOutcome = {
  key: string;
  hash: `0x${string}`;
  timestamp: number;
  tag: string;
  value: bigint;
};

export function useTrustScore() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const configured = cadenceContracts.trustScoreRegistry !== zeroAddress;
  const enabled = configured && Boolean(address);

  const { data: hasLinkedIdentity, isLoading: isLoadingLinked, refetch: refetchLinkedQuery } = useReadContract({
    address: cadenceContracts.trustScoreRegistry,
    abi: trustScoreRegistryAbi,
    functionName: "hasLinkedIdentity",
    args: address ? [address] : undefined,
    query: { enabled },
  });

  const { data: agentId, isLoading: isLoadingAgentId, refetch: refetchAgentIdQuery } = useReadContract({
    address: cadenceContracts.trustScoreRegistry,
    abi: trustScoreRegistryAbi,
    functionName: "memberAgentId",
    args: address ? [address] : undefined,
    query: { enabled: enabled && Boolean(hasLinkedIdentity) },
  });

  const [outcomes, setOutcomes] = useState<TrustOutcome[]>([]);
  const [isLoadingOutcomes, setIsLoadingOutcomes] = useState(false);

  useEffect(() => {
    if (!enabled || !publicClient || !address || !hasLinkedIdentity) {
      setOutcomes([]);
      return;
    }

    let cancelled = false;
    setIsLoadingOutcomes(true);

    (async () => {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n;

      const logs = await publicClient.getLogs({
        address: cadenceContracts.trustScoreRegistry,
        event: trustScoreRegistryAbi.find((item) => item.type === "event" && item.name === "OutcomeRecorded")!,
        args: { member: address },
        fromBlock,
        toBlock: latest,
      });

      const blockNumbers = Array.from(new Set(logs.map((log) => log.blockNumber).filter((b): b is bigint => b !== null)));
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => publicClient.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const mapped: TrustOutcome[] = logs.map((log) => ({
        key: `${log.transactionHash}-${log.logIndex}`,
        hash: log.transactionHash as `0x${string}`,
        timestamp: log.blockNumber ? (timestampByBlock.get(log.blockNumber) ?? 0) : 0,
        tag: log.args.tag as string,
        value: log.args.value as bigint,
      }));

      mapped.sort((a, b) => b.timestamp - a.timestamp);

      if (!cancelled) {
        setOutcomes(mapped);
        setIsLoadingOutcomes(false);
      }
    })().catch(() => {
      if (!cancelled) setIsLoadingOutcomes(false);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, publicClient, address, hasLinkedIdentity]);

  const completions = useMemo(() => outcomes.filter((o) => o.tag === TRUST_SCORE_TAGS.completion).length, [outcomes]);
  const defaults = useMemo(() => outcomes.filter((o) => o.tag === TRUST_SCORE_TAGS.default).length, [outcomes]);
  const score = useMemo(() => Math.max(0, Math.min(100, 100 - defaults * 20)), [defaults]);
  const mostRecent = outcomes[0];

  const refetchLinked = useCallback(() => {
    refetchLinkedQuery();
    refetchAgentIdQuery();
  }, [refetchLinkedQuery, refetchAgentIdQuery]);

  return {
    configured,
    isConnected: Boolean(address),
    isLoading: isLoadingLinked || isLoadingAgentId || isLoadingOutcomes,
    hasLinkedIdentity: Boolean(hasLinkedIdentity),
    agentId: agentId as bigint | undefined,
    completions,
    defaults,
    score,
    mostRecent,
    refetchLinked,
  };
}
