"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { getLogsChunked } from "./chainLogs";
import { ajoCircleEvents, cadenceContracts, circleFactoryAbi } from "./contracts";
import { useCadenceCircles } from "./useCadenceCircles";

export type ActivityEntry = {
  key: string;
  kind: "Circle created" | "Contribution" | "Default covered" | "Default uncovered" | "Payout" | "Circle completed" | "Circle cancelled" | "Member joined" | "Member left" | "Deposit replenished" | "Deposit covered" | "Deposit returned";
  title: string;
  copy: string;
  timestamp: number;
  hash: `0x${string}`;
  isYou: boolean;
  circleAddress: Address;
  // Current membership, not membership-at-the-time-of-this-event — this decides where clicking
  // the entry should go: into the circle if you're still in it, or to the join page if not.
  isMember: boolean;
};

const circleCreatedEvent = circleFactoryAbi.find((item) => item.type === "event" && item.name === "CircleCreated")!;

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
  // Uses every circle ever joined, not just current memberships — otherwise leaving a circle
  // (isMember flips false) would make its entire history vanish from this feed, even though
  // the join/contribute/leave/withdraw events are still yours.
  const { allCircles: myCircles, isLoading: isLoadingCircles } = useCadenceCircles();
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
      const circleAddresses = myCircles.map((circle) => circle.address as Address);
      const memberNow = new Map(myCircles.map((circle) => [circle.address.toLowerCase(), circle.isMember]));

      // One chunked, provider-safe query across every circle this wallet belongs to, instead of a
      // single unbounded 200k-block request per circle. CircleCreated is queried separately since
      // it's emitted by the factory, not by the circles themselves.
      const [logs, createdLogs] = await Promise.all([
        getLogsChunked<CircleLog>(publicClient, { address: circleAddresses, events: ajoCircleEvents, fromBlock, toBlock: latest }),
        getLogsChunked<{ blockNumber: bigint | null; transactionHash: `0x${string}`; logIndex: number; args: { circle: Address; creator: Address } }>(
          publicClient,
          { address: cadenceContracts.circleFactory, event: circleCreatedEvent, args: { circle: circleAddresses }, fromBlock, toBlock: latest },
        ),
      ]);
      const blockNumbers = Array.from(
        new Set([...logs, ...createdLogs].map((log) => log.blockNumber).filter((b): b is bigint => b !== null)),
      );
      const blocks = await Promise.all(blockNumbers.map((blockNumber) => publicClient.getBlock({ blockNumber })));
      const timestampByBlock = new Map(blocks.map((block) => [block.number, Number(block.timestamp)]));

      const mapped: ActivityEntry[] = logs.map((log) => {
        const timestamp = log.blockNumber ? (timestampByBlock.get(log.blockNumber) ?? 0) : 0;
        const key = `${log.transactionHash}-${log.logIndex}`;
        const hash = log.transactionHash as `0x${string}`;
        const circleAddress = log.address;
        const isMember = memberNow.get(circleAddress.toLowerCase()) ?? false;
        const actor = (log.args as { member?: string; recipient?: string; payer?: string }).member ?? (log.args as { recipient?: string }).recipient;
        const isYou = Boolean(address && actor && actor.toLowerCase() === address.toLowerCase());

        if (log.eventName === "ContributionMade") {
          return { key, hash, timestamp, isYou, circleAddress, isMember, kind: "Contribution", title: "Contribution made", copy: `Round ${log.args.round} · ${shortAddress(log.args.member as string)}` };
        }
        if (log.eventName === "DefaultCovered") {
          return { key, hash, timestamp, isYou, circleAddress, isMember, kind: "Default covered", title: "Deposit covered a missed contribution", copy: `Round ${log.args.round} · ${shortAddress(log.args.member as string)}` };
        }
        if (log.eventName === "DefaultUncovered") {
          return { key, hash, timestamp, isYou, circleAddress, isMember, kind: "Default uncovered", title: "Deposit couldn't cover a missed contribution", copy: `Round ${log.args.round} · ${shortAddress(log.args.member as string)} needs a top-up` };
        }
        if (log.eventName === "CircleCancelled") {
          // No member/recipient in this event's args — it fires once for the whole circle, not
          // per member, so there's nothing to attribute "isYou" to.
          return { key, hash, timestamp, isYou: false, circleAddress, isMember, kind: "Circle cancelled", title: "Circle cancelled", copy: "Never filled before its forming deadline — deposits are ready to withdraw" };
        }
        if (log.eventName === "PayoutExecuted") {
          return { key, hash, timestamp, isYou, circleAddress, isMember, kind: "Payout", title: "Payout executed", copy: `Round ${log.args.round} to ${shortAddress(log.args.recipient as string)}` };
        }
        if (log.eventName === "CircleCompleted") {
          return { key, hash, timestamp, isYou: false, circleAddress, isMember, kind: "Circle completed", title: "Circle completed", copy: `Final round ${log.args.finalRound}` };
        }
        if (log.eventName === "MemberLeft") {
          return { key, hash, timestamp, isYou, circleAddress, isMember, kind: "Member left", title: "Member left while forming", copy: `${shortAddress(log.args.member as string)} reclaimed their deposit and left` };
        }
        if (log.eventName === "DepositReplenished") {
          return { key, hash, timestamp, isYou, circleAddress, isMember, kind: "Deposit replenished", title: "Deposit topped up", copy: `${shortAddress(log.args.member as string)} restored their security deposit` };
        }
        if (log.eventName === "DepositCovered") {
          const payer = log.args.payer as string;
          const member = log.args.member as string;
          const isYouPayer = Boolean(address && payer.toLowerCase() === address.toLowerCase());
          return { key, hash, timestamp, isYou: isYouPayer, circleAddress, isMember, kind: "Deposit covered", title: "Member covered another's deposit", copy: `${shortAddress(payer)} covered ${shortAddress(member)}'s deposit` };
        }
        if (log.eventName === "DepositReturned") {
          return { key, hash, timestamp, isYou, circleAddress, isMember, kind: "Deposit returned", title: "Deposit returned", copy: `${shortAddress(log.args.member as string)}'s deposit was withdrawn` };
        }
        // MemberJoined is the only remaining case, but every branch above is exhaustive over
        // CircleLog["eventName"] — fall back to a safe, generic entry instead of assuming
        // log.args.member exists if a future event type ever reaches here unhandled.
        const member = log.args.member as string | undefined;
        return {
          key, hash, timestamp, isYou, circleAddress, isMember,
          kind: "Member joined",
          title: log.eventName === "MemberJoined" ? "Member joined" : log.eventName,
          copy: member ? `${shortAddress(member)} joined the circle` : "See transaction for details",
        };
      });

      const createdEntries: ActivityEntry[] = createdLogs.map((log) => {
        const timestamp = log.blockNumber ? (timestampByBlock.get(log.blockNumber) ?? 0) : 0;
        const key = `${log.transactionHash}-${log.logIndex}`;
        const circleAddress = log.args.circle;
        const isMember = memberNow.get(circleAddress.toLowerCase()) ?? false;
        const isYou = Boolean(address && log.args.creator.toLowerCase() === address.toLowerCase());
        return {
          key, hash: log.transactionHash, timestamp, isYou, circleAddress, isMember,
          kind: "Circle created",
          title: "Circle created",
          copy: isYou ? "You started this circle" : `Started by ${shortAddress(log.args.creator)}`,
        };
      });

      const combined = [...mapped, ...createdEntries];
      combined.sort((a, b) => b.timestamp - a.timestamp);

      if (!cancelled) {
        setEntries(combined.slice(0, 30));
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
