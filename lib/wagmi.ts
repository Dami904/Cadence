import { getDefaultWallets } from "@rainbow-me/rainbowkit";
import { createCDPEmbeddedWalletConnector } from "@coinbase/cdp-wagmi";
import { createConfig, createStorage, http, type CreateConnectorFn } from "wagmi";
import { baseSepolia } from "wagmi/chains";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID";
const cdpProjectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID;

// Falls back to RainbowKit's shared public example project when unset, so local dev
// doesn't crash — get a free one at https://cloud.reown.com for anything beyond local testing.
const { connectors: walletConnectors } = getDefaultWallets({
  appName: "Cadence",
  projectId: walletConnectProjectId,
});

// Registered as a real wagmi connector (not a separate auth system bolted on the side) so every
// existing hook that reads useAccount()/useReadContract() keeps working unchanged for a CDP
// embedded-wallet user — only the sign-in UI on /connect needs to know this path exists at all.
// Omitted entirely, rather than pointed at a placeholder, if no project ID is configured — an
// unconfigured connector would otherwise fail silently the moment someone tried to use it.
const cdpConnector: CreateConnectorFn | null = cdpProjectId
  ? createCDPEmbeddedWalletConnector({
      cdpConfig: {
        projectId: cdpProjectId,
        ethereum: { createOnLogin: "smart" },
      },
      providerConfig: {
        chains: [baseSepolia],
        transports: { [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL) },
      },
    })
  : null;

export const isCdpConfigured = Boolean(cdpProjectId);

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL) },
  connectors: cdpConnector ? [...walletConnectors, cdpConnector] : walletConnectors,
  // Own storage key so a browser's leftover reconnection state from an earlier,
  // differently-configured connector list is never read back as if it still applied.
  storage: createStorage({
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    key: "cadence-wagmi",
  }),
  ssr: true,
});
