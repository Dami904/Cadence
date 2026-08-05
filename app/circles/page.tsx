"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { ArrowRight, CirclePlus, Clock3, Plus, Sparkles, UsersRound } from "lucide-react";
import { AppShell } from "../../components/AppShell";
import { CircleStatus } from "../../lib/contracts";
import { useCadenceCircles } from "../../lib/useCadenceCircles";
import { useCircleCards, type CircleCard } from "../../lib/useCircleCards";

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

function stageLabel(card: CircleCard) {
  if (card.status === CircleStatus.Forming) return `Forming · ${String(card.memberCount)} of ${String(card.targetMemberCount)} joined`;
  if (card.status === CircleStatus.Completed) return "Completed";
  return `Active · Round ${String(card.currentRound)} of ${String(card.targetMemberCount)}`;
}

function payoutLabel(card: CircleCard) {
  if (card.status === CircleStatus.Forming) return "Starts when full";
  if (card.status === CircleStatus.Completed) return "Circle complete";
  return new Date(Number(card.currentRoundDeadline) * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function CirclesPage() {
  const { isLoading: isLoadingCircles, myCircles } = useCadenceCircles();
  const addresses = myCircles.map((circle) => circle.address);
  const { cards, isLoading: isLoadingCards } = useCircleCards(addresses);
  const isLoading = isLoadingCircles || (addresses.length > 0 && isLoadingCards);

  const activeCount = cards.filter((card) => card.status === CircleStatus.Active).length;
  const memberTotal = cards.reduce((sum, card) => sum + card.memberCount, 0n);

  return (
    <AppShell active="My circles" title="My circles">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR SAVINGS RHYTHMS</p>
          <h1>My circles</h1>
          <p>See every savings circle you&apos;re part of, in one place.</p>
        </div>
        <div className="heading-actions">
          <Link href="/join" className="outline-button"><Plus size={16} /> Join with address</Link>
          <Link href="/create" className="solid-button"><CirclePlus size={17} /> Create circle</Link>
        </div>
      </div>

      {!isLoading && cards.length > 0 && (
        <div className="circle-summary">
          <div><span>TOTAL CIRCLES</span><strong>{cards.length}</strong><small>You&apos;re a member of {cards.length}</small></div>
          <div><span>ACTIVE ROUNDS</span><strong>{activeCount}</strong><small>Currently in progress</small></div>
          <div><span>MEMBERS TOGETHER</span><strong>{String(memberTotal)}</strong><small>Across all your circles</small></div>
        </div>
      )}

      {isLoading ? (
        <section className="dashboard-empty">
          <div className="dashboard-empty-icon"><Sparkles size={22} /></div>
          <h3>Reading your circles from Base Sepolia…</h3>
          <p>Checking the circle registry for circles you belong to.</p>
        </section>
      ) : cards.length === 0 ? (
        <section className="dashboard-empty">
          <div className="dashboard-empty-icon"><UsersRound size={22} /></div>
          <h3>No circles yet.</h3>
          <p>Create a circle for the people you save with, or join one you&apos;ve been invited to.</p>
          <div className="heading-actions">
            <Link href="/join" className="outline-button"><ArrowRight size={16} /> Join with address</Link>
            <Link href="/create" className="solid-button"><CirclePlus size={17} /> Create circle</Link>
          </div>
        </section>
      ) : (
        <div className="circle-list">
          {cards.map((card, index) => (
            <article className="circle-card" key={card.address}>
              <div className={`circle-card-art ${index % 2 === 0 ? "teal" : "coral"}`}>
                <span>{card.address.slice(2, 4).toUpperCase()}</span><i /><i /><i />
              </div>
              <div className="circle-card-main">
                <div>
                  <span className={`circle-stage ${index % 2 === 0 ? "teal" : "coral"}`}><i /> {stageLabel(card)}</span>
                  <h2>{shortAddress(card.address)}</h2>
                  <p><UsersRound size={15} /> {String(card.memberCount)} of {String(card.targetMemberCount)} members</p>
                </div>
                <div className="circle-card-pot">
                  <small>PER ROUND</small>
                  <strong>{formatUnits(card.contributionAmount, 6)} USDC</strong>
                  <span><Clock3 size={13} /> {payoutLabel(card)}</span>
                </div>
              </div>
              <Link href={`/circle/${card.address}`} className="circle-go"><span>Open circle</span><ArrowRight size={17} /></Link>
            </article>
          ))}
        </div>
      )}

      <section className="empty-invite">
        <div className="empty-invite-icon"><UsersRound size={23} /></div>
        <div>
          <h3>Have a circle invite?</h3>
          <p>Enter the invite address from a friend to join their savings rhythm.</p>
        </div>
        <Link href="/join" className="outline-button">Join a circle <ArrowRight size={15} /></Link>
      </section>
    </AppShell>
  );
}
