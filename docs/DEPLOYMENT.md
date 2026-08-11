# Cadence Base Sepolia deployment

## Configured network dependencies

- Chain: Base Sepolia (`84532`)
- Circle USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- ERC-8004 Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- Keeper Authorization: `0x37D7fe84C4154Ec4A59d0750a654e97d787A572d`
- Trust Score Registry: `0xfAd996eF67d5531cCcA3Ca3822c4e09fA034f86D`
- Cadence Forwarder (ERC-2771): `0xD73Eda898c3DbF6996d409fB2442Dd38f719e608`
- Circle Factory: `0x129c04f9b3561808Bb38f54b86eFB9A86696b8C5` (redeployed 2026-08-11 for ERC-2771 support, deploy block `45336321` — see below)

The local `.env` is intentionally ignored. It contains the deployer private key and must never be committed, copied into client-side variables, or shared.

### 2026-08-11 — Gas abstraction: CDP embedded wallet + meta-transaction relayer

Every member action was previously a self-paid transaction — a hard requirement violation of
the build spec's "gas must not be a blocker for non-crypto-native users." Two paths now cover
it, chosen per connected wallet by `lib/useSponsoredWrite.ts`:

- **CDP embedded wallet** (`/connect` → "Continue with email"): a smart account created via
  `@coinbase/cdp-wagmi`'s connector, registered as a real wagmi connector so every existing hook
  (`useAccount`, `useReadContract`, etc.) works unchanged. Writes route through `useSendCalls`
  with `capabilities.paymasterService` pointed at `/api/paymaster`, a server-side proxy that
  forwards to CDP's real Paymaster/bundler endpoint (`CDP_PAYMASTER_URL` — never sent to the
  browser, since the URL embeds a Client API Key). **Requires the CDP Portal's Paymaster
  allowlist to include the contract + function selectors being sponsored** (CircleFactory,
  every deployed AjoCircle, and USDC's `approve`) — configured in the CDP Portal, not in code.
- **Meta-transaction relay** (MetaMask, Rabby, any other injected/WalletConnect wallet): both
  contracts now inherit OpenZeppelin's `ERC2771Context`, trusting `CadenceForwarder` (a stock
  `ERC2771Forwarder`, deployed once via `scripts/redeploy-factory.ts`). A member signs an
  EIP-712 `ForwardRequest` (no gas), `POST /api/relay` validates it (target is the factory or a
  real circle per `isCircle()`, function selector is one of the seven sponsored actions, gas
  capped at 300k, 20 relayed calls per wallet per rolling 24h via the `relay_requests` table)
  and submits it on-chain paying gas from `RELAYER_PRIVATE_KEY` — a dedicated wallet, separate
  from `DEPLOYER_PRIVATE_KEY`, funded with a fixed budget (0.003 ETH at setup) rather than given
  deploy/admin powers. If the relay rejects or fails for any reason, `useSponsoredWrite` falls
  back to a normal self-paid transaction rather than leaving the user stuck.

**Real limitation, not yet solved**: `approve()` on USDC can't be relayed for EOA wallets —
USDC is a standard ERC-20 that doesn't trust `CadenceForwarder` (only Cadence's own contracts do),
so meta-transactions only cover `createCircle`/`join`/`leave`/`contribute`/`start`/
`replenishDeposit`/`coverDeposit`. A MetaMask/Rabby user still pays gas for the one-time (or
per-allowance-refresh) USDC approval step. CDP embedded-wallet users don't hit this, since
Paymaster sponsorship isn't restricted to Cadence's own contracts — as long as USDC + `approve`
is in the CDP Portal allowlist too.

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
2. Fund future circle members with Base Sepolia test USDC — gas is covered by the CDP embedded-wallet Paymaster or the meta-tx relayer (see the 2026-08-11 gas-abstraction note below); only the one-time USDC `approve()` still needs ETH on a MetaMask/Rabby-style wallet.
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

Built in the "Cadence" KeeperHub project, all three **enabled** as of 2026-08-11. All use the authorized `KEEPERHUB_WALLET_ADDRESS` and Base Sepolia (chain `84532`). Circles are discovered dynamically from `CircleFactory` — no workflow hardcodes a single circle address (only the factory address itself, which each workflow's `CircleCreated`/`CircleStatusUpdated` node references). Manually triggered `Cadence Payout Execution` once to confirm it actually runs against live Base Sepolia RPC, not just passes structural validation — it correctly discovered zero circles (none existed yet) and completed without error.

**Known stale state:** the three workflows currently point at the 2026-08-10 factory (`0x994c1bA542aB312bF65AB06D48D657E9F97888b8`), one redeploy behind the current one above (`0x129c04f9b3561808Bb38f54b86eFB9A86696b8C5`, redeployed 2026-08-11 for ERC-2771 support). The KeeperHub OAuth session expired before this could be fixed in the same pass — re-point `query-events`/the trigger's `contractAddress` in all three workflows (same procedure as the note below) before relying on them.

1. **Cadence Payout Execution** (`5qcbb1wh7e2rprusdo93a`) — Schedule trigger (every 15 min), discovers every circle via the factory's `CircleCreated` event log, then for each: reads status/round/deadline/funding/contribution/target, and if active + past deadline + fully funded, calls `AjoCircle.executePayout(round)`.
2. **Cadence Default Detection + Deposit Draw** (`3dg8l03qvvmgwnxij5p8h`) — Schedule trigger (every 15 min), same circle discovery, then for each active circle past its deadline: reads every member's contribution status, and for anyone unpaid calls `AjoCircle.checkAndCoverDefault(round, member)` followed by `TrustScoreRegistry.recordDefault(member)`.
3. **Cadence Completion → Reputation Update** (`f05b7ga7tzp8gpikcl9yh`) — Blockchain Event trigger on `CircleFactory.CircleStatusUpdated` (not `AjoCircle.CircleCompleted` directly — individual circles are created dynamically, so there's no single address to attach a per-circle event trigger to ahead of time; the factory re-emits every circle's status transition at one well-known address instead). Filters to `status == 2` (Completed), reads `getMembers()` on the circle from the event, then calls `TrustScoreRegistry.recordCompletion(member)` for each.
4. **Contribution reminders** — not yet built. Requires member/creator email storage (a Neon Postgres database, `NEON_CONNECTION_STRING` in `.env`) since Cadence has no off-chain email data today; wallets are the only identity.

For every workflow: `validate_workflow` first, test manually, enable only after inspecting the KeeperHub run output, and retain its transaction link for the demo.

### If `CircleFactory` is ever redeployed again

`CircleCreated`'s ABI (and any address baked into a workflow's `query-events`/`Event` trigger nodes) must be updated in lockstep — the event topic hash changes with the event signature, so a stale ABI silently matches zero events rather than erroring. Also re-run `node scripts/find-deploy-block.mjs` and update `NEXT_PUBLIC_FACTORY_DEPLOY_BLOCK` — a stale deploy block means the frontend under-scans and silently misses circles created on the new factory.

## ERC-8004 behaviour

Cadence does not create a proprietary score. Members may link an ERC-8004 identity they own. The `TrustScoreRegistry` adapter records `cadence-circle-completion` or `cadence-contribution-default` feedback on the official reputation registry. A member without a linked identity does not block a payout; Cadence emits `OutcomeSkipped` instead.
