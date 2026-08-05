"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Grid2X2,
  History,
  Menu,
  Settings,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { WalletIdentity } from "./WalletIdentity";

const items = [
  { label: "Overview", href: "/dashboard", icon: Grid2X2 },
  { label: "My circles", href: "/circles", icon: UsersRound },
  { label: "Activity", href: "/activity", icon: History },
  { label: "Trust score", href: "/trust-score", icon: ShieldCheck },
];

export function AppShell({ active, title, children }: { active: string; title: string; children: ReactNode }) {
  const [showMobileNav, setShowMobileNav] = useState(false);

  return (
    <main className="product-shell">
      <aside className={`sidebar ${showMobileNav ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <Link href="/dashboard" className="brand-link" onClick={() => setShowMobileNav(false)}>
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
        <div className="route-content">{children}</div>
      </div>
    </main>
  );
}
