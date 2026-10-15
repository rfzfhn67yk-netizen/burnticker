"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";
import { walletEndpoint, walletWsEndpoint } from "@/lib/burnticker/walletShell";

/**
 * THE ONE WALLET PROVIDER (website-13, 2026-10-12; src/lib/burnticker/walletShell.ts). Mounted once, by the app's root layout, around the
 * header and every page, so the header's "Connect wallet", "Your coins" and the launch wizard all read the same connection, and it
 * survives navigation inside the app. Wallets: every installed wallet that speaks the Wallet Standard is found automatically (Phantom,
 * Solflare, Backpack and others); Phantom and Solflare are also listed by name so a visitor without either sees where to get one. No
 * auto-connect: a wallet connects only when the visitor picks it. The RPC is only for the adapter's connection object; nothing here
 * signs or sends.
 */
function useNamedWalletDialog() {
  // launch audit 5 L08: the adapter's wallet list draws its close button with no accessible name; name it (and the list) when it opens
  useEffect(() => {
    const name = () => {
      for (const b of document.querySelectorAll<HTMLButtonElement>(".wallet-adapter-modal-button-close")) if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", "Close the wallet list");
      for (const d of document.querySelectorAll<HTMLElement>(".wallet-adapter-modal-wrapper")) { if (!d.getAttribute("role")) d.setAttribute("role", "dialog"); if (!d.getAttribute("aria-label")) d.setAttribute("aria-label", "Choose a wallet"); }
    };
    const mo = new MutationObserver(name);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
}

export function ShellWalletProviders({ cluster, children }: { cluster: string; children: ReactNode }) {
  useNamedWalletDialog();
  const endpoint = useMemo(() => walletEndpoint(cluster, { NEXT_PUBLIC_BURNTICKER_RPC_URL: process.env.NEXT_PUBLIC_BURNTICKER_RPC_URL }), [cluster]);
  // 2026-10-15: the proxy endpoint has no websocket; subscriptions go to the public cluster's wss (walletShell.ts walletWsEndpoint)
  const config = useMemo(() => { const wsEndpoint = walletWsEndpoint(cluster, { NEXT_PUBLIC_BURNTICKER_RPC_URL: process.env.NEXT_PUBLIC_BURNTICKER_RPC_URL }); return wsEndpoint ? { commitment: "confirmed" as const, wsEndpoint } : { commitment: "confirmed" as const }; }, [cluster]);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      {/* autoConnect: a wallet the visitor already approved for this site reconnects silently on reload (owner, 2026-10-12: a reload dropped the connection); nothing is signed by connecting */}
      <WalletProvider wallets={wallets} autoConnect={true}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
