"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { getLogsChunked } from "./chainLogs";
import { ajoCircleEvents, cadenceContracts } from "./contracts";
import { useCadenceCircles } from "./useCadenceCircles";

export type ActivityEntry = {
  key: string;
  kind: "Contribution" | "Default covered" | "Default uncovered" | "Payout" | "Circle completed" | "Circle cancelled" | "Member joined" | "Member left" | "Deposit replenished" | "Deposit covered" | "Deposit returned";
  title: string;
  copy: string;
  timestamp: number;
  hash: `0x${string}`;
  isYou: boolean;
};

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

type CircleLog = {
  blockNumber: bigint | null;
  transactionHash: `0x${string}`;
  logIndex: number;
  address: Address;
  eventName:
    | "MemberJoined"
    | "MemberLeft"
    | "ContributionMade"
    | "DefaultCovered"
    | "DefaultUncovered"
    | "PayoutExecuted"
    | "CircleCompleted"
    | "CircleCancelled"
    | "DepositReplenished"
    | "DepositCovered"
    | "DepositReturned";
  args: Record<string, unknown>;
};

export function useActivityFeed() {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const { myCircles, isLoading: isLoadingCircles } = useCadenceCircles();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (isLoadingCircles) return;
    if (!publicClient || myCircles.length === 0) {
      setEntries([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingLogs(true);
    setError(null);

    (async () => {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = cadenceContracts.factoryDeployBlock;

      // One chunked, provider-safe query across every circle this wallet belongs to,
      // instead of a single unbounded 200k-block request per circle.
      const logs = await getLogsChunked<CircleLog>(publicClient, {
        address: myCircles.map((circle) => circle.address as Address),
        events: ajoCircleEvents,
        fromBlock,
        toBlock: latest,
      });
      const blockNumbers = Array.from(new Set(logs.map((log) => log.blockNumber).filter((b): b is bigint => b !== null)));
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => publicClient.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const mapped: ActivityEntry[] = logs.map((log) => {
        const timestamp = log.blockNumber ? (timestampByBlock.get(log.blockNumber) ?? 0) : 0;
        const key = `${log.transactionHash}-${log.logIndex}`;
        const hash = log.transactionHash as `0x${string}`;
        const actor = (log.args as { member?: string; recipient?: string; payer?: string }).member ?? (log.args as { recipient?: string }).recipient;
        const isYou = Boolean(address && actor && actor.toLowerCase() === address.toLowerCase());

        if (log.eventName === "ContributionMade") {
          return { key, hash, timestamp, isYou, kind: "Contribution", title: "Contribution made", copy: `Round ${log.args.round} · ${shortAddress(log.args.member as string)}` };
        }
        if (log.eventName === "DefaultCovered") {
          return { key, hash, timestamp, isYou, kind: "Default covered", title: "Deposit covered a missed contribution", copy: `Round ${log.args.round} · ${shortAddress(log.args.member as string)}` };
        }
        if (log.eventName === "DefaultUncovered") {
          return { key, hash, timestamp, isYou, kind: "Default uncovered", title: "Deposit couldn't cover a missed contribution", copy: `Round ${log.args.round} · ${shortAddress(log.args.member as string)} needs a top-up` };
        }
        if (log.eventName === "CircleCancelled") {
          // No member/recipient in this event's args — it fires once for the whole circle, not
          // per member, so there's nothing to attribute "isYou" to.
          return { key, hash, timestamp, isYou: false, kind: "Circle cancelled", title: "Circle cancelled", copy: "Never filled before its forming deadline — deposits are ready to withdraw" };
        }
        if (log.eventName === "PayoutExecuted") {
          return { key, hash, timestamp, isYou, kind: "Payout", title: "Payout executed", copy: `Round ${log.args.round} to ${shortAddress(log.args.recipient as string)}` };
        }
        if (log.eventName === "CircleCompleted") {
          return { key, hash, timestamp, isYou: false, kind: "Circle completed", title: "Circle completed", copy: `Final round ${log.args.finalRound}` };
        }
        if (log.eventName === "MemberLeft") {
          return { key, hash, timestamp, isYou, kind: "Member left", title: "Member left while forming", copy: `${shortAddress(log.args.member as string)} reclaimed their deposit and left` };
        }
        if (log.eventName === "DepositReplenished") {
          return { key, hash, timestamp, isYou, kind: "Deposit replenished", title: "Deposit topped up", copy: `${shortAddress(log.args.member as string)} restored their security deposit` };
        }
        if (log.eventName === "DepositCovered") {
          const payer = log.args.payer as string;
          const member = log.args.member as string;
          const isYouPayer = Boolean(address && payer.toLowerCase() === address.toLowerCase());
          return { key, hash, timestamp, isYou: isYouPayer, kind: "Deposit covered", title: "Member covered another's deposit", copy: `${shortAddress(payer)} covered ${shortAddress(member)}'s deposit` };
        }
        if (log.eventName === "DepositReturned") {
          return { key, hash, timestamp, isYou, kind: "Deposit returned", title: "Deposit returned", copy: `${shortAddress(log.args.member as string)}'s deposit was withdrawn` };
        }
        // MemberJoined is the only remaining case, but every branch above is exhaustive over
        // CircleLog["eventName"] — fall back to a safe, generic entry instead of assuming
        // log.args.member exists if a future event type ever reaches here unhandled.
        const member = log.args.member as string | undefined;
        return {
          key, hash, timestamp, isYou,
          kind: "Member joined",
          title: log.eventName === "MemberJoined" ? "Member joined" : log.eventName,
          copy: member ? `${shortAddress(member)} joined the circle` : "See transaction for details",
        };
      });

      mapped.sort((a, b) => b.timestamp - a.timestamp);

      if (!cancelled) {
        setEntries(mapped.slice(0, 30));
        setIsLoadingLogs(false);
      }
    })().catch((err) => {
      if (!cancelled) {
        setIsLoadingLogs(false);
        setError(err instanceof Error ? err : new Error("Failed to load activity"));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [publicClient, myCircles, isLoadingCircles]);

  return { entries, isLoading: isLoadingCircles || isLoadingLogs, error };
}
