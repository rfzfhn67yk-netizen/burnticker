"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Wallet providers for the creator dashboard (read-only: it only reads the connected public key; nothing is signed). @solana/wallet-adapter-react is already a dependency;
 * wallets are discovered through the Wallet Standard (no wallets package needed), so nothing heavy was added. The RPC here is only for
 * the adapter's connection object; the wizard never sends from it until a bundle says `ready: true`.
 */
export default function CreatorLayout({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_BURNTICKER_RPC_URL || "https://api.devnet.solana.com", []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
