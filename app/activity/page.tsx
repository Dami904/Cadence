"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { ArrowUpRight, Check, CircleDollarSign, HeartHandshake, LockKeyhole, LogOut, ShieldAlert, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { useActivityFeed, type ActivityEntry } from "../../lib/useActivityFeed";

// Only these two AjoCircle functions are gated onlyKeeper (see contracts/AjoCircle.sol),
// so only these event kinds were provably executed by the authorized KeeperHub wallet —
// contributions and joins are member-initiated and get no workflow attribution.
const workflowFor: Partial<Record<ActivityEntry["kind"], string>> = {
  "Payout": "Cadence Payout Execution",
  "Circle completed": "Cadence Payout Execution",
  "Default covered": "Cadence Default Detection + Deposit Draw",
  "Default uncovered": "Cadence Default Detection + Deposit Draw",
};

const kindIcon: Record<ActivityEntry["kind"], typeof Check> = {
  "Circle created": Sparkles,
  "Contribution": Check,
  "Default covered": ShieldCheck,
  "Default uncovered": ShieldAlert,
  "Payout": CircleDollarSign,
  "Circle completed": Check,
  "Circle cancelled": ShieldAlert,
  "Member joined": UsersRound,
  "Member left": LogOut,
  "Deposit replenished": ShieldCheck,
  "Deposit covered": HeartHandshake,
  "Deposit returned": CircleDollarSign,
};

const kindTone: Record<ActivityEntry["kind"], string> = {
  "Circle created": "violet",
  "Contribution": "teal",
  "Default covered": "coral",
  "Default uncovered": "coral",
  "Payout": "yellow",
  "Circle completed": "violet",
  "Circle cancelled": "coral",
  "Member joined": "violet",
  "Member left": "coral",
  "Deposit replenished": "teal",
  "Deposit covered": "violet",
  "Deposit returned": "teal",
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

const CIRCLE_LEVEL_KINDS: ActivityEntry["kind"][] = ["Circle cancelled", "Circle completed"];

export default function ActivityPage() {
  const { entries, isLoading, error } = useActivityFeed();
  const [scope, setScope] = useState<"mine" | "everyone">("mine");
  // "Mine" keeps anything you did plus circle-wide events (cancelled/completed) that affect
  // you even though they're not attributed to any one address — everything else (other
  // members contributing, joining, leaving) is still onchain and visible, just filtered out here.
  const visibleEntries = scope === "everyone" ? entries : entries.filter((entry) => entry.isYou || CIRCLE_LEVEL_KINDS.includes(entry.kind));
  const groups = groupByDate(visibleEntries);
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
        <div className="circle-switcher">
          <button className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")}>Just me</button>
          <button className={scope === "everyone" ? "active" : ""} onClick={() => setScope("everyone")}>Everyone in my circles</button>
        </div>
      </div>
      <section className="activity-layout">
        <div className="activity-feed">
          {isLoading && <p className="date-divider">LOADING…</p>}
          {!isLoading && error && <p className="form-error dashboard-error">Couldn&apos;t load activity from the chain — {error.message}</p>}
          {!isLoading && !error && visibleEntries.length === 0 && <p className="date-divider">{entries.length === 0 ? "No onchain activity yet for your circles." : "No activity from just you yet — try “Everyone in my circles”."}</p>}
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
  const router = useRouter();
  const Icon = kindIcon[entry.kind];
  const tone = kindTone[entry.kind];
  const workflow = workflowFor[entry.kind];
  // Still a member → straight into the circle. Not (anymore, or not yet — e.g. a "Circle
  // created" entry for a circle you haven't joined) → the join page for that address instead.
  const destination = entry.isMember ? `/circle/${entry.circleAddress}` : `/join?address=${entry.circleAddress}`;
  const go = () => router.push(destination);

  return (
    <article
      className="activity-item clickable"
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          go();
        }
      }}
    >
      <div className={`activity-icon ${tone}`}><Icon size={18} /></div>
      <div className="activity-copy">
        <span>{entry.kind}{entry.isYou ? " · You" : ""}</span>
        <h3>{entry.title}</h3>
        <p>{entry.copy}</p>
        {workflow && <span className="workflow-status"><i /> {workflow}</span>}
      </div>
      <div className="activity-meta">
        <time>{formatTime(entry.timestamp)}</time>
        <a href={`https://sepolia.basescan.org/tx/${entry.hash}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          <button type="button">{entry.hash.slice(0, 6)}…{entry.hash.slice(-4)}<ArrowUpRight size={13} /></button>
        </a>
      </div>
    </article>
  );
}
