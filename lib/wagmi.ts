import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createStorage, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";

// Falls back to RainbowKit's shared public example project when unset, so local dev
// doesn't crash — get a free one at https://cloud.reown.com for anything beyond local testing.
export const wagmiConfig = getDefaultConfig({
  appName: "Cadence",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID",
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL) },
  // Own storage key so a browser's leftover reconnection state from an earlier,
  // differently-configured connector list is never read back as if it still applied.
  storage: createStorage({
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    key: "cadence-wagmi",
  }),
  ssr: true,
});
