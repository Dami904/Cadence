"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { ajoCircleAbi } from "./contracts";

const FIELDS = [
  "status",
  "currentRound",
  "targetMemberCount",
  "memberCount",
  "contributionAmount",
  "currentRoundDeadline",
] as const;

export type CircleCard = {
  address: Address;
  status: number;
  currentRound: bigint;
  targetMemberCount: bigint;
  memberCount: bigint;
  contributionAmount: bigint;
  currentRoundDeadline: bigint;
};

export function useCircleCards(addresses: Address[]) {
  const { data, isLoading } = useReadContracts({
    contracts: addresses.flatMap((address) =>
      FIELDS.map((functionName) => ({ address, abi: ajoCircleAbi, functionName })),
    ),
    query: { enabled: addresses.length > 0 },
  });

  const cards: CircleCard[] = useMemo(() => {
    return addresses.map((address, index) => {
      const base = index * FIELDS.length;
      const get = (offset: number) => data?.[base + offset];
      const statusR = get(0);
      const roundR = get(1);
      const targetR = get(2);
      const memberCountR = get(3);
      const contribR = get(4);
      const deadlineR = get(5);
      return {
        address,
        status: statusR?.status === "success" ? Number(statusR.result) : 0,
        currentRound: roundR?.status === "success" ? (roundR.result as bigint) : 0n,
        targetMemberCount: targetR?.status === "success" ? (targetR.result as bigint) : 0n,
        memberCount: memberCountR?.status === "success" ? (memberCountR.result as bigint) : 0n,
        contributionAmount: contribR?.status === "success" ? (contribR.result as bigint) : 0n,
        currentRoundDeadline: deadlineR?.status === "success" ? (deadlineR.result as bigint) : 0n,
      };
    });
  }, [addresses, data]);

  return { cards, isLoading };
}
