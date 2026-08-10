# Cadence Base Sepolia deployment

## Configured network dependencies

- Chain: Base Sepolia (`84532`)
- Circle USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- ERC-8004 Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`

The local `.env` is intentionally ignored. It contains the deployer private key and must never be committed, copied into client-side variables, or shared.

## Required before deployment

1. Fund `DEPLOYER_ADDRESS` with Base Sepolia ETH for deployment gas.
2. Fund the future circle members with Base Sepolia test USDC and ETH (or configure a supported paymaster).
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

Built in the "Cadence" KeeperHub project, all currently **disabled** pending review. All use the authorized `KEEPERHUB_WALLET_ADDRESS` and Base Sepolia (chain `84532`). Circles are discovered dynamically from `CircleFactory` — no workflow hardcodes a single circle address.

1. **Cadence Payout Execution** (`5qcbb1wh7e2rprusdo93a`) — Schedule trigger (every 15 min), discovers every circle via the factory's `CircleCreated` event log, then for each: reads status/round/deadline/funding/contribution/target, and if active + past deadline + fully funded, calls `AjoCircle.executePayout(round)`.
2. **Cadence Default Detection + Deposit Draw** (`3dg8l03qvvmgwnxij5p8h`) — Schedule trigger (every 15 min), same circle discovery, then for each active circle past its deadline: reads every member's contribution status, and for anyone unpaid calls `AjoCircle.checkAndCoverDefault(round, member)` followed by `TrustScoreRegistry.recordDefault(member)`.
3. **Cadence Completion → Reputation Update** (`f05b7ga7tzp8gpikcl9yh`) — Blockchain Event trigger on `CircleFactory.CircleStatusUpdated` (not `AjoCircle.CircleCompleted` directly — individual circles are created dynamically, so there's no single address to attach a per-circle event trigger to ahead of time; the factory re-emits every circle's status transition at one well-known address instead). Filters to `status == 2` (Completed), reads `getMembers()` on the circle from the event, then calls `TrustScoreRegistry.recordCompletion(member)` for each.
4. **Contribution reminders** — not yet built. Requires member/creator email storage (a Neon Postgres database, `NEON_CONNECTION_STRING` in `.env`) since Cadence has no off-chain email data today; wallets are the only identity.

For every workflow: `validate_workflow` first, test manually, enable only after inspecting the KeeperHub run output, and retain its transaction link for the demo.

### If `CircleFactory` is ever redeployed again

`CircleCreated`'s ABI (and any address baked into a workflow's `query-events`/`Event` trigger nodes) must be updated in lockstep — the event topic hash changes with the event signature, so a stale ABI silently matches zero events rather than erroring. Also re-run `node scripts/find-deploy-block.mjs` and update `NEXT_PUBLIC_FACTORY_DEPLOY_BLOCK` — a stale deploy block means the frontend under-scans and silently misses circles created on the new factory.

## ERC-8004 behaviour

Cadence does not create a proprietary score. Members may link an ERC-8004 identity they own. The `TrustScoreRegistry` adapter records `cadence-circle-completion` or `cadence-contribution-default` feedback on the official reputation registry. A member without a linked identity does not block a payout; Cadence emits `OutcomeSkipped` instead.
