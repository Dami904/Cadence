"use client";

import { useEffect, useState } from "react";
import { formatUnits, maxUint256, zeroAddress, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import {
  Check,
  Clock3,
  Copy,
  CreditCard,
  Eye,
  FileText,
  Gauge,
  HandCoins,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { ajoCircleAbi, CircleStatus, erc20Abi } from "../lib/contracts";
import { formatWriteError } from "../lib/formatError";
import { useCircleDetails, type MemberStatus } from "../lib/useCircleDetails";
import { useCircleName } from "../lib/useCircleName";
import { useSponsoredWrite } from "../lib/useSponsoredWrite";

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
  if (status === CircleStatus.Cancelled) return "CANCELLED";
  return "ACTIVE CIRCLE";
}

// Same tone vocabulary as the circles list: yellow = waiting, teal = running, violet = done,
// coral = stopped — so a circle's state reads at a glance instead of only through label text.
function statusTone(status: number | undefined) {
  if (status === CircleStatus.Forming) return "yellow";
  if (status === CircleStatus.Completed) return "violet";
  if (status === CircleStatus.Cancelled) return "coral";
  return "teal";
}

export function CircleDashboard({ circleAddress }: { circleAddress: Address }) {
  const { address: myAddress, isConnected } = useAccount();
  const details = useCircleDetails(circleAddress);
  const circleName = useCircleName(circleAddress);
  const [pendingAction, setPendingAction] = useState<"approve" | "contribute" | "start" | "replenish" | "leave" | "cover" | "cancel" | "withdraw" | null>(null);
  const [withdrawingSlot, setWithdrawingSlot] = useState<Address | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const { write, error: writeError, isPending, isConfirming, isSuccess, notice } = useSponsoredWrite();

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
    formingDeadline,
    amIMember,
    mySecurityDeposit,
    hasContributedThisRound,
    stalledOn,
    myWithdrawableSlots,
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
    if (pendingAction === "contribute" || pendingAction === "start" || pendingAction === "replenish" || pendingAction === "leave" || pendingAction === "cover" || pendingAction === "cancel" || pendingAction === "withdraw") refetch();
    setPendingAction(null);
    setWithdrawingSlot(null);
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
      // One max-amount approval instead of a per-round exact one — the only unsponsored, self-paid
      // step in the flow, so it should cost real gas once per member per circle, not every round.
      write({ address: asset, abi: erc20Abi, functionName: "approve", args: [circleAddress, maxUint256] });
      return;
    }
    setPendingAction("contribute");
    write({ address: circleAddress, abi: ajoCircleAbi, functionName: "contribute" });
  };

  const startCircle = () => {
    if (!isConnected || status !== CircleStatus.Forming || !isFull) return;
    setPendingAction("start");
    write({ address: circleAddress, abi: ajoCircleAbi, functionName: "start" });
  };

  const replenishDeposit = () => {
    if (!isConnected || !asset || depositShortfall <= 0n) return;
    if ((allowance ?? 0n) < depositShortfall) {
      setPendingAction("approve");
      write({ address: asset, abi: erc20Abi, functionName: "approve", args: [circleAddress, maxUint256] });
      return;
    }
    setPendingAction("replenish");
    write({ address: circleAddress, abi: ajoCircleAbi, functionName: "replenishDeposit" });
  };

  const leaveCircle = () => {
    if (!isConnected || status !== CircleStatus.Forming) return;
    setPendingAction("leave");
    write({ address: circleAddress, abi: ajoCircleAbi, functionName: "leave" });
  };

  const formingExpired = status === CircleStatus.Forming && formingDeadline !== undefined && Date.now() >= Number(formingDeadline) * 1000;

  const cancelExpiredCircle = () => {
    if (!isConnected || !formingExpired) return;
    setPendingAction("cancel");
    write({ address: circleAddress, abi: ajoCircleAbi, functionName: "cancelIfExpired" });
  };

  const withdrawSlot = (member: Address) => {
    if (!isConnected || (status !== CircleStatus.Cancelled && status !== CircleStatus.Completed)) return;
    setPendingAction("withdraw");
    setWithdrawingSlot(member);
    write({ address: circleAddress, abi: ajoCircleAbi, functionName: "withdrawDeposit", args: [member] });
  };

  const stalledMissing = stalledOn && depositAmount !== undefined ? depositAmount - stalledOn.depositBalance : 0n;

  const coverStalledMember = () => {
    if (!isConnected || !asset || !stalledOn || stalledMissing <= 0n) return;
    if ((allowance ?? 0n) < stalledMissing) {
      setPendingAction("approve");
      write({ address: asset, abi: erc20Abi, functionName: "approve", args: [circleAddress, maxUint256] });
      return;
    }
    setPendingAction("cover");
    write({ address: circleAddress, abi: ajoCircleAbi, functionName: "coverDeposit", args: [stalledOn.address] });
  };

  return (
    <>
      <div className="intro-row">
        <div>
          <div className={`eyebrow status-tone-${statusTone(status)}`}><span className={`live-dot tone-${statusTone(status)}`} /> {statusLabel(status)}</div>
          <h1>{circleName ?? shortAddress(circleAddress)}</h1>
          <p className="intro-copy">{circleName ? shortAddress(circleAddress) : "Your shared savings rhythm, onchain and on time."}</p>
        </div>
      </div>

      {stalledOn && (
        <section className="stall-banner">
          <ShieldAlert size={19} />
          <div>
            <b>Round stalled — waiting on {shortAddress(stalledOn.address)}{stalledOn.isYou ? " (you)" : ""}.</b>
            <p>
              {stalledOn.isYou
                ? "Your security deposit can't cover this round's contribution, so the payout can't execute yet."
                : "Their security deposit can't cover this round's contribution. Anyone in the circle can cover it for them to keep the round moving."}
            </p>
          </div>
          {stalledOn.isYou ? (
            <button className="outline-button" onClick={replenishDeposit} disabled={contributeLoading} type="button">
              {contributeLoading ? "Working…" : "Top up now"}
            </button>
          ) : (
            amIMember && (
              <button className="outline-button" onClick={coverStalledMember} disabled={contributeLoading} type="button">
                {contributeLoading ? "Working…" : (allowance ?? 0n) < stalledMissing ? "Approve & cover" : "Cover their deposit"}
              </button>
            )
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
              <div className="button-row-inline">
                <button className="outline-button" onClick={copyInviteLink} type="button">
                  {linkCopied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy invite link</>}
                </button>
                {amIMember && (
                  <button className="text-button" onClick={leaveCircle} disabled={contributeLoading} type="button">
                    {contributeLoading ? "Working…" : "Leave & reclaim deposit"}
                  </button>
                )}
              </div>
            </>
          )}
          {writeError && <p className="form-error dashboard-error">{formatWriteError(writeError)}</p>}
          {notice && <p className="form-note sponsor-notice">{notice}</p>}
          {formingExpired && (
            <div className="stall-banner">
              <ShieldAlert size={19} />
              <div>
                <b>This circle never filled.</b>
                <p>Its forming window has passed with open seats — anyone can cancel it so every member can reclaim their deposit.</p>
              </div>
              <button className="outline-button" onClick={cancelExpiredCircle} disabled={contributeLoading} type="button">
                {contributeLoading && pendingAction === "cancel" ? "Cancelling…" : "Cancel circle"}
              </button>
            </div>
          )}
        </section>
      ) : status === CircleStatus.Cancelled ? (
        <WithdrawPanel
          icon={<ShieldAlert size={22} />}
          heading="This circle was cancelled."
          body="It never filled before its forming deadline. Every posted deposit is waiting to be pulled back by whoever funded it."
          slots={myWithdrawableSlots}
          myAddress={myAddress}
          onWithdraw={withdrawSlot}
          isWorking={contributeLoading && pendingAction === "withdraw"}
          workingSlot={withdrawingSlot}
          writeError={writeError}
          notice={notice}
        />
      ) : status === CircleStatus.Completed ? (
        <>
          <WithdrawPanel
            icon={<ShieldCheck size={22} />}
            heading="This circle is complete."
            body="Every member had their round. Any deposit still sitting in the contract — yours, or one you rescued for someone else — is waiting to be pulled back."
            slots={myWithdrawableSlots}
            myAddress={myAddress}
            onWithdraw={withdrawSlot}
            isWorking={contributeLoading && pendingAction === "withdraw"}
            workingSlot={withdrawingSlot}
            writeError={writeError}
            notice={notice}
          />
          <section className="section-card members-card">
            <div className="section-heading"><div><h3>Final rotation order</h3><p>Locked at circle start — this is exactly what every member agreed to.</p></div><a className="text-button" href={`https://sepolia.basescan.org/address/${circleAddress}`} target="_blank" rel="noreferrer"><Eye size={16} /> View contract</a></div>
            <div className="member-table">
              <div className="table-head"><span>MEMBER</span><span>PAYOUT ROUND</span><span /><span /></div>
              {memberStatuses.map((member, index) => {
                const isYou = myAddress ? member.address.toLowerCase() === myAddress.toLowerCase() : false;
                return (
                  <div className="member-row" key={member.address}>
                    <div className="member-name">
                      <span className="order-number">{String(index + 1).padStart(2, "0")}</span>
                      <div className={`avatar avatar-${AVATAR_COLORS[index % AVATAR_COLORS.length]}`}>{initialsFor(member.address)}</div>
                      <strong>{shortAddress(member.address)}{isYou && <em>YOU</em>}</strong>
                    </div>
                    <div className="date-cell">Round {index + 1}</div>
                    <div><span className="status covered"><Check size={13} /> Paid out</span></div>
                    <a className="more-button" href={`https://sepolia.basescan.org/address/${member.address}`} target="_blank" rel="noreferrer" aria-label={`View ${shortAddress(member.address)} on BaseScan`}><Eye size={17} /></a>
                  </div>
                );
              })}
            </div>
          </section>
        </>
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
            {writeError && <p className="form-error dashboard-error">{formatWriteError(writeError)}</p>}
          {notice && <p className="form-note sponsor-notice">{notice}</p>}
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
                    <a className="more-button" href={`https://sepolia.basescan.org/address/${member.address}`} target="_blank" rel="noreferrer" aria-label={`View ${shortAddress(member.address)} on BaseScan`}><Eye size={17} /></a>
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

/// Shown for Cancelled and Completed circles — the only two states where a member (or a rescuer
/// who covered someone else's default) can pull a deposit balance back out, one slot at a time.
function WithdrawPanel({
  icon,
  heading,
  body,
  slots,
  myAddress,
  onWithdraw,
  isWorking,
  workingSlot,
  writeError,
  notice,
}: {
  icon: React.ReactNode;
  heading: string;
  body: string;
  slots: MemberStatus[];
  myAddress: Address | undefined;
  onWithdraw: (member: Address) => void;
  isWorking: boolean;
  workingSlot: Address | null;
  writeError: Error | null;
  notice: string | null;
}) {
  return (
    <section className="dashboard-empty">
      <div className="dashboard-empty-icon">{icon}</div>
      <h3>{heading}</h3>
      <p>{body}</p>
      {slots.length === 0 ? (
        <p className="muted">Nothing left for your wallet to withdraw here.</p>
      ) : (
        <div className="review-list" style={{ width: "100%", maxWidth: 420, marginTop: 18, textAlign: "left" }}>
          {slots.map((slot) => {
            const isOwnSlot = myAddress ? slot.address.toLowerCase() === myAddress.toLowerCase() : false;
            const working = isWorking && workingSlot?.toLowerCase() === slot.address.toLowerCase();
            return (
              <div key={slot.address}>
                <span>{isOwnSlot ? "YOUR DEPOSIT" : `RESCUED FOR ${shortAddress(slot.address)}`}</span>
                <strong>{formatUnits(slot.depositBalance, 6)} USDC</strong>
                <button className="solid-button" onClick={() => onWithdraw(slot.address)} disabled={isWorking} type="button">
                  {working ? "Withdrawing…" : "Withdraw"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {writeError && <p className="form-error dashboard-error">{formatWriteError(writeError)}</p>}
      {notice && <p className="form-note sponsor-notice">{notice}</p>}
    </section>
  );
}
