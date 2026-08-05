"use client";

import { useMemo } from "react";
import { zeroAddress, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { ajoCircleAbi, cadenceContracts, circleFactoryAbi } from "./contracts";

export type CircleSummary = {
  address: Address;
  targetMemberCount: bigint;
  status: number;
  isMember: boolean;
};

export function useCadenceCircles() {
  const { address } = useAccount();
  const configured = cadenceContracts.isConfigured;

  const { data: circleCount, isLoading: isLoadingCount } = useReadContract({
    address: cadenceContracts.circleFactory,
    abi: circleFactoryAbi,
    functionName: "circleCount",
    query: { enabled: configured },
  });

  const count = Number(circleCount ?? 0n);
  const indices = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);

  const { data: addressResults, isLoading: isLoadingAddresses } = useReadContracts({
    contracts: indices.map((index) => ({
      address: cadenceContracts.circleFactory,
      abi: circleFactoryAbi,
      functionName: "circleAt",
      args: [BigInt(index)] as const,
    })),
    query: { enabled: configured && count > 0 },
  });

  const circleAddresses = useMemo(
    () =>
      (addressResults ?? [])
        .map((result) => (result.status === "success" ? (result.result as unknown as Address) : null))
        .filter((value): value is Address => Boolean(value)),
    [addressResults],
  );

  const { data: recordResults, isLoading: isLoadingRecords } = useReadContracts({
    contracts: circleAddresses.map((circle) => ({
      address: cadenceContracts.circleFactory,
      abi: circleFactoryAbi,
      functionName: "getCircle",
      args: [circle] as const,
    })),
    query: { enabled: circleAddresses.length > 0 },
  });

  const { data: membershipResults, isLoading: isLoadingMembership } = useReadContracts({
    contracts: circleAddresses.map((circle) => ({
      address: circle,
      abi: ajoCircleAbi,
      functionName: "isMember",
      args: [address ?? zeroAddress] as const,
    })),
    query: { enabled: circleAddresses.length > 0 && Boolean(address) },
  });

  const circles: CircleSummary[] = useMemo(
    () =>
      circleAddresses.map((circleAddress, index) => {
        const record = recordResults?.[index];
        const membership = membershipResults?.[index];
        const recordValue =
          record?.status === "success"
            ? (record.result as unknown as { circle: Address; targetMemberCount: bigint; status: number })
            : null;
        return {
          address: circleAddress,
          targetMemberCount: recordValue?.targetMemberCount ?? 0n,
          status: recordValue?.status ?? 0,
          isMember: membership?.status === "success" ? Boolean(membership.result) : false,
        };
      }),
    [circleAddresses, recordResults, membershipResults],
  );

  const myCircles = useMemo(() => circles.filter((circle) => circle.isMember), [circles]);

  return {
    isLoading: configured && (isLoadingCount || isLoadingAddresses || isLoadingRecords || (Boolean(address) && isLoadingMembership)),
    myCircles,
  };
}
