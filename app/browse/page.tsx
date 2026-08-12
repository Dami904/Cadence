"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatUnits } from "viem";
import { ArrowRight, ArrowUpRight, CircleDollarSign, Clock3, Compass, ShieldAlert, ShieldCheck, UsersRound, Zap } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CircleStatus } from "@/lib/contracts";
import { useAllCircles } from "@/lib/useAllCircles";
import { useCircleCards, type CircleCard } from "@/lib/useCircleCards";
import { useGlobalAutomationFeed, type AutomationEntry } from "@/lib/useGlobalAutomationFeed";

const automationIcon: Record<AutomationEntry["kind"], typeof Zap> = {
  "Payout": CircleDollarSign,
  "Default covered": ShieldCheck,
  "Default uncovered": ShieldAlert,
  "Circle completed": ShieldCheck,
};

function formatWhen(timestamp: number) {
  if (!timestamp) return "Pending";
  return new Date(timestamp * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function stageLabel(card: CircleCard) {
  if (card.status === CircleStatus.Forming) return `Forming · ${String(card.memberCount)} of ${String(card.targetMemberCount)} joined`;
  if (card.status === CircleStatus.Completed) return "Completed";
  if (card.status === CircleStatus.Cancelled) return "Cancelled";
  return `Active · Round ${String(card.currentRound)} of ${String(card.targetMemberCount)}`;
}

function stageTone(card: CircleCard) {
  if (card.status === CircleStatus.Forming) return "yellow";
  if (card.status === CircleStatus.Completed) return "violet";
  if (card.status === CircleStatus.Cancelled) return "coral";
  return "teal";
}

function payoutLabel(card: CircleCard) {
  if (card.status === CircleStatus.Forming) return "Starts when full";
  if (card.status === CircleStatus.Completed) return "Circle complete";
  if (card.status === CircleStatus.Cancelled) return "Cancelled — deposits refundable";
  return new Date(Number(card.currentRoundDeadline) * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The only page in the product that needs nothing at all — no wallet, no invite address — to show
// a real, live circle. Every other view of circle data requires either membership (My circles) or
// an address already in hand (Join, or a direct /circle/<address> link).
export default function BrowsePage() {
  const { isLoading: isLoadingAddresses, addresses } = useAllCircles();
  const { cards, isLoading: isLoadingCards } = useCircleCards(addresses);
  const isLoading = isLoadingAddresses || (addresses.length > 0 && isLoadingCards);
  const { entries: automationEntries, isLoading: isLoadingAutomation } = useGlobalAutomationFeed();

  const activeCount = cards.filter((card) => card.status === CircleStatus.Active).length;
  const formingCount = cards.filter((card) => card.status === CircleStatus.Forming).length;

  return (
    <AppShell active="Browse circles" title="Browse circles">
      <div className="page-heading">
        <div>
          <p className="eyebrow">EVERY CIRCLE, IN THE OPEN</p>
          <h1>Browse circles</h1>
          <p>Every circle Cadence has ever created on Base Sepolia, read directly from the chain — no wallet needed to look.</p>
        </div>
      </div>

      {!isLoading && cards.length > 0 && (
        <div className="circle-summary">
          <div><span>TOTAL CIRCLES</span><strong>{cards.length}</strong><small>Deployed by the factory</small></div>
          <div><span>ACTIVE ROUNDS</span><strong>{activeCount}</strong><small>Currently in progress</small></div>
          <div><span>FORMING</span><strong>{formingCount}</strong><small>Still taking members</small></div>
        </div>
      )}

      {isLoading ? (
        <section className="dashboard-empty">
          <div className="dashboard-empty-icon"><Compass size={22} /></div>
          <h3>Reading circles from Base Sepolia…</h3>
          <p>Scanning the factory's event log for every circle it has ever created.</p>
        </section>
      ) : cards.length === 0 ? (
        <section className="dashboard-empty">
          <div className="dashboard-empty-icon"><UsersRound size={22} /></div>
          <h3>No circles created yet.</h3>
          <p>Once someone deploys a circle, it shows up here automatically — no membership required to see it.</p>
        </section>
      ) : (
        <div className="circle-list">
          {cards.map((card) => (
            <article className="circle-card" key={card.address}>
              <div className={`circle-card-art ${stageTone(card)}`}>
                <span>{card.address.slice(2, 4).toUpperCase()}</span><i /><i /><i />
              </div>
              <div className="circle-card-main">
                <div>
                  <span className={`circle-stage ${stageTone(card)}`}><i /> {stageLabel(card)}</span>
                  <h2>{shortAddress(card.address)}</h2>
                  <p><UsersRound size={15} /> {String(card.memberCount)} of {String(card.targetMemberCount)} members</p>
                </div>
                <div className="circle-card-pot">
                  <small>PER ROUND</small>
                  <strong>{formatUnits(card.contributionAmount, 6)} USDC</strong>
                  <span><Clock3 size={13} /> {payoutLabel(card)}</span>
                </div>
              </div>
              <Link href={`/circle/${card.address}`} className="circle-go"><span>View circle</span><ArrowRight size={17} /></Link>
            </article>
          ))}
        </div>
      )}

      <section className="section-card members-card" style={{ marginTop: 24 }}>
        <div className="section-heading">
          <div>
            <h3>Recent automation</h3>
            <p>Every payout, deposit draw, and completion below was triggered by a named KeeperHub workflow — not a person clicking a button.</p>
          </div>
        </div>
        {isLoadingAutomation ? (
          <p className="date-divider">READING WORKFLOW EXECUTIONS FROM THE CHAIN…</p>
        ) : automationEntries.length === 0 ? (
          <p className="date-divider">No automated actions yet — they'll show up here the moment a workflow fires.</p>
        ) : (
          automationEntries.map((entry) => <AutomationItem key={entry.key} entry={entry} />)
        )}
      </section>
    </AppShell>
  );
}

function AutomationItem({ entry }: { entry: AutomationEntry }) {
  const router = useRouter();
  const Icon = automationIcon[entry.kind];
  const go = () => router.push(`/circle/${entry.circleAddress}`);

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
      <div className={`activity-icon ${entry.kind === "Default uncovered" ? "coral" : "teal"}`}><Icon size={18} /></div>
      <div className="activity-copy">
        <span>{entry.kind}</span>
        <h3>{entry.title}</h3>
        <p>{entry.copy}</p>
        <span className="workflow-status"><i /> {entry.workflow}</span>
      </div>
      <div className="activity-meta">
        <time>{formatWhen(entry.timestamp)}</time>
        <a href={`https://sepolia.basescan.org/tx/${entry.hash}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          <button type="button">{entry.hash.slice(0, 6)}…{entry.hash.slice(-4)}<ArrowUpRight size={13} /></button>
        </a>
      </div>
    </article>
  );
}
