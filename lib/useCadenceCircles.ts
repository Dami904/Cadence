"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient, useReadContracts } from "wagmi";
import { getLogsChunked } from "./chainLogs";
import { ajoCircleAbi, ajoCircleEvents, cadenceContracts, circleFactoryAbi } from "./contracts";

export type CircleSummary = {
  address: Address;
  targetMemberCount: bigint;
  status: number;
  isMember: boolean;
};

const circleCreatedEvent = circleFactoryAbi.find((item) => item.type === "event" && item.name === "CircleCreated")!;
const memberJoinedEvent = ajoCircleEvents.find((item) => item.name === "MemberJoined")!;

// Finds "my circles" via two bounded event-log queries instead of reading every circle
// in the factory's entire registry — this used to be an isMember() call per circle
// system-wide, which grows with total circles created by anyone, not just this wallet.
export function useCadenceCircles() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const configured = cadenceContracts.isConfigured;

  const [myCircleAddresses, setMyCircleAddresses] = useState<Address[]>([]);
  const [isLoadingDiscovery, setIsLoadingDiscovery] = useState(false);

  useEffect(() => {
    if (!configured || !publicClient || !address) {
      setMyCircleAddresses([]);
      return;
    }

    let cancelled = false;
    setIsLoadingDiscovery(true);

    (async () => {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = cadenceContracts.factoryDeployBlock;

      // One bounded, chunked query discovers every circle the factory has ever created.
      const createdLogs = await getLogsChunked<{ args: { circle: Address } }>(publicClient, {
        address: cadenceContracts.circleFactory,
        event: circleCreatedEvent,
        fromBlock,
        toBlock: latest,
      });
      const allCircleAddresses = Array.from(new Set(createdLogs.map((log) => log.args.circle)));

      if (allCircleAddresses.length === 0) {
        if (!cancelled) {
          setMyCircleAddresses([]);
          setIsLoadingDiscovery(false);
        }
        return;
      }

      // One chunked query across every circle address (viem supports an address array
      // here) filtered to this wallet's MemberJoined events narrows down to circles it has
      // ever joined. This is only a candidate list, not ground truth — a member can leave()
      // while a circle is still Forming, so live isMember() reads below confirm the rest.
      const joinedLogs = await getLogsChunked<{ address: Address }>(publicClient, {
        address: allCircleAddresses,
        event: memberJoinedEvent,
        args: { member: address },
        fromBlock,
        toBlock: latest,
      });

      const joinedAddresses = Array.from(new Set(joinedLogs.map((log) => log.address)));
      if (!cancelled) {
        setMyCircleAddresses(joinedAddresses);
        setIsLoadingDiscovery(false);
      }
    })().catch(() => {
      if (!cancelled) {
        setMyCircleAddresses([]);
        setIsLoadingDiscovery(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [configured, publicClient, address]);

  const { data: recordResults, isLoading: isLoadingRecords } = useReadContracts({
    contracts: myCircleAddresses.flatMap((circle) => [
      { address: cadenceContracts.circleFactory, abi: circleFactoryAbi, functionName: "getCircle", args: [circle] as const },
      { address: circle, abi: ajoCircleAbi, functionName: "isMember", args: [address ?? "0x0000000000000000000000000000000000000000"] as const },
    ]),
    query: { enabled: myCircleAddresses.length > 0 && Boolean(address) },
  });

  const myCircles: CircleSummary[] = useMemo(
    () =>
      myCircleAddresses
        .map((circleAddress, index) => {
          const record = recordResults?.[index * 2];
          const isMemberResult = recordResults?.[index * 2 + 1];
          const recordValue =
            record?.status === "success"
              ? (record.result as unknown as { circle: Address; targetMemberCount: bigint; status: number })
              : null;
          const stillMember = isMemberResult?.status === "success" ? Boolean(isMemberResult.result) : false;
          return {
            address: circleAddress,
            targetMemberCount: recordValue?.targetMemberCount ?? 0n,
            status: recordValue?.status ?? 0,
            isMember: stillMember,
          };
        })
        // A circle you left while it was Forming still shows up in the join-event
        // candidate list above; the live isMember() read is what actually excludes it.
        .filter((circle) => circle.isMember),
    [myCircleAddresses, recordResults],
  );

  return {
    isLoading: configured && Boolean(address) && (isLoadingDiscovery || (myCircleAddresses.length > 0 && isLoadingRecords)),
    myCircles,
  };
}
