import type { ReactNode } from "react";

// Docs content is data, rendered by app/docs/[slug]/page.tsx. Every section gets an `id` so the
// "On this page" TOC and #anchor links work. Plain JSX bodies, no markdown dependency.

export type DocSection = {
  id: string;
  title: string;
  body: ReactNode;
};

export type DocPage = {
  /** URL slug under /docs — "" is the index page. */
  slug: string;
  group: string;
  title: string;
  description: string;
  sections: DocSection[];
};

function Code({ children }: { children: string }) {
  return (
    <pre className="doc-code">
      <code>{children.trim()}</code>
    </pre>
  );
}

const FACTORY = "0x15503495838757C8753F866AfB0dD61D0E3770B7";
const TRUST_SCORE_REGISTRY = "0x2C272F27D278FD09b6Eabe574D5fDA5dE84B8Edf";
const FORWARDER = "0xD73Eda898c3DbF6996d409fB2442Dd38f719e608";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const KEEPER_AUTH = "0x37D7fe84C4154Ec4A59d0750a654e97d787A572d";
const RELAYER_WALLET = "0x48Ee7A940c3b08A23D1d5c2BE9236d67f5b7Ba21";
const explorer = (addr: string) => `https://sepolia.basescan.org/address/${addr}`;

export const DOC_PAGES: DocPage[] = [
  /* ---------------- Overview ---------------- */
  {
    slug: "",
    group: "Overview",
    title: "Introduction",
    description: "An onchain rotating savings circle, run by named KeeperHub workflows instead of a backend you have to trust.",
    sections: [
      {
        id: "what-cadence-is",
        title: "What Cadence is",
        body: (
          <>
            <p>
              Cadence is an onchain rotating savings circle — the same pattern known as Ajo, Esusu, Chama, or a
              Tontine in different parts of the world. A group agrees on a contribution amount and a payout
              order; every round, everyone contributes, one member gets the pot, and the rotation continues
              until everyone has been paid once.
            </p>
            <p>
              It runs on Base Sepolia against real Circle-issued testnet USDC, not a mock token. Contribution
              amounts, member count, round length, and payout order are locked into the contract at creation —
              not even Cadence can change them once a circle exists.
            </p>
          </>
        ),
      },
      {
        id: "no-opaque-backend",
        title: "No opaque backend agent",
        body: (
          <p>
            The part of Cadence that usually hides behind a server — deciding when a round is ready, executing
            payouts, detecting missed contributions, updating reputation — doesn&apos;t live in a backend here.
            It runs as named, independently inspectable KeeperHub workflows. Every automated onchain action
            traces to a workflow you can open, read, and watch execute, with a real transaction hash attached.
            See <a href="/docs/workflows">The workflows</a> for the full list.
          </p>
        ),
      },
      {
        id: "choose-your-path",
        title: "Choose your path",
        body: (
          <div className="doc-cards">
            <a href="/docs/getting-started" className="doc-card">
              <b>New to Cadence</b>
              <span>Connect a wallet, get testnet funds, and create or join your first circle.</span>
            </a>
            <a href="/docs/how-it-works" className="doc-card">
              <b>Understand a circle</b>
              <span>The full lifecycle — forming, contributing, payouts, completion.</span>
            </a>
            <a href="/docs/workflows" className="doc-card">
              <b>The automation</b>
              <span>Every KeeperHub workflow that runs Cadence, one by one.</span>
            </a>
            <a href="/docs/reference" className="doc-card">
              <b>Builders</b>
              <span>Contract addresses, the stack, and how to read the source.</span>
            </a>
          </div>
        ),
      },
    ],
  },

  /* ---------------- Using Cadence ---------------- */
  {
    slug: "getting-started",
    group: "Using Cadence",
    title: "Getting started",
    description: "Connect a wallet, get testnet funds, and create or join your first circle.",
    sections: [
      {
        id: "connect",
        title: "1. Connect a wallet",
        body: (
          <p>
            Cadence runs on Base Sepolia. Connect any Ethereum wallet (RainbowKit supports the common ones) and
            switch to Base Sepolia if prompted — a banner appears anywhere in the app if you&apos;re on the
            wrong network, with a one-click switch.
          </p>
        ),
      },
      {
        id: "funds",
        title: "2. Get testnet funds",
        body: (
          <>
            <p>
              You&apos;ll need a little Base Sepolia ETH and some testnet USDC. The first time your wallet ever
              connects, Cadence automatically sends a small amount of starter ETH — see{" "}
              <a href="/docs/gas-drip">Starter gas for new members</a> — so most people never need to visit an
              external faucet at all.
            </p>
            <p>
              If you need more (or testnet USDC), the <b>Faucet</b> page links directly to the Coinbase
              Developer Platform faucet (ETH) and Circle&apos;s official testnet faucet (USDC) — the same real
              USDC contract Cadence uses everywhere else, not a stand-in token.
            </p>
          </>
        ),
      },
      {
        id: "create-or-join",
        title: "3. Create or join a circle",
        body: (
          <p>
            Create a circle from <b>My circles</b> — set the contribution amount, member count, cadence, and
            first payout date — or join one you&apos;ve been invited to via its address or invite link. Both
            paths lead into the same circle view described in{" "}
            <a href="/docs/managing-a-circle">Managing a circle</a>.
          </p>
        ),
      },
    ],
  },
  {
    slug: "how-it-works",
    group: "Using Cadence",
    title: "Circles, deposits & payouts",
    description: "The full lifecycle of a circle, from creation to its last payout.",
    sections: [
      {
        id: "the-cycle",
        title: "The cycle",
        body: (
          <>
            <p>A circle moves through four stages:</p>
            <div className="doc-table-scroll">
              <table className="doc-table">
                <thead><tr><th>Stage</th><th>What happens</th></tr></thead>
                <tbody>
                  <tr><td>Forming</td><td>Members join one at a time, each posting a security deposit. A circle that never fills gets 30 days before anyone can cancel it and members reclaim their deposits.</td></tr>
                  <tr><td>Active</td><td>Every round: each member contributes, one member (in a fixed order set at creation) receives the pot. Repeats until every member has been paid once.</td></tr>
                  <tr><td>Completed</td><td>Every member has received a payout. The circle&apos;s outcome is recorded to each member&apos;s <a href="/docs/trust-score">Trust Score</a>.</td></tr>
                  <tr><td>Cancelled</td><td>Only possible if the circle never filled before its forming deadline. Deposits are returned; nothing was ever at risk.</td></tr>
                </tbody>
              </table>
            </div>
          </>
        ),
      },
      {
        id: "deposits-floor",
        title: "Why the deposit is 2x the contribution",
        body: (
          <p>
            Every member posts a security deposit worth two rounds&apos; contributions, not one. That floor is
            enforced by the contract at creation, not just a frontend suggestion. It exists so a deposit can
            survive more than one consecutive missed contribution before another member has to step in — see{" "}
            <a href="/docs/deposits">Default protection</a> for what happens when it doesn&apos;t.
          </p>
        ),
      },
      {
        id: "creator-must-join",
        title: "Creating a circle doesn't make you a member",
        body: (
          <p>
            <code>createCircle()</code> deploys the circle and sets its terms, but it doesn&apos;t enroll the
            creator. Joining — with your own deposit — is a separate, explicit step, identical to how anyone
            else joins via an invite link. A circle you created but haven&apos;t joined yet won&apos;t appear in
            your own Overview or My Circles, though it&apos;s fully live and joinable by anyone with the link.
          </p>
        ),
      },
      {
        id: "immutable-terms",
        title: "Terms are immutable",
        body: (
          <p>
            Contribution amount, member count, round length, and payout order are set once, at deployment.
            There is no admin function to change them afterward — not for Cadence, not for the circle&apos;s
            creator. What the contract says at creation is what runs for the life of the circle.
          </p>
        ),
      },
      {
        id: "naming",
        title: "Naming a circle",
        body: (
          <p>
            The name entered when creating a circle has nowhere to live onchain — <code>createCircle()</code>{" "}
            takes no name parameter — so Cadence stores it off-chain instead, tied to the circle&apos;s address.
            Any current member (or the creator, even before they&apos;ve joined) can set or change it; it shows
            up on the circle&apos;s dashboard header and in the circle switcher wherever you belong to more than
            one.
          </p>
        ),
      },
    ],
  },
  {
    slug: "managing-a-circle",
    group: "Using Cadence",
    title: "Managing a circle",
    description: "Every action available once you're in a circle — contributing, covering a default, leaving, and withdrawing.",
    sections: [
      {
        id: "contribute",
        title: "Contributing",
        body: (
          <p>
            Each round, contribute your agreed amount with one click. The first contribution in any circle
            needs a one-time USDC approval first — the one action that isn&apos;t gas-sponsored, covered in{" "}
            <a href="/docs/meta-transactions">Gasless meta-transactions</a>. Every approval Cadence requests is
            set to the maximum allowed amount, so you only ever approve once per circle, not once per round.
          </p>
        ),
      },
      {
        id: "leaving",
        title: "Leaving while forming",
        body: (
          <p>
            Members can leave and reclaim their deposit only while a circle is still Forming — once it&apos;s
            Active, the rotation is locked in and leaving isn&apos;t possible, since another member is already
            counting on your contribution.
          </p>
        ),
      },
      {
        id: "covering-and-replenishing",
        title: "Covering and replenishing a deposit",
        body: (
          <p>
            If another member&apos;s round has stalled, the circle view surfaces exactly who and why, with a
            one-click <b>Cover</b> action for any member willing to pay it forward. If your own deposit was
            drawn down, <b>Replenish</b> restores it and reclaims your slot. Full mechanics in{" "}
            <a href="/docs/deposits">Default protection</a>.
          </p>
        ),
      },
      {
        id: "cancel-and-withdraw",
        title: "Cancelling and withdrawing",
        body: (
          <p>
            A circle stuck Forming past its deadline can be cancelled by anyone — there&apos;s no reason to wait
            on the creator specifically. Once a circle is Cancelled or Completed, each member withdraws their
            own deposit independently (a pull, not a bulk refund) — see{" "}
            <a href="/docs/deposits#pull-not-push">why withdrawals are pull-based</a>.
          </p>
        ),
      },
      {
        id: "onchain-proof",
        title: "Every action is a real transaction",
        body: (
          <p>
            Every member row in a circle links directly to that address on BaseScan, and every completed action
            shows its transaction hash — nothing in the circle view is a cached summary you have to take on
            faith.
          </p>
        ),
      },
    ],
  },
  {
    slug: "deposits",
    group: "Using Cadence",
    title: "Default protection",
    description: "What happens when someone misses a round, and how deposits absorb it.",
    sections: [
      {
        id: "default-flow",
        title: "The default flow",
        body: (
          <p>
            When a round&apos;s deadline passes, the <a href="/docs/workflows">Default Detection + Deposit
            Draw</a> workflow checks every member who hasn&apos;t contributed. If their security deposit still
            covers the missed amount, it&apos;s drawn automatically (<code>DefaultCovered</code>) and the round
            continues on schedule. If the deposit can&apos;t cover it, the round stalls (
            <code>DefaultUncovered</code>) until another member voluntarily covers it, as described in{" "}
            <a href="/docs/managing-a-circle">Managing a circle</a>.
          </p>
        ),
      },
      {
        id: "cover-and-replenish",
        title: "Covering and replenishing",
        body: (
          <p>
            Any member can call <code>coverDeposit(member)</code> to pay a stalled contribution out of their own
            funds, becoming that slot&apos;s <code>depositOwner</code> — the rescuer, not the original
            defaulter, is who can later withdraw it back out. The original member can restore their own standing
            at any time with <code>replenishDeposit()</code>, reclaiming ownership of their slot.
          </p>
        ),
      },
      {
        id: "pull-not-push",
        title: "Why withdrawals are pull, not push",
        body: (
          <p>
            When a circle is cancelled or completed, deposits aren&apos;t pushed back out in a loop over every
            member — that pattern lets one member&apos;s address (a contract that reverts on receive, for
            example) block the refund for everyone else. Instead, <code>withdrawDeposit(member)</code> is
            pull-based: each member&apos;s slot is claimed independently, so one bad actor can&apos;t hold up the
            rest of the circle.
          </p>
        ),
      },
    ],
  },
  {
    slug: "activity",
    group: "Using Cadence",
    title: "Activity & notifications",
    description: "The account-wide activity feed, and how contribution reminders currently work.",
    sections: [
      {
        id: "the-feed",
        title: "The activity feed",
        body: (
          <p>
            The Activity page is account-wide, not scoped to one circle — it merges every event across every
            circle your connected wallet has ever touched (created, joined, or otherwise), including circles
            you&apos;ve since left, into a single timeline. A <b>Just me / Everyone in my circles</b> toggle
            narrows it back down to only your own actions plus circle-wide events like completion and
            cancellation. Click any entry to jump straight into that circle — or to the join page, if
            you&apos;re not (or not yet) a member of it.
          </p>
        ),
      },
      {
        id: "reminders",
        title: "Contribution reminders",
        body: (
          <p>
            Settings lets you save an email and toggle reminders on, but today those reminders are delivered
            through Discord, not email — the <a href="/docs/workflows">Contribution Reminders</a> workflow posts
            upcoming deadlines there on a schedule. The saved email preference is real (it&apos;s stored and
            readable back), it just isn&apos;t wired to an outbound email step yet. Until it is, plan around your
            own contribution dates rather than expecting an email.
          </p>
        ),
      },
    ],
  },
  {
    slug: "trust-score",
    group: "Using Cadence",
    title: "Trust score (ERC-8004)",
    description: "A portable reputation record, built from real completed circles, using the ERC-8004 identity and reputation standard.",
    sections: [
      {
        id: "how-it-works",
        title: "How it works",
        body: (
          <p>
            Cadence records circle outcomes — completions and missed contributions — to the ERC-8004 reputation
            registry, tied to an ERC-8004 identity you link to your wallet. Your score is computed as{" "}
            <code>50 + netValue / (2 × total outcomes)</code>, where every completion and default is a real
            onchain event, never a private formula. The{" "}
            <a href="/docs/workflows">Completion → Reputation Update</a> workflow writes these outcomes
            automatically the moment a circle completes — no manual step, no delay.
          </p>
        ),
      },
      {
        id: "linking-an-identity",
        title: "Linking an identity",
        body: (
          <p>
            Cadence only <em>links</em> an ERC-8004 agent ID you already own — it doesn&apos;t issue new
            identities itself. If you don&apos;t have an agent ID yet, there&apos;s currently no in-app path to
            register one; that&apos;s a known gap, not a hidden requirement.
          </p>
        ),
      },
      {
        id: "portable-by-design",
        title: "Portable by design",
        body: (
          <p>
            Because the outcomes live on the standard ERC-8004 reputation registry rather than a Cadence-only
            table, the same track record is readable by any other application that respects the standard — your
            reliability in one circle isn&apos;t locked to this one app.
          </p>
        ),
      },
    ],
  },

  /* ---------------- Automation ---------------- */
  {
    slug: "automation",
    group: "Automation",
    title: "Why KeeperHub",
    description: "Every autonomous action in Cadence traces to a nameable, independently inspectable KeeperHub workflow.",
    sections: [
      {
        id: "the-thesis",
        title: "The thesis",
        body: (
          <p>
            Rotating savings circles have always needed someone trusted to hold the pot and enforce the
            rotation. Cadence&apos;s answer isn&apos;t a backend agent making silent decisions — it&apos;s a set
            of KeeperHub workflows, each with a name, a trigger you can read, and a transaction trail you can
            verify. There is no code running Cadence&apos;s automation that isn&apos;t also a workflow you could
            open in KeeperHub right now and inspect.
          </p>
        ),
      },
      {
        id: "one-wallet",
        title: "One managed wallet, every autonomous action",
        body: (
          <p>
            Every workflow that moves funds or submits a transaction signs from the same KeeperHub-managed
            wallet —{" "}
            <a href={explorer(RELAYER_WALLET)} target="_blank" rel="noreferrer"><code>{RELAYER_WALLET}</code></a>{" "}
            — backed by Turnkey&apos;s hardware secure enclaves. Payouts, default coverage, reputation writes,
            the meta-transaction relay, and the new-member gas drip all trace to the same address, watched by
            its own balance-monitor workflow.
          </p>
        ),
      },
      {
        id: "read-more",
        title: "Read more",
        body: (
          <div className="doc-cards">
            <a href="/docs/workflows" className="doc-card">
              <b>The workflows</b>
              <span>All nine, with their trigger, action, and purpose.</span>
            </a>
            <a href="/docs/meta-transactions" className="doc-card">
              <b>Gasless meta-transactions</b>
              <span>How the relay lets members act without holding ETH.</span>
            </a>
          </div>
        ),
      },
    ],
  },
  {
    slug: "workflows",
    group: "Automation",
    title: "The workflows",
    description: "Every KeeperHub workflow that runs Cadence, one by one.",
    sections: [
      {
        id: "core-lifecycle",
        title: "Core circle lifecycle",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead><tr><th>Workflow</th><th>Trigger</th><th>What it does</th></tr></thead>
              <tbody>
                <tr>
                  <td><b>Cadence Payout Execution</b></td>
                  <td>Schedule</td>
                  <td>Reads round state across every circle; the moment a round is fully funded and its deadline has passed, executes the payout to that round&apos;s recipient.</td>
                </tr>
                <tr>
                  <td><b>Cadence Default Detection + Deposit Draw</b></td>
                  <td>Schedule</td>
                  <td>Walks every circle, then every member of each circle, checking for missed contributions past deadline. Auto-covers what it can from the member&apos;s own deposit; flags what it can&apos;t.</td>
                </tr>
                <tr>
                  <td><b>Cadence Completion → Reputation Update</b></td>
                  <td>Event (CircleCompleted)</td>
                  <td>Writes each member&apos;s outcome to the ERC-8004 reputation registry the moment a circle completes, then posts the milestone to Discord.</td>
                </tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "member-actions",
        title: "Member-initiated actions",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead><tr><th>Workflow</th><th>Trigger</th><th>What it does</th></tr></thead>
              <tbody>
                <tr>
                  <td><b>Cadence Meta-Transaction Relay</b></td>
                  <td>Webhook</td>
                  <td>Re-verifies an already-signed EIP-712 request onchain via <code>CadenceForwarder.verify()</code>, then submits <code>execute()</code> — paying gas so the member never has to. Details in <a href="/docs/meta-transactions">Gasless meta-transactions</a>.</td>
                </tr>
                <tr>
                  <td><b>Cadence New Member Gas Drip</b></td>
                  <td>Webhook</td>
                  <td>Sends a small, fixed amount of Base Sepolia ETH to a wallet the first time it connects — enough for the one step sponsorship can&apos;t cover. Details in <a href="/docs/gas-drip">Starter gas for new members</a>.</td>
                </tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "monitoring",
        title: "Monitoring & notifications",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead><tr><th>Workflow</th><th>Trigger</th><th>What it does</th></tr></thead>
              <tbody>
                <tr><td><b>Cadence New Circle Announcement</b></td><td>Event</td><td>Posts to Discord whenever a new circle is created.</td></tr>
                <tr><td><b>Cadence Stuck Circle Watchdog</b></td><td>Schedule (daily)</td><td>Flags circles still Forming past a reasonable window, so a stalled circle doesn&apos;t just sit silently.</td></tr>
                <tr><td><b>Cadence Contribution Reminders</b></td><td>Schedule (every 30 min)</td><td>Posts upcoming contribution deadlines to Discord — see the note in <a href="/docs/activity">Activity &amp; notifications</a>.</td></tr>
                <tr><td><b>Cadence Relayer Wallet Balance Monitor</b></td><td>Schedule (every 6h)</td><td>Watches the shared KeeperHub wallet&apos;s ETH balance and alerts before it runs low — the same wallet funds both the relay and the gas drip.</td></tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "principle",
        title: "The pattern behind all of them",
        body: (
          <p>
            Each workflow does exactly one job. Reading round state is separate from executing a payout;
            detecting a default is separate from covering it; verifying a signature is separate from submitting
            it onchain. Nothing runs inside a monolithic script — every step is its own node, in a workflow with
            a name, so a failure or a fix is traceable to one specific, inspectable place.
          </p>
        ),
      },
    ],
  },
  {
    slug: "meta-transactions",
    group: "Automation",
    title: "Gasless meta-transactions",
    description: "How members act on Cadence without holding ETH — and the one step that still needs it.",
    sections: [
      {
        id: "the-flow",
        title: "The flow",
        body: (
          <>
            <p>
              Cadence&apos;s contracts (<code>AjoCircle</code>, <code>CircleFactory</code>,{" "}
              <code>TrustScoreRegistry</code>) extend OpenZeppelin&apos;s <code>ERC2771Context</code> and trust
              one forwarder:
            </p>
            <Code>{`CadenceForwarder — ${FORWARDER}`}</Code>
            <p>
              A member signs an EIP-712 <code>ForwardRequest</code> (free — no gas, just a signature) describing
              the call they want to make. The frontend posts it to <code>/api/relay</code>, which validates the
              target and function selector against a fixed allow-list, rate-limits the wallet, and forwards the
              already-signed request to the <a href="/docs/workflows">Meta-Transaction Relay</a> workflow. That
              workflow re-verifies the signature onchain and submits <code>execute()</code>, paying gas from the
              KeeperHub-managed wallet. On the target contract, <code>_msgSender()</code> resolves to the
              original signer — not the relayer — so the action is attributed correctly onchain.
            </p>
          </>
        ),
      },
      {
        id: "sponsored-actions",
        title: "What's sponsored",
        body: (
          <p>
            Creating a circle, joining, leaving, contributing, starting a round, replenishing or covering a
            deposit, withdrawing a deposit, cancelling an expired circle, and linking or unlinking an ERC-8004
            identity — all gas-free.
          </p>
        ),
      },
      {
        id: "the-one-exception",
        title: "The one exception",
        body: (
          <p>
            Approving the real, already-deployed Base Sepolia USDC contract to spend on your behalf isn&apos;t
            sponsored. That USDC contract predates Cadence and was never written to trust{" "}
            <code>ERC2771Context</code> — it has no concept of a forwarded sender, so that one call has to be a
            normal, wallet-paid transaction. It&apos;s a one-time step per circle, and it&apos;s the entire
            reason a new wallet needs any Base Sepolia ETH at all — see{" "}
            <a href="/docs/gas-drip">Starter gas for new members</a>.
          </p>
        ),
      },
    ],
  },
  {
    slug: "gas-drip",
    group: "Automation",
    title: "Starter gas for new members",
    description: "A one-time, automatic ETH drip so a brand-new wallet never has to find an external faucet first.",
    sections: [
      {
        id: "why",
        title: "Why this exists",
        body: (
          <p>
            Almost everything on Cadence is gas-sponsored — except the one-time USDC approval a new circle
            needs (see <a href="/docs/meta-transactions">the one exception</a>). Rather than sending every new
            member out to an external faucet before they can do anything, Cadence sends a small amount of Base
            Sepolia ETH automatically, the first time a wallet connects.
          </p>
        ),
      },
      {
        id: "how-it-works",
        title: "How it works",
        body: (
          <>
            <p>
              On first connect, the app calls <code>/api/gas-drip</code> with the wallet address. That route:
            </p>
            <ol>
              <li>Reserves the address in Postgres — atomically, so it can never be considered twice, no matter how many times it&apos;s called across future logins.</li>
              <li>Checks the wallet&apos;s current ETH balance; if it&apos;s already funded, the reservation is kept but nothing is sent.</li>
              <li>Otherwise triggers the <a href="/docs/workflows">New Member Gas Drip</a> workflow, which sends a fixed 0.0005 ETH — the amount is hardcoded in the workflow itself, never taken from the request, so a bug in the calling route could never turn this into an arbitrary-amount drain.</li>
            </ol>
          </>
        ),
      },
      {
        id: "no-signature",
        title: "Why there's no wallet signature",
        body: (
          <p>
            Every other write in Cadence requires a signed message proving wallet control. This one
            deliberately doesn&apos;t — requiring a signature would pop an unrequested wallet prompt the instant
            a brand-new visitor lands on the app, and a signature wouldn&apos;t actually stop abuse anyway
            (anyone can sign for a throwaway address they just generated). Since this only ever moves a tiny,
            fixed, one-shot amount of worthless testnet ETH, the protection is entirely server-side instead: one
            reservation per address, forever.
          </p>
        ),
      },
    ],
  },

  /* ---------------- Engineering notes ---------------- */
  {
    slug: "security",
    group: "Engineering notes",
    title: "Security & trust model",
    description: "What Cadence enforces onchain, what's rate-limited off-chain, and where the trust boundaries actually sit.",
    sections: [
      {
        id: "onchain-guarantees",
        title: "What's enforced onchain",
        body: (
          <ul>
            <li>Circle terms (contribution, deposit, member count, cadence, payout order) are immutable once deployed.</li>
            <li>Every fund-moving function (<code>join</code>, <code>leave</code>, <code>contribute</code>, <code>replenishDeposit</code>, <code>coverDeposit</code>, <code>executePayout</code>, <code>withdrawDeposit</code>) is reentrancy-guarded.</li>
            <li>Payout execution and default detection are restricted to the authorized keeper; every other member action is open to any member.</li>
            <li>Withdrawals are pull-based per member, not a bulk loop, so one address can&apos;t block a refund for everyone else.</li>
          </ul>
        ),
      },
      {
        id: "relay-boundaries",
        title: "What the relay enforces off-chain",
        body: (
          <ul>
            <li>Only a fixed allow-list of function selectors is ever sponsored — arbitrary calldata is never forwarded, even to a trusted target.</li>
            <li>Every sponsored request is capped at a fixed gas limit and rate-limited per wallet per day.</li>
            <li>The signature is re-verified onchain by the relay workflow itself before submission — the API route&apos;s own check is never trusted as the last word.</li>
          </ul>
        ),
      },
      {
        id: "off-chain-writes",
        title: "Off-chain data (names, email, reminders)",
        body: (
          <p>
            Circle names and notification preferences live in Postgres, not onchain — there was nowhere onchain
            for them to go. Every write there requires a freshly signed message binding the exact values being
            saved and a short expiry window, so a captured signature can never be replayed to write something
            different, or replayed later after it&apos;s gone stale.
          </p>
        ),
      },
    ],
  },
  {
    slug: "reference",
    group: "Engineering notes",
    title: "Reference",
    description: "Contract addresses and the stack Cadence is built on.",
    sections: [
      {
        id: "contracts",
        title: "Contracts — Base Sepolia",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead><tr><th>Contract</th><th>Address</th></tr></thead>
              <tbody>
                <tr><td>CircleFactory</td><td><a href={explorer(FACTORY)} target="_blank" rel="noreferrer"><code>{FACTORY}</code></a></td></tr>
                <tr><td>TrustScoreRegistry</td><td><a href={explorer(TRUST_SCORE_REGISTRY)} target="_blank" rel="noreferrer"><code>{TRUST_SCORE_REGISTRY}</code></a></td></tr>
                <tr><td>CadenceForwarder</td><td><a href={explorer(FORWARDER)} target="_blank" rel="noreferrer"><code>{FORWARDER}</code></a></td></tr>
                <tr><td>KeeperAuthorization</td><td><a href={explorer(KEEPER_AUTH)} target="_blank" rel="noreferrer"><code>{KEEPER_AUTH}</code></a></td></tr>
                <tr><td>USDC (Circle, testnet)</td><td><a href={explorer(USDC)} target="_blank" rel="noreferrer"><code>{USDC}</code></a></td></tr>
                <tr><td>KeeperHub-managed wallet</td><td><a href={explorer(RELAYER_WALLET)} target="_blank" rel="noreferrer"><code>{RELAYER_WALLET}</code></a></td></tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "stack",
        title: "The stack",
        body: (
          <ul>
            <li><b>Contracts</b> — Solidity 0.8.24, Hardhat, OpenZeppelin (<code>ERC2771Context</code>, <code>ReentrancyGuard</code>)</li>
            <li><b>Frontend</b> — Next.js 15 (App Router), wagmi v2, viem, RainbowKit</li>
            <li><b>Automation</b> — KeeperHub, Turnkey-backed wallet</li>
            <li><b>Data</b> — Neon Postgres, for off-chain preferences (email reminders, circle names) and relay rate-limiting</li>
            <li><b>Identity</b> — ERC-8004 identity and reputation registries</li>
          </ul>
        ),
      },
      {
        id: "links",
        title: "Links",
        body: (
          <ul>
            <li><a href="https://github.com/dami904/cadence" target="_blank" rel="noreferrer">Source on GitHub</a></li>
            <li><a href="https://github.com/KeeperHub/keeperhub/issues/2049" target="_blank" rel="noreferrer">A KeeperHub bug we filed</a> — see <a href="/docs/keeperhub-bug">the writeup</a></li>
          </ul>
        ),
      },
    ],
  },
  {
    slug: "keeperhub-bug",
    group: "Engineering notes",
    title: "A KeeperHub bug we found",
    description: "A reproducible bug in KeeperHub's own workflow engine, found while building the default-detection workflow — filed and currently open.",
    sections: [
      {
        id: "the-symptom",
        title: "The symptom",
        body: (
          <p>
            The <a href="/docs/workflows">Default Detection + Deposit Draw</a> workflow walks every circle,
            then every member of each circle, checking for missed contributions — a <code>Condition</code> node
            nested two <code>For Each</code> loops deep. In every execution we ran, that condition never fired,
            even for members confirmed on-chain to have genuinely missed a contribution.
          </p>
        ),
      },
      {
        id: "the-root-cause",
        title: "The root cause",
        body: (
          <p>
            KeeperHub&apos;s workflow executor is open source. Tracing the bug to its own code, the nested{" "}
            <code>For Each</code> callback (<code>handleNestedForEach</code>) resolves each node&apos;s next
            step using the <em>inner</em> loop&apos;s own partial edge map, rather than the workflow&apos;s
            global edge map — the same lookup that works correctly for a top-level, non-nested node. A condition
            nested inside two loops never resolves to its own outgoing edges, so it silently never executes,
            with no error surfaced anywhere.
          </p>
        ),
      },
      {
        id: "what-we-tried",
        title: "What we tried first",
        body: (
          <ul>
            <li>Restructuring the workflow to avoid the second nesting level.</li>
            <li>Adding an explicit <code>Collect</code> node to flatten the loop output before the condition.</li>
            <li>Re-reading KeeperHub&apos;s own documentation for a nested-loop pattern we&apos;d missed.</li>
            <li>Only after those didn&apos;t resolve it did source-diving into KeeperHub&apos;s executor turn up the actual root cause above.</li>
          </ul>
        ),
      },
      {
        id: "status",
        title: "Current status",
        body: (
          <>
            <p>
              Filed as{" "}
              <a href="https://github.com/KeeperHub/keeperhub/issues/2049" target="_blank" rel="noreferrer">
                KeeperHub/keeperhub#2049
              </a>{" "}
              — open, with three reproduction execution IDs and a suggested one-line fix pointing at the exact
              line. The workflow itself is correctly configured against Cadence&apos;s deployed contracts and
              will start working the moment the fix ships; nothing about the bug is Cadence-side.
            </p>
            <p>
              In the meantime, defaults aren&apos;t unrecoverable — the contract allows any member, not just the
              automated keeper, to call <code>coverDeposit()</code> manually, as covered in{" "}
              <a href="/docs/managing-a-circle">Managing a circle</a>. The automation just isn&apos;t running
              that check on schedule yet.
            </p>
          </>
        ),
      },
    ],
  },
];

export function docGroups(): { label: string; pages: DocPage[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, DocPage[]>();
  for (const page of DOC_PAGES) {
    if (!byGroup.has(page.group)) {
      byGroup.set(page.group, []);
      order.push(page.group);
    }
    byGroup.get(page.group)!.push(page);
  }
  return order.map((label) => ({ label, pages: byGroup.get(label)! }));
}

export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export function docHref(page: DocPage): string {
  return page.slug ? `/docs/${page.slug}` : "/docs";
}
