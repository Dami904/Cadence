"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { AppShell } from "../../components/AppShell";
import { ArrowUpRight, Check, CircleCheck, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { cadenceContracts, trustScoreRegistryAbi } from "../../lib/contracts";
import { useTrustScore } from "../../lib/useTrustScore";

export default function TrustScorePage() {
  const { isConnected } = useAccount();
  const { configured, isLoading, hasLinkedIdentity, agentId, completions, defaults, score, mostRecent, refetchLinked } = useTrustScore();

  if (!isConnected) {
    return (
      <AppShell active="Trust score" title="Trust score">
        <div className="page-heading compact">
          <div>
            <p className="eyebrow">PORTABLE REPUTATION</p>
            <h1>Your Trust Score</h1>
            <p>Connect your wallet to see your circle history.</p>
          </div>
        </div>
        <section className="score-note">
          <ShieldCheck size={20} />
          <p><b>No wallet connected.</b> <Link href="/connect">Connect a wallet</Link> to view or link your Trust Score.</p>
        </section>
      </AppShell>
    );
  }

  if (!configured) {
    return (
      <AppShell active="Trust score" title="Trust score">
        <div className="page-heading compact">
          <div>
            <p className="eyebrow">PORTABLE REPUTATION</p>
            <h1>Your Trust Score</h1>
          </div>
        </div>
        <section className="score-note">
          <ShieldCheck size={20} />
          <p><b>Trust Score registry not configured.</b> Set NEXT_PUBLIC_TRUST_SCORE_REGISTRY_ADDRESS to enable this page.</p>
        </section>
      </AppShell>
    );
  }

  if (!isLoading && !hasLinkedIdentity) {
    return <LinkIdentityPanel onLinked={refetchLinked} />;
  }

  return (
    <AppShell active="Trust score" title="Trust score">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">PORTABLE REPUTATION</p>
          <h1>Your Trust Score</h1>
          <p>A transparent record of how you show up for your circles.</p>
        </div>
        <a className="outline-button" href={`https://sepolia.basescan.org/address/${cadenceContracts.trustScoreRegistry}`} target="_blank" rel="noreferrer">
          <ArrowUpRight size={15} /> View ERC-8004 profile
        </a>
      </div>
      {isLoading ? (
        <section className="score-note"><p>Loading onchain outcomes…</p></section>
      ) : (
        <>
          <section className="score-hero">
            <div className="score-ring">
              <div><strong>{score}</strong><span>/100</span><p>{score >= 80 ? "EXCELLENT" : score >= 50 ? "GOOD" : "NEEDS WORK"}</p></div>
            </div>
            <div className="score-copy">
              {agentId !== undefined && (
                <span className="score-badge"><Sparkles size={14} /> ERC-8004 AGENT #{agentId.toString()}</span>
              )}
              <h2>{defaults === 0 ? <>You&apos;re a remarkably reliable<br />circle member.</> : <>Your score reflects a recorded<br />missed contribution.</>}</h2>
              <p>Your score is built from real completed circles and contribution outcomes—never from a private formula.</p>
              <div>
                <b><Check size={15} /> {completions} successful {completions === 1 ? "payout" : "payouts"}</b>
                <b><Check size={15} /> {defaults} missed {defaults === 1 ? "contribution" : "contributions"}</b>
              </div>
            </div>
            {mostRecent && (
              <div className="score-delta">
                <Trophy size={21} />
                <span>MOST RECENT</span>
                <strong>{mostRecent.value > 0n ? "+" : ""}{mostRecent.value.toString()} pts</strong>
                <p>{mostRecent.tag === "cadence-circle-completion" ? "Circle completion recorded" : "Missed contribution recorded"}</p>
              </div>
            )}
          </section>
          <section className="score-breakdown">
            <div className="section-heading">
              <div>
                <h3>What makes up your score</h3>
                <p>Outcomes recorded on your ERC-8004 reputation profile.</p>
              </div>
            </div>
            <div className="breakdown-list">
              <ScoreRow icon={<CircleCheck size={19} />} title="Circle completions" detail={`${completions} complete ${completions === 1 ? "circle" : "circles"}`} value={String(completions)} />
              <ScoreRow icon={<ShieldCheck size={19} />} title="Circle protection" detail={defaults === 0 ? "No defaults recorded" : `${defaults} default${defaults === 1 ? "" : "s"} recorded`} value={defaults === 0 ? "+0" : `-${defaults}`} muted={defaults === 0} />
            </div>
          </section>
        </>
      )}
      <section className="score-note">
        <ShieldCheck size={20} />
        <p><b>Your score belongs to you.</b> Cadence records outcomes using ERC-8004 so your reputation can travel beyond this app.</p>
      </section>
    </AppShell>
  );
}

function LinkIdentityPanel({ onLinked }: { onLinked: () => void }) {
  const [agentIdInput, setAgentIdInput] = useState("");
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) onLinked();
  }, [isSuccess, onLinked]);

  const submit = () => {
    if (!agentIdInput) return;
    writeContract({
      address: cadenceContracts.trustScoreRegistry,
      abi: trustScoreRegistryAbi,
      functionName: "linkIdentity",
      args: [BigInt(agentIdInput)],
    });
  };

  return (
    <AppShell active="Trust score" title="Trust score">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">PORTABLE REPUTATION</p>
          <h1>Your Trust Score</h1>
          <p>Link an ERC-8004 identity you own to start recording circle outcomes to your Trust Score.</p>
        </div>
      </div>
      <section className="score-note">
        <ShieldCheck size={20} />
        <div className="form-grid">
          <label>
            ERC-8004 agent ID
            <input
              type="number"
              min="0"
              value={agentIdInput}
              onChange={(event) => setAgentIdInput(event.target.value)}
              placeholder="e.g. 42"
            />
          </label>
          <button className="solid-button" onClick={submit} disabled={!agentIdInput || isPending || isConfirming}>
            {isPending || isConfirming ? "Linking…" : "Link identity"} <Check size={16} />
          </button>
          {error && <p className="form-error">{error.message}</p>}
          {isSuccess && <p className="success-text">Identity linked.</p>}
        </div>
      </section>
    </AppShell>
  );
}

function ScoreRow({ icon, title, detail, value, muted }: { icon: React.ReactNode; title: string; detail: string; value: string; muted?: boolean }) {
  return (
    <div className="score-row">
      <div className="score-row-icon">{icon}</div>
      <div><b>{title}</b><p>{detail}</p></div>
      <strong className={muted ? "muted-score" : ""}>{value}</strong>
    </div>
  );
}
