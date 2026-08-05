"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatUnits, isAddress, zeroAddress, type Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ArrowRight, Check, LockKeyhole, ShieldCheck, UsersRound } from "lucide-react";
import { AppShell } from "../../components/AppShell";
import { ajoCircleAbi, erc20Abi } from "../../lib/contracts";

type PendingAction = "approve" | "join" | null;

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinPageContent />
    </Suspense>
  );
}

function JoinPageContent() {
  const searchParams = useSearchParams();
  const [circleInput, setCircleInput] = useState("");
  const [circleAddress, setCircleAddress] = useState<Address | null>(null);
  const [inputError, setInputError] = useState("");
  const [joined, setJoined] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const { address, isConnected } = useAccount();
  const { data: txHash, error: writeError, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const circle = circleAddress ?? zeroAddress;

  const { data: asset, error: circleError } = useReadContract({
    address: circle, abi: ajoCircleAbi, functionName: "asset", query: { enabled: Boolean(circleAddress) },
  });
  const { data: depositAmount } = useReadContract({
    address: circle, abi: ajoCircleAbi, functionName: "depositAmount", query: { enabled: Boolean(circleAddress) },
  });
  const { data: contributionAmount } = useReadContract({
    address: circle, abi: ajoCircleAbi, functionName: "contributionAmount", query: { enabled: Boolean(circleAddress) },
  });
  const { data: targetMemberCount } = useReadContract({
    address: circle, abi: ajoCircleAbi, functionName: "targetMemberCount", query: { enabled: Boolean(circleAddress) },
  });
  const { data: memberCount } = useReadContract({
    address: circle, abi: ajoCircleAbi, functionName: "memberCount", query: { enabled: Boolean(circleAddress) },
  });
  const { data: alreadyMember } = useReadContract({
    address: circle, abi: ajoCircleAbi, functionName: "isMember", args: [address ?? zeroAddress],
    query: { enabled: Boolean(circleAddress && address) },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: asset ?? zeroAddress, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, circle],
    query: { enabled: Boolean(circleAddress && asset && address) },
  });

  const requiredDeposit = depositAmount ?? 0n;
  const hasApproval = (allowance ?? 0n) >= requiredDeposit;
  const depositLabel = formatUnits(requiredDeposit, 6);

  useEffect(() => {
    if (!isSuccess || !pendingAction) return;
    if (pendingAction === "approve") refetchAllowance();
    if (pendingAction === "join") setJoined(true);
    setPendingAction(null);
  }, [isSuccess, pendingAction, refetchAllowance]);

  useEffect(() => {
    const fromLink = searchParams.get("address");
    if (fromLink && isAddress(fromLink)) {
      setCircleInput(fromLink);
      setCircleAddress(fromLink);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findCircle = () => {
    if (!isAddress(circleInput)) {
      setInputError("Enter a valid Base Sepolia circle contract address.");
      return;
    }
    setInputError("");
    setJoined(false);
    setCircleAddress(circleInput);
  };

  const joinCircle = () => {
    if (!isConnected || !address || !circleAddress || !asset || requiredDeposit === 0n) return;
    if (!hasApproval) {
      setPendingAction("approve");
      writeContract({ address: asset, abi: erc20Abi, functionName: "approve", args: [circleAddress, requiredDeposit] });
      return;
    }
    setPendingAction("join");
    writeContract({ address: circleAddress, abi: ajoCircleAbi, functionName: "join" });
  };

  const loading = isPending || isConfirming;
  const circleUnavailable = Boolean(circleAddress && circleError);
  const memberLabel = memberCount !== undefined && targetMemberCount !== undefined
    ? String(memberCount) + " of " + String(targetMemberCount)
    : "Loading…";
  const contributionLabel = contributionAmount ? formatUnits(contributionAmount, 6) + " USDC" : "Loading…";
  const circleShortAddress = circleAddress ? circleAddress.slice(0, 6) + "…" + circleAddress.slice(-4) : "";
  const joinButtonLabel = loading
    ? isPending ? "Confirm in wallet…" : "Confirming…"
    : hasApproval ? "Join for " + depositLabel + " USDC" : "Approve " + depositLabel + " USDC";

  return (
    <AppShell active="My circles" title="Join a circle">
      <div className="join-page">
        <section className="join-card">
          {!circleAddress ? (
            <>
              <div className="join-card-icon"><UsersRound size={27} /></div>
              <p className="eyebrow">YOU&apos;RE INVITED</p>
              <h1>Join a savings circle.</h1>
              <p>Paste the Base Sepolia circle contract address shared by your organizer.</p>
              <label>Circle contract address<input value={circleInput} onChange={(event) => setCircleInput(event.target.value)} placeholder="0x…" /></label>
              {inputError && <p className="form-error">{inputError}</p>}
              <button className="solid-button wide-button" onClick={findCircle} type="button">Find circle <ArrowRight size={17} /></button>
              <span className="form-note">You&apos;ll review immutable terms before approving USDC.</span>
            </>
          ) : joined || alreadyMember ? (
            <>
              <div className="join-card-icon success"><Check size={27} /></div>
              <h1>You&apos;re in the circle.</h1>
              <p>Your security deposit is held by the circle contract. The circle starts once all members have joined.</p>
              <div className="joined-order"><span>YOUR CIRCLE</span><b>{circleShortAddress}</b><p>Review activity from your dashboard.</p></div>
              <Link href="/dashboard" className="solid-button wide-button">Go to dashboard <ArrowRight size={17} /></Link>
            </>
          ) : circleUnavailable ? (
            <>
              <div className="join-card-icon"><LockKeyhole size={27} /></div>
              <h1>Circle unavailable.</h1>
              <p>That address does not appear to be a Cadence circle on the configured network.</p>
              <button className="solid-button wide-button" onClick={() => setCircleAddress(null)} type="button">Try another address</button>
            </>
          ) : (
            <>
              <div className="circle-invite-top"><span className="circle-stage teal"><i /> FORMING</span><div className="invite-art">C</div><h1>Cadence circle</h1><p>Terms read directly from the immutable contract.</p></div>
              <div className="invite-facts">
                <div><span>CONTRIBUTION</span><b>{contributionLabel}</b></div>
                <div><span>MEMBERS</span><b>{memberLabel}</b></div>
                <div><span>SECURITY DEPOSIT</span><b>{depositAmount ? depositLabel + " USDC" : "Loading…"}</b></div>
              </div>
              <div className="lock-callout small"><LockKeyhole size={19} /><div><b>One round is protected.</b><p>Your deposit covers a missed contribution and remains in the contract.</p></div></div>
              {!isConnected && <p className="form-error">Connect your Base Sepolia wallet to continue.</p>}
              {writeError && <p className="form-error">{writeError.message}</p>}
              <button className="solid-button wide-button" disabled={!isConnected || !asset || requiredDeposit === 0n || loading} onClick={joinCircle} type="button">
                {joinButtonLabel} <ArrowRight size={17} />
              </button>
              <span className="form-note">Approval is required once; joining posts exactly one security deposit.</span>
            </>
          )}
        </section>
        <aside className="join-aside">
          <div className="eyebrow"><ShieldCheck size={13} /> WHAT YOU&apos;RE JOINING</div>
          <h2>A circle built on a shared promise.</h2>
          <p>Every member contributes on the same rhythm. Each gets the full pot once, in an order agreed before the circle begins.</p>
          <div><Check size={17} /><span>Your money goes directly into the circle contract</span></div>
          <div><Check size={17} /><span>Missed payments are protected by a security deposit</span></div>
          <div><Check size={17} /><span>Every payout is an inspectable onchain action</span></div>
        </aside>
      </div>
    </AppShell>
  );
}
