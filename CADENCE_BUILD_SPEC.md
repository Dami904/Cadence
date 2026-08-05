# Cadence — Build Specification

**Read this whole document before writing any code.** This is the single source of
truth for what to build, in what order, and why. If anything here conflicts with
a later ad-hoc instruction, ask before assuming the later instruction wins —
some constraints below are deliberate and non-obvious.

---

## 1. What Cadence is

Cadence is an onchain rotating savings circle (the mechanism known worldwide as
Ajo, Esusu, Chama, Stokvel, Tanda, Tontine, Susu — same idea, different names).
A fixed group of members contributes the same amount every round; the full pot
goes to one member per round, in a locked order, until everyone has had a turn.

**The differentiator, and the thing every design decision below protects:**
every autonomous action in the system — payouts, default handling, reputation
updates — is executed by an independently-inspectable KeeperHub workflow, not
an opaque backend "agent." A user or judge should be able to point at any
automated action and trace it to the specific trigger that fired it. This is
the whole pitch. Do not build anything that makes the automation less
transparent or less attributable to a specific, nameable workflow.

**Real problem this solves:** informal Ajo groups run on trust in a human
organizer. When that organizer defaults or absconds, the group loses
everything, with no recourse. Cadence removes the organizer entirely — no
human ever holds custody of the pot, and no human ever has to remember to
execute a payout.

**Built for a global audience.** Do not localize the product name, copy, or UX
around any single country or culture. The mechanism is universal; say so.

### 1.1 Lessons explicitly carried over from AjoAI (a live competitor)

AjoAI (a rotating-savings-circle product on Celo/MiniPay) was studied during
design. These six decisions are directly traceable to that research — the
agent should treat them as settled, not as open design space:

1. Security deposit for default handling, not branching delay/redistribute/
   skip logic (see §2.2).
2. Rotation order locked immutably at circle start, no exceptions (see §2.1).
3. Idle pot funds stay idle — no yield/lending on funds between rounds
   (see §2.3).
4. Reputation built on the real ERC-8004 standard, not a bespoke score
   (see §2.4).
5. Gas must be abstracted away from the end user (see §2.5).
6. Naming and positioning cover the whole regional family (Ajo, Esusu,
   Chama, Stokvel, Tanda, Tontine, Susu) rather than one country — already
   reflected in §1's opening description and should carry through all UI
   copy and marketing text the agent writes.

The one place Cadence must differ from AjoAI, explicitly: AjoAI markets an
opaque "agent" with no stated execution architecture. Cadence's entire pitch
is the opposite — every automated action is a named, inspectable KeeperHub
workflow. Do not write copy that describes Cadence's automation the way
AjoAI describes its agent ("can't be bribed, can't forget") — describe it
concretely (which workflow, which trigger, which transaction).

---

## 2. Non-negotiable design decisions (do not deviate without flagging it)

1. **Rotation order is immutably locked at circle creation.** No admin
   function, owner role, or upgrade path may ever alter it once the circle
   starts. This is the core trust claim — "not even us" — and it must be
   literally true in the contract, not just asserted in the UI.
2. **Default handling is a security deposit, not branching logic.** Each
   member posts a one-round deposit when joining. If a member misses a
   contribution, their deposit covers that round automatically — no delay
   logic, no redistribution logic, no skip logic. One mechanism only. Do not
   reintroduce the delay/redistribute/skip branching we explicitly rejected
   during design — it adds complexity with no benefit over the deposit model.
3. **Idle pot funds stay idle.** Do not integrate any lending/yield protocol
   (Aave, Compound, etc.) for funds sitting between rounds, even though
   KeeperHub has ready-made plugins for this. Yield-seeking reintroduces
   exactly the "your money might not be there" risk the product exists to
   eliminate. Funds sit, unlent, until they move to a payout.
4. **Reputation is ERC-8004, not a bespoke counter.** Use the real
   identity/reputation registry standard so scores are portable across
   circles and, eventually, other apps. Do not invent a custom on-chain
   integer score.
5. **Gas must not be a blocker for non-crypto-native users.** Budget real
   time for gas abstraction (a paymaster, or settling gas from the stablecoin
   pot itself). If this slips, flag it — do not silently ship a version that
   requires members to hold a separate gas token, since that breaks the
   product's actual audience.
6. **KeeperHub is the execution layer for every autonomous action — full
   stop.** Nothing in this system should be triggered by a cron job, a
   serverless function on a timer, or any custom polling worker. If you find
   yourself writing a `setInterval` or a scheduled function anywhere outside
   KeeperHub's own workflow configuration, stop and reconsider — that's
   almost certainly logic that belongs in a KeeperHub workflow instead.

