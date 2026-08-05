"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { AppShell } from "../../components/AppShell";
import { OnchainConnection } from "../../components/OnchainConnection";
import { CircleDashboard } from "../../components/CircleDashboard";
import { useCadenceCircles } from "../../lib/useCadenceCircles";
import { ArrowRight, CirclePlus, Sparkles } from "lucide-react";

export default function DashboardPage() {
  const [selectedCircle, setSelectedCircle] = useState<Address | null>(null);
  const { isLoading, myCircles } = useCadenceCircles();

  const activeCircle = selectedCircle ?? myCircles[0]?.address ?? null;

  return (
    <AppShell active="Overview" title="Overview">
      <OnchainConnection />

      {isLoading ? (
        <section className="dashboard-empty">
          <div className="dashboard-empty-icon"><Sparkles size={22} /></div>
          <h3>Reading your circles from Base Sepolia…</h3>
          <p>Checking the circle registry for circles you belong to.</p>
        </section>
      ) : myCircles.length === 0 ? (
        <section className="dashboard-empty">
          <div className="dashboard-empty-icon"><Sparkles size={22} /></div>
          <h3>No circles yet.</h3>
          <p>Create a circle for the people you save with, or join one you&apos;ve been invited to.</p>
          <div className="heading-actions">
            <Link href="/join" className="outline-button"><ArrowRight size={16} /> Join with an address</Link>
            <Link href="/create" className="solid-button"><CirclePlus size={17} /> Create a circle</Link>
          </div>
        </section>
      ) : (
        <>
          {myCircles.length > 1 && (
            <div className="circle-switcher">
              {myCircles.map((circle) => (
                <button
                  key={circle.address}
                  className={activeCircle === circle.address ? "active" : ""}
                  onClick={() => setSelectedCircle(circle.address)}
                >
                  {circle.address.slice(0, 6)}…{circle.address.slice(-4)}
                </button>
              ))}
            </div>
          )}
          {activeCircle && <CircleDashboard circleAddress={activeCircle} />}
        </>
      )}

      <section className="join-banner">
        <div className="join-orbit orbit-one" /><div className="join-orbit orbit-two" />
        <div><span>BUILD A RHYTHM THAT LASTS</span><h3>Ready for your next circle?</h3><p>Create a savings circle with the people you trust.</p></div>
        <Link href="/create" className="light-button">Create a circle <ArrowRight size={17} /></Link>
      </section>
    </AppShell>
  );
}
