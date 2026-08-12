"use client";
import { useEffect, useState } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { AppShell } from "../../components/AppShell";
import { Bell, Check, Copy, ExternalLink, ShieldCheck, WalletCards } from "lucide-react";

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

export default function SettingsPage() {
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [copied, setCopied] = useState(false);
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true);
  const [reminderSaveError, setReminderSaveError] = useState(false);
  const [email, setEmail] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setSaveState("loading");
    (async () => {
      try {
        // Proves wallet control before the server hands back anything tied to this address —
        // otherwise anyone could read another member's stored email just by knowing their wallet.
        const timestamp = Date.now();
        const message = `Cadence settings read\naddress: ${address}\ntimestamp: ${timestamp}`;
        const signature = await signMessageAsync({ message });
        if (cancelled) return;
        const res = await fetch(`/api/member-email?address=${address}&timestamp=${timestamp}&signature=${signature}`);
        const data = await res.json();
        if (cancelled) return;
        setEmail(data.email ?? "");
        setEmailRemindersEnabled(data.emailRemindersEnabled ?? true);
        setSaveState("idle");
      } catch {
        if (!cancelled) setSaveState("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, signMessageAsync]);

  const persist = async (nextEmail: string, nextRemindersEnabled: boolean) => {
    if (!address) return;
    const timestamp = Date.now();
    // The signed message binds the exact values being saved, so a captured signature can never
    // be replayed to write something the owner didn't actually approve.
    const message = `Cadence settings update\naddress: ${address}\nemail: ${nextEmail || "(none)"}\nemailRemindersEnabled: ${nextRemindersEnabled}\ntimestamp: ${timestamp}`;
    const signature = await signMessageAsync({ message });
    const res = await fetch("/api/member-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, email: nextEmail, emailRemindersEnabled: nextRemindersEnabled, signature, timestamp }),
    });
    if (!res.ok) throw new Error("save failed");
  };

  const saveEmail = async () => {
    if (!address) return;
    setSaveState("saving");
    try {
      await persist(email, emailRemindersEnabled);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1600);
    } catch {
      setSaveState("error");
    }
  };

  const toggleEmailReminders = async () => {
    if (!address) return;
    const next = !emailRemindersEnabled;
    setEmailRemindersEnabled(next);
    setReminderSaveError(false);
    try {
      await persist(email, next);
    } catch {
      setEmailRemindersEnabled(!next);
      setReminderSaveError(true);
    }
  };

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <AppShell active="Settings" title="Settings">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">ACCOUNT</p>
          <h1>Settings</h1>
          <p>Manage your profile, connected wallet, and notification preferences.</p>
        </div>
      </div>
      <div className="settings-layout">
        <div className="settings-panels">
          <section className="settings-panel">
            <div className="settings-panel-heading">
              <div>
                <h2>Profile</h2>
                <p>Used for contribution reminders from your circles.</p>
              </div>
              <div className="profile-large">{address ? address.slice(2, 4).toUpperCase() : "—"}</div>
            </div>
            <div className="form-grid">
              <label>
                Email address
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  placeholder="you@example.com"
                  disabled={!isConnected}
                />
              </label>
            </div>
            {!isConnected && <p className="form-error">Connect a wallet to save an email for reminders.</p>}
            {saveState === "error" && <p className="form-error">Couldn&apos;t save. Try again.</p>}
            <button className="solid-button" onClick={saveEmail} disabled={!isConnected || saveState === "saving" || saveState === "loading"}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save changes"} <Check size={16} />
            </button>
          </section>
          <section className="settings-panel">
            <div className="settings-panel-heading">
              <div>
                <h2>Connected wallet</h2>
                <p>This address is used to join circles and receive payouts.</p>
              </div>
              <WalletCards size={21} />
            </div>
            <div className="wallet-row">
              <div>
                <b>{isConnected && address ? shortAddress(address) : "Not connected"}</b>
                <span>{isConnected ? (chain?.name ?? "Unsupported network") : "Connect a wallet"}</span>
              </div>
              <button onClick={copyAddress} disabled={!address}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}</button>
              <button onClick={() => disconnect()} disabled={!isConnected}>Disconnect</button>
            </div>
            {address && (
              <a className="external-profile" href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> View on block explorer
              </a>
            )}
          </section>
          <section className="settings-panel">
            <div className="settings-panel-heading">
              <div>
                <h2>Notifications</h2>
                <p>Never miss a contribution deadline or payout.</p>
              </div>
              <Bell size={21} />
            </div>
            <div className="toggle-row">
              <div><b>Email reminders</b><span>Contribution due dates and payouts</span></div>
              <button aria-label="Toggle email reminders" onClick={toggleEmailReminders} disabled={!isConnected} className={`toggle ${emailRemindersEnabled ? "on" : ""}`}><i /></button>
            </div>
            {reminderSaveError && <p className="form-error">Couldn&apos;t save that preference. Try again.</p>}
          </section>
          <div className="settings-protection">
            <ShieldCheck size={20} />
            <p><b>Your circle terms are never editable here.</b> Once a circle starts, its rotation and contribution terms are immutable by design.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
