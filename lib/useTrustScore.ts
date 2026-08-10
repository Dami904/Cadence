"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { getLogsChunked } from "./chainLogs";
import { cadenceContracts, trustScoreRegistryAbi, TRUST_SCORE_TAGS } from "./contracts";

export type TrustOutcome = {
  key: string;
  hash: `0x${string}`;
  timestamp: number;
  tag: string;
  value: bigint;
};

type OutcomeLog = {
  blockNumber: bigint | null;
  transactionHash: `0x${string}`;
  logIndex: number;
  args: { tag: string; value: bigint };
};

const outcomeRecordedEvent = trustScoreRegistryAbi.find((item) => item.type === "event" && item.name === "OutcomeRecorded")!;

// Pass an address to preview any wallet's Trust Score (e.g. a circle creator on the
// join page); omit it to read the connected wallet's own score.
export function useTrustScore(targetAddress?: Address) {
  const { address: connectedAddress } = useAccount();
  const address = targetAddress ?? connectedAddress;
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
      const fromBlock = cadenceContracts.factoryDeployBlock;

      const logs = await getLogsChunked<OutcomeLog>(publicClient, {
        address: cadenceContracts.trustScoreRegistry,
        event: outcomeRecordedEvent,
        args: { member: address },
        fromBlock,
        toBlock: latest,
      });

      const blockNumbers = Array.from(new Set(logs.map((log) => log.blockNumber).filter((b): b is bigint => b !== null)));
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => publicClient.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const mapped: TrustOutcome[] = logs.map((log) => ({
        key: `${log.transactionHash}-${log.logIndex}`,
        hash: log.transactionHash,
        timestamp: log.blockNumber ? (timestampByBlock.get(log.blockNumber) ?? 0) : 0,
        tag: log.args.tag,
        value: log.args.value,
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
  // No recorded outcomes yet reads as a neutral 100, not a penalty for having no history.
  const score = useMemo(() => {
    const total = completions + defaults;
    return total === 0 ? 100 : Math.round((completions / total) * 100);
  }, [completions, defaults]);
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
