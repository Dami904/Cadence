import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Cadence — Savings, on schedule.",
  description: "A transparent, onchain rotating savings circle.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // WalletConnect's connector writes --wcm-* CSS custom properties onto <html> as soon as it
    // initializes on the client, before React finishes hydrating — the mismatch is real (SSR
    // genuinely can't know those values) and unavoidable short of not using WalletConnect, so
    // this is the documented React/Next.js escape hatch for a legitimate third-party client-only
    // mutation, not a workaround for an actual app bug.
    <html lang="en" suppressHydrationWarning>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