---

## 3. Contract architecture — four contracts, split by "does this directly affect that"

Do not consolidate these into fewer contracts for convenience, and do not
split `AjoCircle` further — the boundaries below were chosen deliberately.

### 3.1 `CircleFactory.sol`
- Deploys new `AjoCircle` instances.
- Maintains a public registry: circle address, member count, status
  (forming / active / completed).
- Has **no knowledge** of contributions, payouts, or deposits. Its only job is
  creating instances and making them discoverable. Do not add convenience
  functions here that read into a circle's internal state.

### 3.2 `AjoCircle.sol` — one instance per circle
This is the only contract where tightly coupled logic belongs together,
because each piece directly gates the next in the same round:
- Membership list + rotation order (write-once at circle start, immutable
  after).
- Per-round contribution tracking: `round → member → contributed (bool)`.
- Per-member security deposit balance, posted at join time.
- `checkAndCoverDefault(round, member)` — reads that round's contribution
  state directly (no cross-contract call) and draws from the member's
  deposit if they missed the round. Callable only by an address authorized
  in `KeeperAuthorization`.
- `executePayout(round)` — reads funding state directly (all contributions
  in, or defaults already covered by deposit draw), transfers the full pot
  to that round's member, emits `PayoutExecuted`. Callable only by an
  address authorized in `KeeperAuthorization`.
- Emits events for every state transition: `MemberJoined`, `ContributionMade`,
  `DefaultCovered`, `PayoutExecuted`, `CircleCompleted`. Every downstream
  system (reminders, reputation, dashboards) reads from these events —
  do not skip emitting any of them.

### 3.3 `TrustScoreRegistry.sol` — global, ERC-8004-based
- Completely separate contract, referenced by every circle instance, not
  owned by any one of them.
- Only records **outcomes**: `recordCompletion(member)`,
  `recordDefault(member)`.
- Has zero knowledge of rotation order, deposits, or round timing — it only
  reacts to events emitted by `AjoCircle` instances. This separation is what
  makes the score portable across circles (and, later, across apps).

### 3.4 `KeeperAuthorization.sol` — global access control
- A small registry naming which address(es) — your KeeperHub-managed
  wallet(s) — may call `checkAndCoverDefault` and `executePayout` on **any**
  circle instance.
- Deliberately separate from `AjoCircle` so that rotating or revoking
  KeeperHub's authorization never requires touching individual circles.
- This is a security boundary, not a mechanics contract — keep it minimal.

---

## 4. KeeperHub workflows — exactly four, each independently demoable

**Note on the count:** earlier design passes on this project landed on six
workflows (payout, deadline enforcement, default handling, cycle-restart,
reminders, funding check). Adopting the AjoAI-derived security-deposit model
in §2.2 genuinely eliminated two of those, rather than just merging them for
convenience: deadline-enforcement and default-handling collapsed into the
single deposit-draw workflow below, and the funding check is now implicit in
`executePayout` reading contribution/deposit state directly, so it no longer
needs its own workflow. Four is the correct, current count — do not
resurrect the other two.

Do not add workflows beyond these four unless there's spare time at the very
end — a smaller set that's fully working beats a larger set that's half-wired.

1. **Payout execution** — schedule-trigger on each round's payout date, calls
   `AjoCircle.executePayout(round)`.
