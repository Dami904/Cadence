"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { CDPReactProvider } from "@coinbase/cdp-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig, isCdpConfigured } from "../lib/wagmi";

const cdpConfig = {
  projectId: process.env.NEXT_PUBLIC_CDP_PROJECT_ID ?? "",
  ethereum: { createOnLogin: "smart" as const },
  appName: "Cadence",
};

// Applied app-wide since CDP's UI components only render within the /connect email flow today,
// but keeping the theme on the provider (rather than per-component) means any future CDP UI
// (account management, MFA prompts) inherits the same look with no extra wiring.
const cdpTheme = {
  "colors-bg-primary": "#fcfcf8",
  "colors-bg-secondary": "#fff",
  "colors-fg-primary": "#132824",
  "colors-fg-secondary": "#71807d",
  "colors-fg-muted": "#8b9895",
  "colors-line-primary": "#e2e7e2",
  "colors-line-secondary": "#e2e7e2",
  "colors-cta-primary-bg-default": "#166f66",
  "colors-cta-primary-bg-hover": "#168176",
  "colors-cta-primary-fg-default": "#ffffff",
  "border-radius-cta": "8px",
  "border-radius-input": "7px",
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const body = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );

  if (!isCdpConfigured) return body;
  return <CDPReactProvider config={cdpConfig} theme={cdpTheme}>{body}</CDPReactProvider>;
}
