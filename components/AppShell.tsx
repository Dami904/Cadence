"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import {
  Droplets,
  Grid2X2,
  History,
  Menu,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { useDepositHealth } from "../lib/useDepositHealth";
import { useGasDripOnboarding } from "../lib/useGasDripOnboarding";
import { WalletIdentity } from "./WalletIdentity";

const items = [
  { label: "Overview", href: "/dashboard", icon: Grid2X2 },
  { label: "My circles", href: "/circles", icon: UsersRound },
  { label: "Activity", href: "/activity", icon: History },
  { label: "Trust score", href: "/trust-score", icon: ShieldCheck },
  { label: "Faucet", href: "/faucet", icon: Droplets },
];

export function AppShell({ active, title, children }: { active: string; title: string; children: ReactNode }) {
  const [showMobileNav, setShowMobileNav] = useState(false);

  return (
    <main className="product-shell">
      <aside className={`sidebar ${showMobileNav ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <Link href="/welcome" className="brand-link" onClick={() => setShowMobileNav(false)}>
            <div className="brand-mark"><span>c</span></div>
            <span className="brand-name">cadence</span>
          </Link>
          <button className="mobile-close" onClick={() => setShowMobileNav(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        <nav className="main-nav">
          <p className="nav-label">WORKSPACE</p>
          {items.map(({ label, href, icon: Icon }) => (
            <Link key={label} href={href} onClick={() => setShowMobileNav(false)} className={`nav-item ${active === label ? "active" : ""}`}>
              <Icon size={18} strokeWidth={active === label ? 2.3 : 1.9} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/settings" onClick={() => setShowMobileNav(false)} className={`nav-item ${active === "Settings" ? "active" : ""}`}><Settings size={18} /><span>Settings</span></Link>
          <DepositHealthBadge />
          <WalletIdentity placement="sidebar" />
          <p className="keeperhub-credit">Automation by <b>KeeperHub</b></p>
        </div>
      </aside>
      <div className="dashboard-wrap">
        <header className="topbar">
          <button className="menu-button" onClick={() => setShowMobileNav(true)} aria-label="Open navigation"><Menu size={22} /></button>
          <div className="crumb"><span>Cadence</span><span className="crumb-divider">/</span><strong>{title}</strong></div>
          <div className="top-actions"><WalletIdentity placement="header" /></div>
        </header>
        <WrongNetworkBanner />
        <GasDripBanner />
        <div className="route-content">{children}</div>
      </div>
    </main>
  );
}

function WrongNetworkBanner() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  if (!isConnected || chainId === baseSepolia.id) return null;

  return (
    <div className="stall-banner" style={{ margin: "0 34px", marginTop: 16 }}>
      <ShieldAlert size={19} />
      <div>
        <b>Wrong network.</b>
        <p>Your wallet is connected to a different chain — Cadence runs on Base Sepolia, so contract actions here won&apos;t work until you switch.</p>
      </div>
      <button className="outline-button" onClick={() => switchChain({ chainId: baseSepolia.id })} disabled={isPending} type="button">
        {isPending ? "Switching…" : "Switch to Base Sepolia"}
      </button>
    </div>
  );
}

function GasDripBanner() {
  const status = useGasDripOnboarding();
  const [dismissed, setDismissed] = useState(false);
  if (status !== "sent" || dismissed) return null;

  return (
    <div className="stall-banner" style={{ margin: "0 34px", marginTop: 16, background: "#eff8f5", borderColor: "#bfe0d3", color: "#136b58" }}>
      <ShieldCheck size={19} />
      <div>
        <b>You&apos;re set — sent you a little Base Sepolia ETH.</b>
        <p>Enough to cover a handful of USDC approvals, the one step Cadence can&apos;t sponsor for you. This only happens once.</p>
      </div>
      <button className="outline-button" onClick={() => setDismissed(true)} type="button">Dismiss</button>
    </div>
  );
}

function DepositHealthBadge() {
  const { isLoading, hasCircles, atRiskCount } = useDepositHealth();
  if (isLoading || !hasCircles) return null;

  return (
    <div className={`deposit-health ${atRiskCount > 0 ? "at-risk" : "covered"}`}>
      {atRiskCount > 0 ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
      <span>{atRiskCount > 0 ? `${atRiskCount} deposit${atRiskCount === 1 ? "" : "s"} at risk` : "Deposits covered"}</span>
    </div>
  );
}
