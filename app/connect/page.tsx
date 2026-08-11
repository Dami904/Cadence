"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { Check, Wallet } from "lucide-react";

export default function ConnectPage() {
  const { isConnected } = useAccount();
  const router = useRouter();

  useEffect(() => {
    if (isConnected) router.push("/dashboard");
  }, [isConnected, router]);

  return (
    <main className="connect-page">
      <div className="connect-side">
        <Link href="/welcome" className="brand-row brand-link"><div className="brand-mark"><span>c</span></div><span className="brand-name">cadence</span></Link>
        <div className="connect-quote">
          <span>WELCOME TO THE CIRCLE</span>
          <h1>More certainty.<br /><i>More together.</i></h1>
          <p>Join a savings rhythm built on visibility, not blind trust.</p>
          <div><Check size={16} /> Your funds are never held by Cadence</div>
          <div><Check size={16} /> Every payout has an onchain trace</div>
        </div>
        <small>© 2026 Cadence</small>
      </div>
      <section className="connect-panel">
        <div className="connect-card">
          <div className="connect-icon"><Wallet size={27} /></div>
          <p className="eyebrow">LET&apos;S GET YOU IN</p>
          <h2>Connect your wallet</h2>
          <p>Connect to create a circle, join one, or see your savings rhythm.</p>
          <div className="connect-live"><ConnectButton /></div>

          <small>By continuing, you agree to Cadence&apos;s terms and privacy policy.</small>
        </div>
      </section>
    </main>
  );
}
