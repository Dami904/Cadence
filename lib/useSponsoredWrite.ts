"use client";

import { useCallback, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { cadenceContracts, forwarderAbi, FORWARDER_EIP712_DOMAIN_NAME, FORWARDER_EIP712_DOMAIN_VERSION } from "./contracts";

const RELAY_GAS_LIMIT = 300_000n;

type WriteCall = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

// Every member action goes through here so it's gas-free wherever possible: sign a meta-transaction
// and it's relayed through CadenceForwarder at no cost to the wallet, falling back to a normal
// self-paid transaction only if sponsorship isn't available right now.
export function useSponsoredWrite() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();

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
        if (!address || !publicClient || chainId === undefined) throw new Error("Wallet not connected");
        // Caught here, before ever asking for a signature, so a wrong-network mismatch reads as
        // a clear instruction instead of a late, confusing failure from the signature domain or
        // the relay rejecting a request signed for the wrong chain.
        if (chainId !== baseSepolia.id) {
          throw new Error("Your wallet is on the wrong network — switch to Base Sepolia and try again.");
        }
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
    [reset, address, publicClient, chainId, signTypedDataAsync, payOwnGas],
  );

  const isConfirming = isConfirmingRelay || isConfirmingFallback;
  const isSuccess = isSuccessRelay || isSuccessFallback;

  const logs = relayReceipt?.logs ?? fallbackReceipt?.logs;

  return {
    write,
    reset,
    isPending,
    isConfirming,
    isSuccess,
    logs,
    error,
    notice,
  };
}