2. **Default detection + deposit draw** — schedule-trigger shortly before
   each round's deadline, calls `AjoCircle.checkAndCoverDefault(round,
   member)` for any member who hasn't contributed yet.
3. **Cycle completion → reputation update** — blockchain-event trigger on
   `CircleCompleted`, calls `TrustScoreRegistry.recordCompletion(member)` for
   every member in that circle.
4. **Pre-contribution reminders** — schedule-trigger a day or two before each
   round's deadline, reads contribution state, sends a Notification action
   (Discord/Telegram/SendGrid) to any member who hasn't contributed yet.
   This workflow never writes to the contract — read-and-notify only.

For each workflow, when you build it, be able to show: the exact trigger
condition, the exact contract call it makes, and a real transaction hash it
produced on testnet. That traceability is the entire point — don't treat it
as an afterthought for the demo.

---

## 5. What NOT to build

- No Send, Split, or Leash-equivalent features. Those are single-shot or
  custody-preserving mechanics with no unattended-execution need — they were
  considered and deliberately dropped. Do not add a "quick payment" or
  "group bill" feature; it dilutes the product and adds surface area with no
  KeeperHub relevance.
- No custom indexer or polling worker. Read live contract state directly
  from the frontend, or let KeeperHub's own event triggers write anything
  that needs to be queried later.
- No yield/lending integration on idle funds (see §2.3).
- No delay/redistribute/skip branching for defaults (see §2.2).
- No admin override capability on rotation order, under any framing,
  including "emergency" powers. If a genuine emergency-recovery need comes
  up, flag it for discussion rather than adding a backdoor unilaterally.

---

## 6. Tech stack

- **Contracts:** Solidity, Hardhat or Foundry (agent's choice), deployed and
  verified on a public EVM testnet (Arbitrum Sepolia or Base Sepolia —
  cheap, fast, well-documented for KeeperHub compatibility).
- **Frontend:** Next.js + wagmi + RainbowKit for wallet connection. Keep it
  minimal: connect wallet, create/join a circle, view circle dashboard
  (members, current round, contribution status, next payout date), view
  personal Trust Score.
- **No Postgres/Supabase layer unless a genuine need emerges** — prefer
  direct on-chain reads (`useReadContract`) for anything the contract already
  exposes.

---

## 7. Build order

1. `KeeperAuthorization.sol` and `TrustScoreRegistry.sol` first — small,
   independent, unblock nothing else but need to exist before `AjoCircle`
   references them.
2. `AjoCircle.sol` — the core contract. Write full tests before moving on:
   join flow, rotation lock, contribution tracking, deposit draw on default,
   payout execution, event emission for every transition.
3. `CircleFactory.sol` — thin wrapper once `AjoCircle` is stable.
4. Deploy all four to testnet, verify on the block explorer.
5. KeeperHub workflows #1 and #2 together (payout depends on default-check
   having run first for that round).
6. KeeperHub workflow #3 (reputation), then #4 (reminders) — both fully
   independent of each other and of #1/#2, safe to do last.
7. Frontend last, once the contracts and workflows are real and callable —
   the frontend should be reading genuine on-chain state from day one of its
   own development, not mocked data.

---

## 8. Demo script (for whoever presents this)

Show, in order: (a) a circle with a locked rotation order and a live
dashboard, (b) a real testnet transaction where a KeeperHub workflow — named
on screen — executed a payout with no human clicking anything, (c) a
simulated missed contribution where a different, named KeeperHub workflow
drew from the defaulting member's deposit and the payout still shipped on
time, (d) the Trust Score updating after a circle completes. Every
"automatic" moment in the demo should have a KeeperHub workflow name attached
to it on screen — that traceability is the differentiator, say it out loud.

---

## 9. Reference materials the agent must consult before building workflows

This document describes *what* each KeeperHub workflow should do. It does
not, and cannot, tell you the exact node types, trigger configuration
syntax, or API/SDK calls KeeperHub actually expects — that lives in their
own documentation and changes independently of this spec. Before
implementing any workflow in §4, read:

- **KeeperHub docs:** https://docs.keeperhub.com/ — trigger types (Schedule,
  Blockchain Event, Webhook, Block Interval), action types (Web3,
  Notifications, System, Math), and condition-node syntax all live here.
  Confirm the current parameter names and node schema against this source
  rather than assuming the shape described in §4 above is the literal API.
- **KeeperHub app (where workflows are actually built/deployed):**
  https://app.keeperhub.com/
- **Programmatic access (MCP/REST), if building or calling workflows from
  code rather than the visual editor:** check the docs site above for the
  current MCP server details and REST endpoint reference — there is a
  Claude plugin path (`/plugin marketplace add KeeperHub/claude-plugins`)
  worth checking if the agent itself is Claude Code.
- **Hackathon rules and submission requirements:**
  https://dorahacks.io/hackathon/agents-onchain/detail — re-check this
  before finalizing the demo video and submission, since exact requirements
  (e.g. what counts as a valid "executed transaction" link) should be
  confirmed there directly rather than assumed from this spec.

If any KeeperHub node type or capability this spec assumes (e.g. a
Block-Interval trigger firing on a specific contract's event) turns out not
to exist or work differently than described, flag it back rather than
silently substituting a workaround — the workaround might break the
"transparent, inspectable workflow" pitch that's the whole point of §1.

---

## 10. Open questions to flag back, not resolve silently

- Exact deposit size as a fraction of one round's contribution (needs a
  number — don't invent one without flagging it).
- Whether circles support variable member counts or a fixed set of sizes.
- Which testnet stablecoin (or mock ERC-20) to use for contributions.

If any of these block progress, ask rather than guessing and moving on.
