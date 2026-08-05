"use client";

import { useParams } from "next/navigation";
import { isAddress } from "viem";
import { LockKeyhole } from "lucide-react";
import { AppShell } from "../../../components/AppShell";
import { CircleDashboard } from "../../../components/CircleDashboard";

export default function CircleDetailPage() {
  const params = useParams<{ address: string }>();
  const address = params.address;

  if (!address || !isAddress(address)) {
    return (
      <AppShell active="My circles" title="Circle">
        <section className="dashboard-empty">
          <div className="dashboard-empty-icon"><LockKeyhole size={22} /></div>
          <h3>Invalid circle address.</h3>
          <p>Check the link and try again.</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell active="My circles" title="Circle dashboard">
      <CircleDashboard circleAddress={address} />
    </AppShell>
  );
}
