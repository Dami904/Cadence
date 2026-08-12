"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseEventLogs, parseUnits, type Address } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { ArrowRight, Check, Copy } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cadenceContracts, circleFactoryAbi } from "@/lib/contracts";
import { formatWriteError } from "@/lib/formatError";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";

const steps = ["Circle basics", "Contribution terms", "Review & deploy"];

function defaultFirstPayoutDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export default function CreateCirclePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [name, setName] = useState("Sunday Circle");
  const [members, setMembers] = useState("6");
  const [amount, setAmount] = useState("20");
  const [cadence, setCadence] = useState("weekly");
  const [firstPayout, setFirstPayout] = useState(defaultFirstPayoutDate);
  const [createdCircle, setCreatedCircle] = useState<Address | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const { address, isConnected } = useAccount();
  const { write, logs, error, isPending, isConfirming, isSuccess, reset: resetWrite, notice } = useSponsoredWrite();
  const { signMessageAsync } = useSignMessage();
  const [nameSaveError, setNameSaveError] = useState(false);

  const cadenceSeconds = cadence === "weekly" ? 7 * 24 * 60 * 60 : 30 * 24 * 60 * 60;
  const payoutTimestamp = useMemo(
    () => Math.floor(new Date(firstPayout + "T12:00:00Z").getTime() / 1000),
    [firstPayout],
  );
  const membersCount = Number(members);
  const contributionAmount = Number(amount);
  const payoutInPast = payoutTimestamp * 1000 <= Date.now();
  const invalidMembers = !Number.isInteger(membersCount) || membersCount < 2;
  const invalidAmount = !(contributionAmount > 0);
  const configurationError = invalidMembers
    ? "A circle needs at least 2 members."
    : invalidAmount
      ? "Contribution amount must be greater than 0."
      : payoutInPast
        ? "First payout date must be in the future."
        : null;

  const createCircle = () => {
    if (!isConnected || !address || !cadenceContracts.isConfigured || configurationError) return;

    // Deposit floor is 2x the contribution (contract-enforced) so a member's security deposit
    // survives more than one consecutive default before another member has to step in and cover it.
    const contributionAmountWei = parseUnits(amount, 6);
    // A circle that never fills gets 30 days before anyone can cancelIfExpired() it and members
    // pull their deposits back — no configurable field for this yet, just a fixed, generous window.
    const formingDeadline = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    write({
      address: cadenceContracts.circleFactory,
      abi: circleFactoryAbi,
      functionName: "createCircle",
      args: [
        cadenceContracts.usdc,
        contributionAmountWei,
        contributionAmountWei * 2n,
        BigInt(members),
        BigInt(cadenceSeconds),
        BigInt(payoutTimestamp),
        BigInt(formingDeadline),
      ],
    });
  };

  useEffect(() => {
    if (!logs) return;
    const createdEvent = parseEventLogs({
      abi: circleFactoryAbi,
      eventName: "CircleCreated",
      logs,
    })[0];
    if (createdEvent?.args.circle) setCreatedCircle(createdEvent.args.circle);
  }, [logs]);

  useEffect(() => {
    if (!createdCircle || !address) return;
    let cancelled = false;
    setNameSaveError(false);
    (async () => {
      try {
        // Signed off-chain, not part of the createCircle() transaction — createCircle() has no
        // name parameter, so this is the only place the name entered in step 1 ever gets saved.
        const timestamp = Date.now();
        const message = `Cadence circle name update\ncircle: ${createdCircle}\nname: ${name}\ntimestamp: ${timestamp}`;
        const signature = await signMessageAsync({ message });
        if (cancelled) return;
        const res = await fetch("/api/circle-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ circleAddress: createdCircle, address, name, signature, timestamp }),
        });
        if (!res.ok && !cancelled) setNameSaveError(true);
      } catch {
        if (!cancelled) setNameSaveError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-runs when a new circle is actually created — not on every keystroke in `name`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdCircle]);

  const resetForAnotherCircle = () => {
    setCreatedCircle(null);
    setNameSaveError(false);
    resetWrite();
    setCurrentStep(1);
  };

  const inviteLink = createdCircle && typeof window !== "undefined" ? `${window.location.origin}/join?address=${createdCircle}` : "";

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      // Clipboard API can fail silently (permissions, insecure context); the
      // link is also shown in a selectable field so it can be copied by hand.
    }
  };

  return (
    <AppShell active="My circles" title="Create a circle">
      <div className="page-grid create-layout">
        <section className="content-card create-card">
          <div className="stepper" aria-label="Create circle progress">
            {steps.map((step, index) => {
              const stepNumber = index + 1;
              return (
                <button
                  className={["step", currentStep === stepNumber && "active", currentStep > stepNumber && "complete"].filter(Boolean).join(" ")}
                  key={step}
                  onClick={() => setCurrentStep(stepNumber)}
                  type="button"
                >
                  <span>{stepNumber}</span>
                  {step}
                </button>
              );
            })}
          </div>

          {currentStep === 1 && (
            <div className="form-stack">
              <div>
                <p className="section-kicker">The circle</p>
                <h2>Set the shared agreement.</h2>
                <p className="muted">Everyone sees the same terms before joining. They cannot be changed after deployment.</p>
              </div>
              <label>
                Circle name
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label>
                Maximum members
                <input min="2" max="24" type="number" value={members} onChange={(event) => setMembers(event.target.value)} />
              </label>
              <div className="button-row">
                <button className="button button-primary" onClick={() => setCurrentStep(2)} type="button">Continue</button>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="form-stack">
              <div>
                <p className="section-kicker">Terms</p>
                <h2>Define the rhythm.</h2>
                <p className="muted">Each member posts a security deposit worth two contributions up front, then contributes this amount each round.</p>
              </div>
              <label>
                Contribution per round (USDC)
                <input min="1" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label>
                Contribution cadence
                <select value={cadence} onChange={(event) => setCadence(event.target.value)}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label>
                First payout date
                <input type="date" min={todayDateString()} value={firstPayout} onChange={(event) => setFirstPayout(event.target.value)} />
              </label>
              <div className="button-row">
                <button className="button button-quiet" onClick={() => setCurrentStep(1)} type="button">Back</button>
                <button className="button button-primary" onClick={() => setCurrentStep(3)} type="button">Review terms</button>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="form-stack">
              <div>
                <p className="section-kicker">Ready to deploy</p>
                <h2>One final check.</h2>
                <p className="muted">After deployment, every participant — including the creator — joins with a {Number(amount) * 2} USDC security deposit.</p>
              </div>
              <div className="review-list">
                <div><span>Name</span><strong>{name || "Untitled circle"}</strong></div>
                <div><span>Members</span><strong>{members}</strong></div>
                <div><span>Per round</span><strong>{amount} USDC</strong></div>
                <div><span>Security deposit</span><strong>{Number(amount) * 2} USDC</strong></div>
                <div><span>Cadence</span><strong>{cadence}</strong></div>
              </div>
              {!cadenceContracts.isConfigured && <p className="form-error">Add the deployed contract addresses to your environment before creating a circle.</p>}
              {!isConnected && <p className="form-error">Connect the Base Sepolia wallet that will create the circle.</p>}
              {configurationError && <p className="form-error">{configurationError}</p>}
              {error && <p className="form-error">{formatWriteError(error)}</p>}
              {notice && <p className="form-note sponsor-notice">{notice}</p>}
              {isSuccess && (
                <div className="form-success">
                  <p>Circle deployed. You&apos;re not a member yet — join it yourself, or share the invite link.</p>
                  {createdCircle && (
                    <>
                      <p>Circle address: <code>{createdCircle}</code></p>
                      {nameSaveError && <p className="form-note sponsor-notice">Couldn&apos;t save &quot;{name}&quot; as this circle&apos;s display name — it&apos;ll show by address instead. You can rename it later from the circle page.</p>}
                      <div className="invite-link-row">
                        <input readOnly value={inviteLink} onFocus={(event) => event.target.select()} />
                        <button className="button button-quiet" onClick={copyInviteLink} type="button">
                          {linkCopied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
                        </button>
                      </div>
                      <Link href={`/join?address=${createdCircle}`} className="button button-primary wide-button">
                        Join this circle <ArrowRight size={15} />
                      </Link>
                    </>
                  )}
                </div>
              )}
              <div className="button-row">
                {isSuccess ? (
                  <button className="button button-quiet" onClick={resetForAnotherCircle} type="button">Create another circle</button>
                ) : (
                  <>
                    <button className="button button-quiet" onClick={() => setCurrentStep(2)} type="button">Back</button>
                    <button
                      className="button button-primary"
                      disabled={!cadenceContracts.isConfigured || !isConnected || Boolean(configurationError) || isPending || isConfirming}
                      onClick={createCircle}
                      type="button"
                    >
                      {isPending ? "Confirm in wallet…" : isConfirming ? "Deploying…" : "Deploy circle"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="aside-stack">
          <section className="info-card warm">
            <p className="section-kicker">How it works</p>
            <h3>Simple by design.</h3>
            <p>Cadence locks contribution, deposit, member count, and payout order into the onchain agreement.</p>
          </section>
          <section className="info-card">
            <p className="section-kicker">Before you deploy</p>
            <ul className="check-list">
              <li>Agree on all members and payout order.</li>
              <li>Ensure each member has Base Sepolia USDC.</li>
              <li>Keep your wallet ready for the creation transaction.</li>
            </ul>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
