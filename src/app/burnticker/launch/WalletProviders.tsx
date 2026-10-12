"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Wallet providers for the launch wizard only (the rest of the app has none). @solana/wallet-adapter-react is already a dependency;
 * wallets are discovered through the Wallet Standard (no wallets package needed), so nothing heavy was added. The RPC here is only for
 * the adapter's connection object; the wizard never sends from it until a bundle says `ready: true`.
 */
/**
 * Launch audit 5 L08: the adapter's wallet list draws its close button with no accessible name. This names it (and the list itself)
 * whenever the dialog appears; the adapter keeps handling Escape.
 */
function useNamedWalletDialog() {
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

export function WalletProviders({ children }: { children: ReactNode }) {
  useNamedWalletDialog();
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_BURNTICKER_RPC_URL || "https://api.devnet.solana.com", []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
