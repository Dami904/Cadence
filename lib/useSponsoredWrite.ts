"use client";

import { useCallback, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import {
  useAccount,
  usePublicClient,
  useSendCalls,
  useCallsStatus,
  useSignTypedData,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { cadenceContracts, forwarderAbi, FORWARDER_EIP712_DOMAIN_NAME, FORWARDER_EIP712_DOMAIN_VERSION } from "./contracts";

const CDP_CONNECTOR_ID = "cdp-embedded-wallet";
const RELAY_GAS_LIMIT = 300_000n;

type WriteCall = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

// Every member action goes through here so it's gas-free wherever that's actually possible:
// a CDP smart account gets its calls sponsored by the Coinbase Paymaster (useSendCalls), and any
// other wallet gets its calls relayed through CadenceForwarder (sign a message, pay nothing) —
// falling back to a normal self-paid transaction only if sponsorship isn't available right now.
export function useSponsoredWrite() {
  const { address, connector, chainId } = useAccount();
  const publicClient = usePublicClient();

  const isCdpConnected = connector?.id === CDP_CONNECTOR_ID;

  const { sendCallsAsync } = useSendCalls();
  const [callsId, setCallsId] = useState<string | undefined>();
  const { data: callsStatus } = useCallsStatus({
    id: callsId ?? "",
    query: {
      enabled: Boolean(callsId),
      refetchInterval: (query) => (query.state.data?.status === "pending" ? 1000 : false),
    },
  });

  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [fallbackHash, setFallbackHash] = useState<`0x${string}` | undefined>();
  const { data: fallbackReceipt, isLoading: isConfirmingFallback, isSuccess: isSuccessFallback } = useWaitForTransactionReceipt({ hash: fallbackHash });

  const [relayHash, setRelayHash] = useState<`0x${string}` | undefined>();
  const { data: relayReceipt, isLoading: isConfirmingRelay, isSuccess: isSuccessRelay } = useWaitForTransactionReceipt({ hash: relayHash });

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = useCallback(() => {
    setCallsId(undefined);
    setFallbackHash(undefined);
    setRelayHash(undefined);
    setError(null);
    setNotice(null);
  }, []);

  const payOwnGas = useCallback(
    async (call: WriteCall) => {
      const hash = await writeContractAsync({ address: call.address, abi: call.abi, functionName: call.functionName, args: call.args });
      setFallbackHash(hash);
    },
    [writeContractAsync],
  );

  const write = useCallback(
    async (call: WriteCall) => {
      reset();
      setIsPending(true);
      try {
        if (isCdpConnected) {
          const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] });
          const { id } = await sendCallsAsync({
            calls: [{ to: call.address, data }],
            capabilities: { paymasterService: { url: `${window.location.origin}/api/paymaster` } },
          });
          setCallsId(id);
          return;
        }

        if (!address || !publicClient || chainId === undefined) throw new Error("Wallet not connected");
        if (cadenceContracts.forwarder === "0x0000000000000000000000000000000000000000") {
          await payOwnGas(call);
          return;
        }

        const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args ?? [] });
        const nonce = await publicClient.readContract({ address: cadenceContracts.forwarder, abi: forwarderAbi, functionName: "nonces", args: [address] });
        const latestBlock = await publicClient.getBlock();
        const deadline = latestBlock.timestamp + 3600n;

        const signature = await signTypedDataAsync({
          domain: { name: FORWARDER_EIP712_DOMAIN_NAME, version: FORWARDER_EIP712_DOMAIN_VERSION, chainId, verifyingContract: cadenceContracts.forwarder },
          types: {
            ForwardRequest: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "gas", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint48" },
              { name: "data", type: "bytes" },
            ],
          },
          primaryType: "ForwardRequest",
          message: { from: address, to: call.address, value: 0n, gas: RELAY_GAS_LIMIT, nonce, deadline: Number(deadline), data },
        });

        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: address,
            to: call.address,
            value: "0",
            gas: RELAY_GAS_LIMIT.toString(),
            deadline: deadline.toString(),
            data,
            signature,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setNotice((body.error as string | undefined) ?? "Sponsored gas isn't available right now — continuing with your own wallet.");
          await payOwnGas(call);
          return;
        }

        const { hash } = (await response.json()) as { hash: `0x${string}` };
        setRelayHash(hash);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Transaction failed"));
      } finally {
        setIsPending(false);
      }
    },
    [reset, isCdpConnected, address, publicClient, chainId, sendCallsAsync, signTypedDataAsync, payOwnGas],
  );

  const isConfirming = Boolean(callsId) ? callsStatus?.status === "pending" : isConfirmingRelay || isConfirmingFallback;
  const isSuccess = callsStatus?.status === "success" || isSuccessRelay || isSuccessFallback;
  const callsFailed = callsStatus?.status === "failure";

  // Deliberately loose: a sponsored batch call's receipt (EIP-5792) carries a reduced log shape
  // (address/data/topics only, no blockNumber/transactionHash) compared to a plain transaction
  // receipt's full viem Log — both are enough to decode an event's args, which is all callers need.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logs: any[] | undefined = callsStatus?.receipts?.[0]?.logs ?? relayReceipt?.logs ?? fallbackReceipt?.logs;

  return {
    write,
    reset,
    isPending,
    isConfirming,
    isSuccess,
    logs,
    error: callsFailed ? (error ?? new Error("Sponsored transaction failed")) : error,
    notice,
  };
}
