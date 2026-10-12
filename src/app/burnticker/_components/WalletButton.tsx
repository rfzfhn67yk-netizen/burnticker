"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ME_HREF, WALLET_COPY, shortAddress } from "@/lib/burnticker/walletShell";

/**
 * THE HEADER'S "CONNECT WALLET" (website-13, 2026-10-12; src/lib/burnticker/walletShell.ts). Disconnected, it opens the wallet adapter's
 * list. Connected, it shows the short address; pressing it opens a small menu with "Your coins", "Copy address" and "Disconnect".
 * Keyboard: Enter or Space opens the menu, focus moves to its first item, Escape closes it and returns focus, and a click outside closes
 * it. It never depends on whether creator launches are open, and it is never shown disabled.
 */
/**
 * Open the wallet list and connect the wallet picked there. The provider does not auto-connect: opening clears any earlier pick, a
 * wallet picked in the list is connected once when the list closes, and closing the list without a pick connects nothing. Shared by
 * the header button and "Your coins" (which opens the list on arrival from a static page's Connect wallet).
 */
export function useOpenWalletList(): () => void {
  const { connected, connecting, connect, select, wallet } = useWallet();
  const { setVisible, visible } = useWalletModal();
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!asked || visible) return;
    setAsked(false);
    if (wallet && !connected && !connecting) void connect().catch(() => undefined);
  }, [asked, wallet, connected, connecting, visible, connect]);
  return () => { select(null); setAsked(true); setVisible(true); };
}

export function WalletButton({ variant = "header" }: { variant?: "header" | "menu" }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const openList = useOpenWalletList();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const addr = publicKey?.toBase58() ?? null;
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); } };
    const onClick = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);
  useEffect(() => { if (!connected) setOpen(false); }, [connected]);
  const cls = variant === "menu" ? "bt-wallet bt-wallet-menu" : "bt-wallet";

  if (!connected || !addr) {
    return (
      <button type="button" className={cls} onClick={openList} title={WALLET_COPY.note} data-wallet-button data-wallet-state={connecting ? "connecting" : "disconnected"} aria-busy={connecting || undefined}>
        {connecting ? WALLET_COPY.connecting : WALLET_COPY.connect}
        {variant === "header" && <span className="sr-only">. {WALLET_COPY.note}</span>}
      </button>
    );
  }
  return (
    <div className="bt-wallet-box" ref={box}>
      <button type="button" ref={btn} className={`${cls} is-connected`} aria-haspopup="menu" aria-expanded={open} aria-controls={`bt-wallet-menu-${variant}`} onClick={() => setOpen((o) => !o)} data-wallet-button data-wallet-state="connected" title={`${wallet?.adapter.name ?? "Wallet"} connected: ${addr}`}>
        <span className="bt-wallet-dot" aria-hidden="true" />{shortAddress(addr)}<span className="sr-only">, {wallet?.adapter.name ?? "wallet"} connected. Open the wallet menu.</span>
      </button>
      <div id={`bt-wallet-menu-${variant}`} ref={menu} className="bt-wallet-pop" role="menu" hidden={!open}>
        <Link role="menuitem" href={ME_HREF} onClick={() => setOpen(false)}>{WALLET_COPY.yourCoins}</Link>
        <button type="button" role="menuitem" onClick={() => { navigator.clipboard?.writeText(addr).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => setCopied(false)); }}>{copied ? WALLET_COPY.copied : WALLET_COPY.copy}</button>
        <button type="button" role="menuitem" onClick={() => { setOpen(false); void disconnect().catch(() => undefined); btn.current?.focus(); }} data-wallet-disconnect>{WALLET_COPY.disconnect}</button>
      </div>
    </div>
  );
}
