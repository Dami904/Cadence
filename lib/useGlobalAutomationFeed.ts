"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { getLogsChunked } from "./chainLogs";
import { ajoCircleEvents, cadenceContracts } from "./contracts";
import { useAllCircles } from "./useAllCircles";

export type AutomationEntry = {
  key: string;
  kind: "Payout" | "Default covered" | "Default uncovered" | "Circle completed";
  workflow: string;
  title: string;
  copy: string;
  timestamp: number;
  hash: `0x${string}`;
  circleAddress: Address;
};

// Only the event kinds a named KeeperHub workflow can actually be attributed to (see the same
// mapping in app/activity/page.tsx) — this feed exists specifically to make Cadence's core claim
// checkable at a glance: automation is real, not marketing copy, and it doesn't require a wallet
// or circle membership to see it happen, unlike /activity's per-member feed.
const WORKFLOW_BY_EVENT: Record<string, string> = {
  PayoutExecuted: "Cadence Payout Execution",
  DefaultCovered: "Cadence Default Detection + Deposit Draw",
  DefaultUncovered: "Cadence Default Detection + Deposit Draw",
  CircleCompleted: "Cadence Completion → Reputation Update",
};

const RELEVANT_EVENTS = ajoCircleEvents.filter((event) => event.type === "event" && event.name in WORKFLOW_BY_EVENT);

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

type RawLog = {
  blockNumber: bigint | null;
  transactionHash: `0x${string}`;
  logIndex: number;
  address: Address;
  eventName: keyof typeof WORKFLOW_BY_EVENT;
  args: Record<string, unknown>;
};

export function useGlobalAutomationFeed(limit = 20) {
  const publicClient = usePublicClient();
  const { isLoading: isLoadingAddresses, addresses } = useAllCircles();
  const [entries, setEntries] = useState<AutomationEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  useEffect(() => {
    if (isLoadingAddresses) return;
    if (!publicClient || addresses.length === 0) {
      setEntries([]);
      return;
    }

    let cancelled = false;
    setIsLoadingLogs(true);

    (async () => {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = cadenceContracts.factoryDeployBlock;

      const logs = await getLogsChunked<RawLog>(publicClient, {
        address: addresses,
        events: RELEVANT_EVENTS,
        fromBlock,
        toBlock: latest,
      });

      const blockNumbers = Array.from(new Set(logs.map((log) => log.blockNumber).filter((b): b is bigint => b !== null)));
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => publicClient.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const mapped: AutomationEntry[] = logs.map((log) => {
        const timestamp = log.blockNumber ? (timestampByBlock.get(log.blockNumber) ?? 0) : 0;
        const key = `${log.transactionHash}-${log.logIndex}`;
        const workflow = WORKFLOW_BY_EVENT[log.eventName];

        if (log.eventName === "PayoutExecuted") {
          return {
            key, workflow, timestamp, hash: log.transactionHash, circleAddress: log.address,
            kind: "Payout",
            title: "Payout executed",
            copy: `Round ${log.args.round} paid to ${shortAddress(log.args.recipient as string)} on ${shortAddress(log.address)}`,
          };
        }
        if (log.eventName === "DefaultCovered") {
          return {
            key, workflow, timestamp, hash: log.transactionHash, circleAddress: log.address,
            kind: "Default covered",
            title: "Missed contribution auto-covered",
            copy: `Round ${log.args.round} · ${shortAddress(log.args.member as string)}'s deposit covered it on ${shortAddress(log.address)}`,
          };
        }
        if (log.eventName === "DefaultUncovered") {
          return {
            key, workflow, timestamp, hash: log.transactionHash, circleAddress: log.address,
            kind: "Default uncovered",
            title: "Missed contribution flagged",
            copy: `Round ${log.args.round} · ${shortAddress(log.args.member as string)}'s deposit couldn't cover it on ${shortAddress(log.address)}`,
          };
        }
        // CircleCompleted is the only remaining case in WORKFLOW_BY_EVENT.
        return {
          key, workflow, timestamp, hash: log.transactionHash, circleAddress: log.address,
          kind: "Circle completed",
          title: "Circle completed",
          copy: `Final round ${log.args.finalRound} on ${shortAddress(log.address)}`,
        };
      });

      mapped.sort((a, b) => b.timestamp - a.timestamp);

      if (!cancelled) {
        setEntries(mapped.slice(0, limit));
        setIsLoadingLogs(false);
      }
    })().catch(() => {
      if (!cancelled) {
        setEntries([]);
        setIsLoadingLogs(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [publicClient, addresses, isLoadingAddresses, limit]);

  return { entries, isLoading: isLoadingAddresses || isLoadingLogs };
}
