"use client";

import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { ajoCircleAbi } from "./contracts";
import { useCadenceCircles } from "./useCadenceCircles";

const FIELDS = ["depositAmount", "securityDepositBalance"] as const;

// Aggregates deposit coverage across every circle a wallet belongs to, so the sidebar
// can surface "at risk" in one glance instead of a member having to open each circle.
export function useDepositHealth() {
  const { address } = useAccount();
  const { myCircles, isLoading: isLoadingCircles } = useCadenceCircles();

  const { data, isLoading: isLoadingBalances } = useReadContracts({
    contracts: myCircles.flatMap((circle) => [
      { address: circle.address, abi: ajoCircleAbi, functionName: "depositAmount" },
      { address: circle.address, abi: ajoCircleAbi, functionName: "securityDepositBalance", args: [address ?? "0x0000000000000000000000000000000000000000"] },
    ]),
    query: { enabled: myCircles.length > 0 && Boolean(address) },
  });

  const { atRiskCount, totalCircles } = useMemo(() => {
    let atRisk = 0;
    myCircles.forEach((_circle, index) => {
      const base = index * FIELDS.length;
      const depositR = data?.[base];
      const balanceR = data?.[base + 1];
      const depositAmount = depositR?.status === "success" ? (depositR.result as bigint) : undefined;
      const balance = balanceR?.status === "success" ? (balanceR.result as bigint) : undefined;
      if (depositAmount !== undefined && balance !== undefined && balance < depositAmount) atRisk += 1;
    });
    return { atRiskCount: atRisk, totalCircles: myCircles.length };
  }, [myCircles, data]);

  return {
    isLoading: isLoadingCircles || (myCircles.length > 0 && isLoadingBalances),
    hasCircles: myCircles.length > 0,
    atRiskCount,
    totalCircles,
  };
}
