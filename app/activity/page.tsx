"use client";

import { AppShell } from "../../components/AppShell";
import { ArrowUpRight, Check, CircleDollarSign, LockKeyhole, ShieldCheck, UsersRound } from "lucide-react";
import { useActivityFeed, type ActivityEntry } from "../../lib/useActivityFeed";

// Only these two AjoCircle functions are gated onlyKeeper (see contracts/AjoCircle.sol),
// so only these event kinds were provably executed by the authorized KeeperHub wallet —
// contributions and joins are member-initiated and get no workflow attribution.
const workflowFor: Partial<Record<ActivityEntry["kind"], string>> = {
  "Payout": "Cadence Payout Execution",
  "Circle completed": "Cadence Payout Execution",
  "Default covered": "Cadence Default Detection + Deposit Draw",
};

const kindIcon: Record<ActivityEntry["kind"], typeof Check> = {
  "Contribution": Check,
  "Default covered": ShieldCheck,
  "Payout": CircleDollarSign,
  "Circle completed": Check,
  "Member joined": UsersRound,
};

const kindTone: Record<ActivityEntry["kind"], string> = {
  "Contribution": "teal",
  "Default covered": "coral",
  "Payout": "yellow",
  "Circle completed": "violet",
  "Member joined": "violet",
};

function formatTime(timestamp: number) {
  if (!timestamp) return "Pending";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateLabel(timestamp: number) {
  if (!timestamp) return "PENDING";
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "TODAY";
  if (date.toDateString() === yesterday.toDateString()) return "YESTERDAY";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase();
}

function groupByDate(entries: ActivityEntry[]) {
  const groups: { label: string; items: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const label = dateLabel(entry.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}

export default function ActivityPage() {
  const { entries, isLoading } = useActivityFeed();
  const groups = groupByDate(entries);
  const contributionsMade = entries.filter((entry) => entry.kind === "Contribution" && entry.isYou).length;
  const payoutsReceived = entries.filter((entry) => entry.kind === "Payout" && entry.isYou).length;

  return (
    <AppShell active="Activity" title="Activity">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow"><LockKeyhole size={13} /> EVERYTHING, IN THE OPEN</p>
          <h1>Activity.</h1>
          <p>A complete record of your circles and contributions, read directly from the chain.</p>
        </div>
      </div>
      <section className="activity-layout">
        <div className="activity-feed">
          {isLoading && <p className="date-divider">LOADING…</p>}
          {!isLoading && entries.length === 0 && <p className="date-divider">No onchain activity yet for your circles.</p>}
          {groups.map((group) => (
            <div key={group.label}>
              <p className="date-divider">{group.label}</p>
              {group.items.map((entry) => (
                <ActivityItem key={entry.key} entry={entry} />
              ))}
            </div>
          ))}
        </div>
        <aside className="activity-side">
          <div className="side-stat"><span>CONTRIBUTIONS MADE</span><strong>{contributionsMade}</strong><p>Across all your circles</p></div>
          <div className="side-stat"><span>PAYOUTS RECEIVED</span><strong>{payoutsReceived}</strong><p className="success-text">Recorded onchain</p></div>
          <div className="activity-tip"><CircleDollarSign size={19} /><b>Everything is traceable</b><p>Transactions and workflow runs can always be checked onchain.</p></div>
        </aside>
      </section>
    </AppShell>
  );
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const Icon = kindIcon[entry.kind];
  const tone = kindTone[entry.kind];
  const workflow = workflowFor[entry.kind];
  return (
    <article className="activity-item">
      <div className={`activity-icon ${tone}`}><Icon size={18} /></div>
      <div className="activity-copy">
        <span>{entry.kind}{entry.isYou ? " · You" : ""}</span>
        <h3>{entry.title}</h3>
        <p>{entry.copy}</p>
        {workflow && <span className="workflow-status"><i /> {workflow}</span>}
      </div>
      <div className="activity-meta">
        <time>{formatTime(entry.timestamp)}</time>
        <a href={`https://sepolia.basescan.org/tx/${entry.hash}`} target="_blank" rel="noreferrer">
          <button type="button">{entry.hash.slice(0, 6)}…{entry.hash.slice(-4)}<ArrowUpRight size={13} /></button>
        </a>
      </div>
    </article>
  );
}
