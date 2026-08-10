"use client";

import { useEffect, useState } from "react";
import { formatUnits, zeroAddress, type Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  ArrowRight,
  Check,
  Clock3,
  Copy,
  CreditCard,
  Eye,
  FileText,
  Gauge,
  HandCoins,
  LockKeyhole,
  MoreHorizontal,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { ajoCircleAbi, CircleStatus, erc20Abi } from "../lib/contracts";
import { useCircleDetails } from "../lib/useCircleDetails";

const AVATAR_COLORS = ["teal", "peach", "violet", "blue", "yellow"] as const;

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function initialsFor(address: string) {
  return address.slice(2, 4).toUpperCase();
}

function statusLabel(status: number | undefined) {
  if (status === CircleStatus.Forming) return "FORMING";
  if (status === CircleStatus.Completed) return "COMPLETED";
  return "ACTIVE CIRCLE";
}

export function CircleDashboard({ circleAddress }: { circleAddress: Address }) {
  const { address: myAddress, isConnected } = useAccount();
  const details = useCircleDetails(circleAddress);
  const [pendingAction, setPendingAction] = useState<"approve" | "contribute" | "start" | "replenish" | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const { data: txHash, error: writeError, isPending, writeContract } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const {
    isLoading,
    status,
    currentRound,
    currentRoundDeadline,
    currentRoundFunding,
    contributionAmount,
    depositAmount,
    targetMemberCount,
    memberStatuses,
    recipient,
    asset,
    amIMember,
    mySecurityDeposit,
    hasContributedThisRound,
    stalledOn,
    refetch,
  } = details;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: asset ?? zeroAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [myAddress ?? zeroAddress, circleAddress],
    query: { enabled: Boolean(asset && myAddress) },
  });

  useEffect(() => {
    if (!isSuccess || !pendingAction) return;
    if (pendingAction === "approve") refetchAllowance();
    if (pendingAction === "contribute" || pendingAction === "start" || pendingAction === "replenish") refetch();
    setPendingAction(null);
  }, [isSuccess, pendingAction, refetchAllowance, refetch]);

  if (isLoading) {
    return (
      <section className="dashboard-empty">
        <div className="dashboard-empty-icon"><Gauge size={22} /></div>
        <h3>Reading circle from Base Sepolia…</h3>
        <p>Fetching members, round state, and contribution status from the contract.</p>
      </section>
    );
  }

  if (status === undefined || contributionAmount === undefined || targetMemberCount === undefined) {
    return (
      <section className="dashboard-empty">
        <div className="dashboard-empty-icon"><LockKeyhole size={22} /></div>
        <h3>Circle unavailable.</h3>
        <p>That address does not appear to be a Cadence circle on the configured network.</p>
      </section>
    );
  }

  const pot = contributionAmount * targetMemberCount;
  const contributedCount = memberStatuses.filter((member) => member.contributed || member.covered).length;
  const fundingPct = targetMemberCount > 0n ? Math.round((contributedCount / Number(targetMemberCount)) * 100) : 0;
  const hasAllowance = (allowance ?? 0n) >= contributionAmount;
  const deadlineDate = currentRoundDeadline
    ? new Date(Number(currentRoundDeadline) * 1000).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : "—";
  const contributeLoading = (isPending || isConfirming) && pendingAction !== null;
  const isFull = memberStatuses.length > 0 && BigInt(memberStatuses.length) === targetMemberCount;
  const depositShortfall = amIMember && depositAmount !== undefined && mySecurityDeposit !== undefined
    ? depositAmount - mySecurityDeposit
    : 0n;

  const copyInviteLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/join?address=${circleAddress}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1600);
  };

  const contribute = () => {
    if (!isConnected || !asset || status !== CircleStatus.Active) return;
    if (!hasAllowance) {
      setPendingAction("approve");
      writeContract({ address: asset, abi: erc20Abi, functionName: "approve", args: [circleAddress, contributionAmount] });
      return;
    }
    setPendingAction("contribute");
    writeContract({ address: circleAddress, abi: ajoCircleAbi, functionName: "contribute" });
  };

  const startCircle = () => {
    if (!isConnected || status !== CircleStatus.Forming || !isFull) return;
    setPendingAction("start");
    writeContract({ address: circleAddress, abi: ajoCircleAbi, functionName: "start" });
  };

  const replenishDeposit = () => {
    if (!isConnected || !asset || depositShortfall <= 0n) return;
    if ((allowance ?? 0n) < depositShortfall) {
      setPendingAction("approve");
      writeContract({ address: asset, abi: erc20Abi, functionName: "approve", args: [circleAddress, depositShortfall] });
      return;
    }
    setPendingAction("replenish");
    writeContract({ address: circleAddress, abi: ajoCircleAbi, functionName: "replenishDeposit" });
  };

  return (
    <>
      <div className="intro-row">
        <div>
          <div className="eyebrow"><span className="live-dot" /> {statusLabel(status)}</div>
          <h1>{shortAddress(circleAddress)}</h1>
          <p className="intro-copy">Your shared savings rhythm, onchain and on time.</p>
        </div>
      </div>

      {stalledOn && (
        <section className="stall-banner">
          <ShieldAlert size={19} />
          <div>
            <b>Round stalled — waiting on {shortAddress(stalledOn.address)}{stalledOn.isYou ? " (you)" : ""}.</b>
            <p>Their security deposit can&apos;t cover this round&apos;s contribution, so the payout can&apos;t execute yet. No one else can move this forward.</p>
          </div>
          {stalledOn.isYou && (
            <button className="outline-button" onClick={replenishDeposit} disabled={contributeLoading} type="button">
              {contributeLoading ? "Working…" : "Top up now"}
            </button>
          )}
        </section>
      )}

      {status === CircleStatus.Forming ? (
        <section className="dashboard-empty">
          <div className="dashboard-empty-icon"><Sparkles size={22} /></div>
          {isFull ? (
            <>
              <h3>All members have joined.</h3>
              <p>The rotation order is locked in join order. Start the circle to open round one — anyone in the circle can do this.</p>
              <button className="solid-button" onClick={startCircle} disabled={contributeLoading} type="button">
                <Zap size={17} /> {contributeLoading ? "Starting…" : "Start circle"}
              </button>
            </>
          ) : (
            <>
              <h3>Waiting for members to join.</h3>
              <p>{memberStatuses.length} of {String(targetMemberCount)} members have joined. Anyone can start the circle once it&apos;s full.</p>
              <button className="outline-button" onClick={copyInviteLink} type="button">
                {linkCopied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy invite link</>}
              </button>
            </>
          )}
          {writeError && <p className="form-error dashboard-error">{writeError.message}</p>}
        </section>
      ) : (
        <>
          <section className="hero-card">
            <div className="hero-orbit orbit-a" /><div className="hero-orbit orbit-b" />
            <div className="hero-grid">
              <div className="hero-main">
                <div className="round-chip"><Sparkles size={15} /> ROUND {String(currentRound).padStart(2, "0")} OF {String(targetMemberCount).padStart(2, "0")}</div>
                <h2>${formatUnits(pot, 6)}</h2>
                <p>Current pot</p>
                <div className="progress-wrap">
                  <div className="progress-label"><span>Circle funding</span><b>{contributedCount} of {String(targetMemberCount)} contributions</b></div>
                  <div className="progress-bar"><i style={{ width: `${fundingPct}%` }} /></div>
                </div>
              </div>
              <div className="hero-split" />
              <div className="payout-panel">
                <div className="panel-label">NEXT PAYOUT</div>
                <div className="recipient-row">
                  <div className="avatar avatar-teal">{recipient ? initialsFor(recipient) : "—"}</div>
                  <div><strong>{recipient && myAddress && recipient.toLowerCase() === myAddress.toLowerCase() ? "You" : recipient ? shortAddress(recipient) : "—"}</strong><span>Round {String(currentRound)} recipient</span></div>
                </div>
                <div className="payout-date"><Clock3 size={16} /><span>{deadlineDate}</span></div>
                <div className="secure-note"><ShieldCheck size={15} /> Locked at circle start</div>
              </div>
            </div>
            <div className="hero-bottom">
              <div className="hero-proof"><Zap size={16} /><span>Reads live from <b>AjoCircle.currentRoundFunding()</b></span></div>
              {amIMember && (
                <button className={`contribute-button ${hasContributedThisRound ? "done" : ""}`} disabled={hasContributedThisRound || contributeLoading} onClick={contribute}>
                  {hasContributedThisRound ? <><Check size={18} /> Contribution complete</> : contributeLoading ? <>{pendingAction === "approve" ? "Approving…" : "Confirming…"}</> : <><CreditCard size={17} /> {hasAllowance ? "Contribute" : "Approve & contribute"} {formatUnits(contributionAmount, 6)}</>}
                </button>
              )}
            </div>
            {writeError && <p className="form-error dashboard-error">{writeError.message}</p>}
          </section>

          <div className="stats-grid">
            <article className="stat-card"><div className="stat-icon peach"><HandCoins size={19} /></div><div><p>YOUR CONTRIBUTION</p><strong>{formatUnits(contributionAmount, 6)}</strong><small className={hasContributedThisRound ? "positive" : "pending"}>{hasContributedThisRound ? "Paid for this round" : amIMember ? "Not yet paid" : "Not a member"}</small></div></article>
            <article className="stat-card"><div className="stat-icon violet"><Gauge size={19} /></div><div><p>CIRCLE HEALTH</p><strong>{contributedCount === Number(targetMemberCount) ? "Fully funded" : "In progress"}</strong><small>{currentRoundFunding !== undefined ? `${formatUnits(currentRoundFunding, 6)} of ${formatUnits(pot, 6)} collected` : ""}</small></div></article>
            {amIMember && depositAmount !== undefined && (
              <article className="stat-card">
                <div className="stat-icon blue"><ShieldCheck size={19} /></div>
                <div>
                  <p>SECURITY DEPOSIT</p>
                  <strong>{formatUnits(mySecurityDeposit ?? 0n, 6)}<span> / {formatUnits(depositAmount, 6)}</span></strong>
                  <small className={depositShortfall > 0n ? "pending" : "positive"}>{depositShortfall > 0n ? "Top up to stay protected" : "Fully covered"}</small>
                  {depositShortfall > 0n && (
                    <button className="text-button" onClick={replenishDeposit} disabled={contributeLoading} type="button">
                      {contributeLoading ? "Working…" : "Top up"}
                    </button>
                  )}
                </div>
              </article>
            )}
          </div>

          <section className="section-card members-card">
            <div className="section-heading"><div><h3>Circle members</h3><p>Rotation is locked. Every member gets a turn.</p></div><a className="text-button" href={`https://sepolia.basescan.org/address/${circleAddress}`} target="_blank" rel="noreferrer"><Eye size={16} /> View contract</a></div>
            <div className="member-table">
              <div className="table-head"><span>MEMBER</span><span>THIS ROUND</span><span>PAYOUT ROUND</span><span /></div>
              {memberStatuses.map((member, index) => {
                const isYou = myAddress ? member.address.toLowerCase() === myAddress.toLowerCase() : false;
                const memberStatus = member.covered ? "Covered" : member.contributed ? "Paid" : "Due";
                return (
                  <div className="member-row" key={member.address}>
                    <div className="member-name">
                      <span className="order-number">{String(index + 1).padStart(2, "0")}</span>
                      <div className={`avatar avatar-${AVATAR_COLORS[index % AVATAR_COLORS.length]}`}>{initialsFor(member.address)}</div>
                      <strong>{shortAddress(member.address)}{isYou && <em>YOU</em>}</strong>
                    </div>
                    <div><span className={`status ${memberStatus.toLowerCase()}`}>{memberStatus === "Paid" && <Check size={13} />}{memberStatus}</span></div>
                    <div className="date-cell">Round {index + 1}</div>
                    <button className="more-button" aria-label={`More options for ${shortAddress(member.address)}`}><MoreHorizontal size={19} /></button>
                  </div>
                );
              })}
            </div>
            <a className="mobile-view-contract" href={`https://sepolia.basescan.org/address/${circleAddress}`} target="_blank" rel="noreferrer"><FileText size={16} /> View verified contract</a>
          </section>
        </>
      )}
    </>
  );
}
