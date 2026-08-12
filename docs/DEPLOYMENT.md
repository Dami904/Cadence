# Cadence Base Sepolia deployment

## Configured network dependencies

- Chain: Base Sepolia (`84532`)
- Circle USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- ERC-8004 Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- Keeper Authorization: `0x37D7fe84C4154Ec4A59d0750a654e97d787A572d`
- Trust Score Registry: `0x2C272F27D278FD09b6Eabe574D5fDA5dE84B8Edf` (redeployed 2026-08-12, adds ERC-2771 gas abstraction to `linkIdentity`/`unlinkIdentity` — see below)
- Cadence Forwarder (ERC-2771): `0xD73Eda898c3DbF6996d409fB2442Dd38f719e608`
- Circle Factory: `0x15503495838757C8753F866AfB0dD61D0E3770B7` (redeployed 2026-08-12, deploy block `45379920` — see below). The forwarder was reused, not redeployed, so existing circles keep trusting the same relayer.

The local `.env` is intentionally ignored. It contains the deployer private key and must never be committed, copied into client-side variables, or shared.

### 2026-08-12 (later) — Deposit-rescue reimbursement, payout DoS fix, redeploy, and a live-tested KeeperHub bug

A second review pass the same day found the deposit-rescue mechanism above was economically broken (a rescuer's funds went back to the *defaulter*, not the rescuer) and the final payout's deposit-return loop could be permanently blocked by one bad token holder. Both fixed by tracking deposit ownership per-slot (`depositOwner`) and replacing the push-loop with a pull-based `withdrawDeposit(member)` — **this replaces `withdrawAfterCancel()` from the note above**, now usable for both `Cancelled` and `Completed` circles. Added `ReentrancyGuard` to every token-moving function, gas-abstracted `TrustScoreRegistry.linkIdentity`/`unlinkIdentity` via ERC-2771, and closed a real IDOR on `/api/member-email` (any address could read or overwrite any other wallet's stored email — now requires a fresh signed message). `CircleFactory` and `TrustScoreRegistry` were redeployed for these fixes (addresses above); `KeeperAuthorization` and the forwarder were untouched.

Redeploying orphaned 6 of the account's 8 KeeperHub workflows — each had the old `CircleFactory`/`TrustScoreRegistry` address hardcoded in its node config, since KeeperHub workflows live outside this repo and don't read `.env`. All 6 were re-pointed and re-validated. Live end-to-end testing on Base Sepolia (real circle, real USDC, real transactions) then confirmed the meta-tx relay, payout execution, and event-triggered reputation update all work correctly against the new contracts — but surfaced a genuine bug in KeeperHub's own execution engine: a `Condition` node nested two `For Each` loops deep never executes, so **`Cadence Default Detection + Deposit Draw` cannot currently act on a real missed contribution** even though it's correctly pointed at the live contracts. Root-caused down to the exact line in KeeperHub's open-source executor (`lib/workflow/executor/executor.workflow.ts` — the nested loop is handed the outer loop's own partial edge map instead of the workflow-global one) and filed at https://github.com/KeeperHub/keeperhub/issues/2049 with repro execution IDs and a suggested one-line fix. Until that lands, a circle with a real missed contribution will not auto-recover — see the issue for the full investigation.

Deployed to Vercel production at https://cadence-thrift.vercel.app.

### 2026-08-12 — Abandoned-circle cancellation, higher deposit floor, visible defaults

Contract-level fixes for two real bugs flagged in review:

- **Funds could be locked forever if a circle never filled.** `leave()` already covered a member
  exiting individually while `Forming`, but nothing helped if the creator vanished and remaining
  members never called it themselves. `AjoCircle` now takes a `formingDeadline` constructor param;
  once passed while still `Forming`, anyone can call `cancelIfExpired()` (same "anyone may call
  it, no admin role" model as `start()`), flipping to a new `Status.Cancelled`. Each member then
  calls `withdrawAfterCancel()` themselves — a pull-pattern refund, not a loop that pushes to
  everyone, so one failing transfer can't block the rest. `/create` sets a 30-day forming deadline
  automatically (not yet a configurable field).
- **A circle could brick permanently on a second consecutive default.** The security deposit floor
  is now `2x` the contribution instead of `1x` (`/create`'s deposit input follows automatically),
  so a member survives two consecutive defaults before another member's help
  (`coverDeposit`, unchanged) is needed. `checkAndCoverDefault` no longer reverts when a deposit
  can't cover the round — it emits `DefaultUncovered(round, member)` and leaves state as-is, so the
  keeper workflow's default-detection loop keeps running instead of failing hard on one member's
  bad luck, and the failure is now a discoverable event rather than a silent revert.

An unanimous-consent ejection/dissolution mechanism (letting every *other* member force out a
repeat defaulter) was deliberately **not** built — it would reopen the build spec's closed
decision against delay/redistribute/skip branching, and is a product call, not an engineering one.

Test coverage grew from 11 to 16 cases: the full completion cycle, the (now three-default) brick
scenario asserting `DefaultUncovered`, `leave()`/cancel-and-refund, the five previously-untested
custom errors (`AlreadyMember`, `CircleFull`, `AlreadyContributed`, `ContributionWindowClosed`,
`DeadlineNotReached`), and `TrustScoreRegistry.recordDefault`/`OutcomeSkipped`. A solvency/fuzz
invariant pass (Foundry) is still open. `.github/workflows/contracts-test.yml` now runs the suite
on every push.

### 2026-08-11 — Gas abstraction: meta-transaction relayer (CDP Paymaster removed)

Every member action was previously a self-paid transaction — a hard requirement violation of
the build spec's "gas must not be a blocker for non-crypto-native users." A single path now
covers it for every wallet, via `lib/useSponsoredWrite.ts`:

- **Meta-transaction relay**: both contracts inherit OpenZeppelin's `ERC2771Context`, trusting
  `CadenceForwarder` (a stock `ERC2771Forwarder`, deployed once via `scripts/redeploy-factory.ts`).
  A member signs an EIP-712 `ForwardRequest` (no gas), `POST /api/relay` validates it (target is
  the factory or a real circle per `isCircle()`, function selector is one of the seven sponsored
  actions, gas capped at 300k, 20 relayed calls per wallet per rolling 24h via the
  `relay_requests` table, signature pre-checked with the forwarder's own `verify()`) and submits
  it on-chain paying gas from `RELAYER_PRIVATE_KEY` — a dedicated wallet, separate from
  `DEPLOYER_PRIVATE_KEY`, funded with a fixed budget rather than given deploy/admin powers. If
  the relay rejects or fails for any reason, `useSponsoredWrite` falls back to a normal self-paid
  transaction rather than leaving the user stuck.

We previously also had a CDP embedded-wallet (email sign-in) + Coinbase Paymaster path as a
second option for wallet-less users. It's been removed entirely — CDP sign-in kept failing with
network errors that traced back to the user's own machine (ad-blocker/DNS-filter blocking
`*.coinbase.com`), so the whole surface (`@coinbase/cdp-*` packages, `/api/paymaster`, the
`/connect` email UI) was ripped out rather than kept as a half-working fallback. The relayer is
now the only gas-sponsorship mechanism, for every connected wallet.

**Planned next**: `POST /api/relay`'s on-chain submission (the `forwarder.execute()` call, and
`RELAYER_PRIVATE_KEY`/`RELAYER_ADDRESS` that back it) is slated to move into a KeeperHub
workflow, so the same "every autonomous action traces to a nameable KeeperHub workflow"
principle that governs default-checking and payout execution also covers gas sponsorship —
instead of a bespoke Next.js route holding its own hot wallet. `ERC2771Forwarder.execute()` has
no access control, so KeeperHub's existing authorized keeper wallet can call it directly once
this is wired up; `/api/relay` would keep doing validation/rate-limiting (that logic fits a
Postgres-backed route better than a workflow) and hand off only the final execute() call. Blocked
on a KeeperHub OAuth re-authorization (`/mcp`) as of this writing.

**Real limitation, not yet solved**: `approve()` on USDC can't be relayed for EOA wallets —
USDC is a standard ERC-20 that doesn't trust `CadenceForwarder` (only Cadence's own contracts do),
so meta-transactions only cover `createCircle`/`join`/`leave`/`contribute`/`start`/
`replenishDeposit`/`coverDeposit`. Every wallet still pays gas for the one-time (or
per-allowance-refresh) USDC approval step.

### 2026-08-10 — `CircleFactory` redeployed to fix fund-lock bugs

`AjoCircle.sol` had no way for members to reclaim their deposit under two
conditions: a circle that never fills, and a member who defaults twice in a
row (deposit drawn to zero, then nothing left to draw — `checkAndCoverDefault`
and every `executePayout` after it would revert forever). Deposits also never
returned to anyone even on a circle that completed successfully — nothing in
the contract ever paid `securityDepositBalance` back out except a draw on
default. Fixed by adding `leave()` (reclaim your deposit while still
`Forming`), `coverDeposit(member)` (any member can top up a stuck member's
deposit from their own wallet — a community rescue, not a single admin
override), and returning every remaining deposit to its owner when
`executePayout` completes the final round. `KeeperAuthorization` and
`TrustScoreRegistry` are untouched by this — only `CircleFactory` (and the
`AjoCircle` bytecode it deploys) needed a fresh address, via
`npm run contracts:compile && npx hardhat run scripts/redeploy-factory.ts
--network baseSepolia`. **Circles created on the old factory
(`0x28cc4Ca5277e4364Db0cc38a93AB672A23fa9c9D`) are no longer discoverable by
the frontend** — it only scans from the new factory's deploy block onward.

## Required before deployment

1. Fund `DEPLOYER_ADDRESS` with Base Sepolia ETH for deployment gas.
2. Fund future circle members with Base Sepolia test USDC — gas is covered by the meta-tx relayer (see the 2026-08-11 gas-abstraction note below); only the one-time USDC `approve()` still needs ETH.
3. Create a KeeperHub wallet and set its public address as `KEEPERHUB_WALLET_ADDRESS` in `.env`.
4. Set `BASE_SEPOLIA_RPC_URL` and `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL`.

The deploy script intentionally refuses to run without the ERC-8004 registry addresses and the KeeperHub wallet address. The deployer is not used as a keeper: only the KeeperHub address is authorized to call autonomous circle actions.

## Deploy

```powershell
npm run contracts:compile
npm run contracts:deploy:base-sepolia
```

Copy the printed addresses into the public `NEXT_PUBLIC_*_ADDRESS` variables in `.env`, then restart the Next.js dev server. The dashboard's onchain status changes from demo data to live reads when `NEXT_PUBLIC_CIRCLE_FACTORY_ADDRESS` is set.

After deploying, also set `NEXT_PUBLIC_FACTORY_DEPLOY_BLOCK` by running:

```powershell
node scripts/find-deploy-block.mjs
```

This binary-searches for the exact block `CircleFactory` was deployed at using `CIRCLE_FACTORY_ADDRESS` and `BASE_SEPOLIA_RPC_URL` from `.env`. The frontend uses this as the lower bound for all event-log discovery (circle membership, activity feed, trust score outcomes) instead of scanning from chain genesis or relying on a rolling block-count guess. **Re-run this any time `CircleFactory` is redeployed** — see the note below.

## KeeperHub workflows

Built in the "Cadence" KeeperHub project — 8 workflows total, all enabled, all using the authorized `KEEPERHUB_WALLET_ADDRESS` and Base Sepolia (chain `84532`). Circles are discovered dynamically from `CircleFactory` — no workflow hardcodes a single circle address (only the factory address itself). All 8 were re-pointed at the current `CircleFactory`/`TrustScoreRegistry` addresses above on 2026-08-12 after the redeploy orphaned them, and re-validated with `validate_workflow` (deep bytecode check).

**The four core workflows:**

1. **Cadence Payout Execution** (`5qcbb1wh7e2rprusdo93a`) — Schedule trigger (every 2 min), discovers every circle via the factory's `CircleCreated` event log, then for each: reads status/round/deadline/funding/contribution/target, and if active + past deadline + fully funded, calls `AjoCircle.executePayout(round)`. **Live-tested with a real transaction, works correctly.**
2. **Cadence Default Detection + Deposit Draw** (`3dg8l03qvvmgwnxij5p8h`) — Schedule trigger (every 2 min), same circle discovery, then for each active circle past its deadline: reads every member's contribution status, and for anyone unpaid calls `AjoCircle.checkAndCoverDefault(round, member)` followed by `TrustScoreRegistry.recordDefault(member)`. **Currently broken** — a KeeperHub engine bug means the `Condition` node gating the default-draw never executes when nested two `For Each` loops deep. Correctly pointed at the live contracts; will not actually cover a real default until KeeperHub ships a fix. Full root-cause writeup and repro: https://github.com/KeeperHub/keeperhub/issues/2049.
3. **Cadence Completion → Reputation Update** (`f05b7ga7tzp8gpikcl9yh`) — Blockchain Event trigger on `CircleFactory.CircleStatusUpdated` (not `AjoCircle.CircleCompleted` directly — individual circles are created dynamically, so there's no single address to attach a per-circle event trigger to ahead of time; the factory re-emits every circle's status transition at one well-known address instead). Filters to `status == 2` (Completed), reads `getMembers()` on the circle from the event, then calls `TrustScoreRegistry.recordCompletion(member)` for each. **Live-tested — fires entirely on its own, no manual trigger needed.**
4. **Cadence Meta-Transaction Relay** (`oumdqakdccj3vouakrwr8`) — Webhook trigger, receives an already-validated signed `ForwardRequest` from `/api/relay`, re-verifies it on-chain via `CadenceForwarder.verify()`, then submits `CadenceForwarder.execute()` paying gas from the KeeperHub org wallet. Unaffected by the redeploy (references the forwarder, not the factory/registry). **Live-tested with a real transaction, works correctly.**

**Four auxiliary workflows** (monitoring/notifications, Discord-integrated): `Cadence New Circle Announcement`, `Cadence Stuck Circle Watchdog` (daily), `Cadence Contribution Reminders` (every 30 min), `Cadence Relayer Wallet Balance Monitor` (every 6h, checks the org wallet's ETH balance — unaffected by the redeploy).

For every workflow: `validate_workflow` first, test manually, enable only after inspecting the KeeperHub run output, and retain its transaction link for the demo.

### If `CircleFactory` is ever redeployed again

`CircleCreated`'s ABI (and any address baked into a workflow's `query-events`/`Event` trigger nodes) must be updated in lockstep — the event topic hash changes with the event signature, so a stale ABI silently matches zero events rather than erroring. Also re-run `node scripts/find-deploy-block.mjs` and update `NEXT_PUBLIC_FACTORY_DEPLOY_BLOCK` — a stale deploy block means the frontend under-scans and silently misses circles created on the new factory.

## ERC-8004 behaviour

Cadence does not create a proprietary score. Members may link an ERC-8004 identity they own. The `TrustScoreRegistry` adapter records `cadence-circle-completion` or `cadence-contribution-default` feedback on the official reputation registry. A member without a linked identity does not block a payout; Cadence emits `OutcomeSkipped` instead.
