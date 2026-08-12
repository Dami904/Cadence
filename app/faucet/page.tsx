"use client";

import Link from "next/link";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { ArrowUpRight, Check, Droplets, Fuel, ShieldCheck } from "lucide-react";
import { AppShell } from "../../components/AppShell";
import { cadenceContracts, erc20Abi } from "../../lib/contracts";

const MIN_GAS_WEI = 300_000_000_000_000n; // ~0.0003 ETH — comfortably covers a few approvals
const MIN_USDC = 2_000_000n; // 2 USDC — a typical minimum security deposit

export default function FaucetPage() {
  const { address, isConnected } = useAccount();
  const { data: ethBalance } = useBalance({ address, query: { enabled: Boolean(address) } });
  const { data: usdcBalance } = useReadContract({
    address: cadenceContracts.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: Boolean(address) },
  });

  const hasEnoughGas = ethBalance !== undefined && ethBalance.value >= MIN_GAS_WEI;
  const hasEnoughUsdc = usdcBalance !== undefined && usdcBalance >= MIN_USDC;

  return (
    <AppShell active="Faucet" title="Get testnet funds">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow"><Droplets size={13} /> BASE SEPOLIA TESTNET</p>
          <h1>Get testnet funds</h1>
          <p>Cadence runs on Base Sepolia and uses Circle&apos;s real testnet USDC — not a fake token — so you&apos;ll need a little of both to try it.</p>
        </div>
      </div>

      <section className="score-note">
        <ShieldCheck size={20} />
        <p>
          <b>Most actions here are gas-free</b> — join, contribute, and leave are sponsored by a KeeperHub-managed
          relayer. The one exception is approving USDC spending, a one-time step per circle that needs a small
          amount of Base Sepolia ETH in your own wallet.
        </p>
      </section>

      <div className="stats-grid" style={{ marginTop: 20 }}>
        <article className="stat-card">
          <div className={`stat-icon ${hasEnoughGas ? "blue" : "peach"}`}><Fuel size={19} /></div>
          <div>
            <p>YOUR BASE SEPOLIA ETH</p>
            <strong>{isConnected ? (ethBalance ? Number(ethBalance.formatted).toFixed(5) : "…") : "—"}</strong>
            <small className={isConnected ? (hasEnoughGas ? "positive" : "pending") : ""}>
              {!isConnected ? "Connect a wallet to check" : hasEnoughGas ? "Enough for a few approvals" : "Get a top-up below"}
            </small>
          </div>
        </article>
        <article className="stat-card">
          <div className={`stat-icon ${hasEnoughUsdc ? "blue" : "peach"}`}><Droplets size={19} /></div>
          <div>
            <p>YOUR BASE SEPOLIA USDC</p>
            <strong>{isConnected ? (usdcBalance !== undefined ? (Number(usdcBalance) / 1_000_000).toFixed(2) : "…") : "—"}</strong>
            <small className={isConnected ? (hasEnoughUsdc ? "positive" : "pending") : ""}>
              {!isConnected ? "Connect a wallet to check" : hasEnoughUsdc ? "Enough for a typical deposit" : "Get some below"}
            </small>
          </div>
        </article>
      </div>

      <section className="section-card" style={{ marginTop: 20 }}>
        <div className="section-heading">
          <div>
            <h3>Base Sepolia ETH — for gas</h3>
            <p>Covers the one-time USDC approval per circle. A small amount goes a long way.</p>
          </div>
        </div>
        <div className="review-list">
          <div>
            <span>COINBASE FAUCET</span>
            <strong>Base Sepolia ETH</strong>
            <a className="solid-button" href="https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet" target="_blank" rel="noreferrer">
              Open faucet <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </section>

      <section className="section-card" style={{ marginTop: 16 }}>
        <div className="section-heading">
          <div>
            <h3>Base Sepolia USDC — for deposits and contributions</h3>
            <p>Circle&apos;s official testnet faucet. This is the real USDC contract Cadence uses, not a mock token.</p>
          </div>
        </div>
        <div className="review-list">
          <div>
            <span>CIRCLE FAUCET</span>
            <strong>Base Sepolia USDC</strong>
            <a className="solid-button" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
              Open faucet <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </section>

      <div className="settings-protection" style={{ marginTop: 20 }}>
        <Check size={20} />
        <p>
          <b>Both faucets are free and unaffiliated with Cadence.</b> They open in a new tab — paste your wallet
          address (shown in <Link href="/settings">Settings</Link>) into each one to receive testnet funds.
        </p>
      </div>
    </AppShell>
  );
}
