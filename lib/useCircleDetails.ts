"use client";

import { useMemo } from "react";
import { zeroAddress, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { ajoCircleAbi, CircleStatus } from "./contracts";

export type MemberStatus = {
  address: Address;
  contributed: boolean;
  covered: boolean;
  depositBalance: bigint;
  isYou: boolean;
};

export function useCircleDetails(circleAddress: Address | undefined) {
  const { address } = useAccount();
  const circle = circleAddress ?? zeroAddress;
  const enabled = Boolean(circleAddress);

  const { data: coreResults, isLoading: isLoadingCore, refetch: refetchCore } = useReadContracts({
    contracts: [
      { address: circle, abi: ajoCircleAbi, functionName: "status" },
      { address: circle, abi: ajoCircleAbi, functionName: "currentRound" },
      { address: circle, abi: ajoCircleAbi, functionName: "currentRoundDeadline" },
      { address: circle, abi: ajoCircleAbi, functionName: "currentRoundFunding" },
      { address: circle, abi: ajoCircleAbi, functionName: "contributionAmount" },
      { address: circle, abi: ajoCircleAbi, functionName: "depositAmount" },
      { address: circle, abi: ajoCircleAbi, functionName: "targetMemberCount" },
      { address: circle, abi: ajoCircleAbi, functionName: "getMembers" },
      { address: circle, abi: ajoCircleAbi, functionName: "asset" },
    ],
    query: { enabled },
  });

  const [statusR, roundR, deadlineR, fundingR, contribR, depositR, targetR, membersR, assetR] = coreResults ?? [];

  const status = statusR?.status === "success" ? Number(statusR.result) : undefined;
  const currentRound = roundR?.status === "success" ? (roundR.result as bigint) : undefined;
  const currentRoundDeadline = deadlineR?.status === "success" ? (deadlineR.result as bigint) : undefined;
  const currentRoundFunding = fundingR?.status === "success" ? (fundingR.result as bigint) : undefined;
  const contributionAmount = contribR?.status === "success" ? (contribR.result as bigint) : undefined;
  const depositAmount = depositR?.status === "success" ? (depositR.result as bigint) : undefined;
  const targetMemberCount = targetR?.status === "success" ? (targetR.result as bigint) : undefined;
  const members = membersR?.status === "success" ? (membersR.result as Address[]) : undefined;
  const asset = assetR?.status === "success" ? (assetR.result as Address) : undefined;

  const recipientIndex = currentRound !== undefined && currentRound > 0n ? Number(currentRound) - 1 : undefined;
  const recipient = members && recipientIndex !== undefined ? members[recipientIndex] : undefined;

  const { data: memberStatusResults, isLoading: isLoadingMemberStatus, refetch: refetchMemberStatus } = useReadContracts({
    contracts: (members ?? []).flatMap((member) =>
      currentRound !== undefined
        ? [
            { address: circle, abi: ajoCircleAbi, functionName: "contributed", args: [currentRound, member] as const },
            { address: circle, abi: ajoCircleAbi, functionName: "defaultCovered", args: [currentRound, member] as const },
            { address: circle, abi: ajoCircleAbi, functionName: "securityDepositBalance", args: [member] as const },
          ]
        : [],
    ),
    query: { enabled: Boolean(members?.length) && currentRound !== undefined },
  });

  const memberStatuses: MemberStatus[] = useMemo(() => {
    if (!members || currentRound === undefined) return [];
    return members.map((member, index) => {
      const contributedResult = memberStatusResults?.[index * 3];
      const coveredResult = memberStatusResults?.[index * 3 + 1];
      const depositResult = memberStatusResults?.[index * 3 + 2];
      return {
        address: member,
        contributed: contributedResult?.status === "success" ? Boolean(contributedResult.result) : false,
        covered: coveredResult?.status === "success" ? Boolean(coveredResult.result) : false,
        depositBalance: depositResult?.status === "success" ? (depositResult.result as bigint) : 0n,
        isYou: address ? member.toLowerCase() === address.toLowerCase() : false,
      };
    });
  }, [members, currentRound, memberStatusResults, address]);

  // A round is stalled (not just "waiting") when it's past its deadline, not fully
  // funded, and at least one unpaid member's deposit can't cover their contribution —
  // checkAndCoverDefault() will revert for them until they replenish, so nothing but
  // that member's action can move the round forward.
  const isPastDeadline = currentRoundDeadline !== undefined && Date.now() >= Number(currentRoundDeadline) * 1000;
  const pot = contributionAmount !== undefined && targetMemberCount !== undefined ? contributionAmount * targetMemberCount : undefined;
  const isFullyFunded = pot !== undefined && currentRoundFunding !== undefined && currentRoundFunding >= pot;
  const stalledOn = useMemo(() => {
    if (status !== CircleStatus.Active || !isPastDeadline || isFullyFunded || contributionAmount === undefined) return undefined;
    return memberStatuses.find(
      (member) => !member.contributed && !member.covered && member.depositBalance < contributionAmount,
    );
  }, [status, isPastDeadline, isFullyFunded, contributionAmount, memberStatuses]);

  const { data: amIMember } = useReadContract({
    address: circle,
    abi: ajoCircleAbi,
    functionName: "isMember",
    args: [address ?? zeroAddress],
    query: { enabled: enabled && Boolean(address) },
  });

  const { data: mySecurityDeposit, refetch: refetchMyDeposit } = useReadContract({
    address: circle,
    abi: ajoCircleAbi,
    functionName: "securityDepositBalance",
    args: [address ?? zeroAddress],
    query: { enabled: enabled && Boolean(address) },
  });

  const myStatus = memberStatuses.find((member) => member.isYou);

  const refetch = () => {
    refetchCore();
    refetchMemberStatus();
    refetchMyDeposit();
  };

  return {
    isLoading: isLoadingCore || isLoadingMemberStatus,
    refetch,
    status,
    currentRound,
    currentRoundDeadline,
    currentRoundFunding,
    contributionAmount,
    depositAmount,
    targetMemberCount,
    members,
    memberStatuses,
    recipient,
    asset,
    amIMember: Boolean(amIMember),
    mySecurityDeposit: mySecurityDeposit as bigint | undefined,
    hasContributedThisRound: Boolean(myStatus?.contributed),
    stalledOn,
  };
}
