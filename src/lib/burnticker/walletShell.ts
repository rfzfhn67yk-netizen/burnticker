/**
 * THE SITE-WIDE WALLET CONNECTION (website-13, 2026-10-12; owner decision on Claude site audit 2 item 6, and the owner's "make sure we
 * can connect wallets"). One wallet-adapter provider is mounted once, in the app shell (config/public-repo/overlay/src/app/layout.tsx →
 * src/app/burnticker/_components/ShellWalletProviders.tsx). The header's "Connect wallet" is the real adapter button on every page, to
 * the right of "Launch a coin". Connecting is independent of whether creator launches are open: it shares a public address and signs
 * nothing. The one page it unlocks is "Your coins" (/burnticker/me). The static pages (/, the $DEFICIT site) cannot load the app's
 * wallet bundle, so their button opens /burnticker/me with the wallet list already open (?connect=1).
 *
 * Pure and client-safe: the words, the endpoint choice, the short address and the "Your coins" page's state machine (tested in
 * test/burntickerWallet.test.ts; the components only render what these return).
 */
import { WALLET } from "@/lib/burnticker/siteNav.mjs";

export const WALLET_COPY = {
  connect: WALLET.label,
  connecting: "Connecting",
  disconnect: "Disconnect",
  copy: "Copy address",
  copied: "Address copied",
  yourCoins: "Your coins",
  /** The header's explanation (hover and screen readers): what connecting does and the one page it opens. */
  note: WALLET.note,
  /** The phone menu's line above the button. */
  menuNote: WALLET.menuNote,
  /** "Your coins" while no wallet is connected. */
  prompt: "View a wallet's created coins without signing a transaction.",
  lookup: "You can also look up any creator address without connecting.",
} as const;

/** Where the static pages send "Connect wallet": the app page that holds the adapter, with its wallet list opened on arrival. */
export const STATIC_CONNECT_HREF: string = WALLET.href;
export const ME_HREF = "/burnticker/me";

/** "AJJ4…4oqj" from a base58 address. */
export const shortAddress = (a: string): string => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

type Env = Readonly<Record<string, string | undefined>>;
const PUBLIC_RPC: Record<string, string> = { mainnet: "https://api.mainnet-beta.solana.com", devnet: "https://api.devnet.solana.com", localnet: "http://127.0.0.1:8899" };

/** The adapter's RPC: the public browser RPC setting when one is set, else the public endpoint of the host's own network. */
export function walletEndpoint(cluster: string, env: Env = {}): string {
  const set = (env.NEXT_PUBLIC_BURNTICKER_RPC_URL ?? "").trim();
  return set || PUBLIC_RPC[cluster] || PUBLIC_RPC.mainnet;
}

/**
 * The site's own RPC proxy on the page's OWN origin (2026-10-16, the operator claim page through an ssh tunnel): the baked endpoint names
 * the public site (https://burnticker.com/api/burnticker/rpc), and a page served from another origin (localhost through a tunnel, the
 * operator network address) cannot call it: the proxy refuses cross-origin POSTs (rpcProxy.ts, Cloudflare rule 1) and the browser reports
 * "Failed to fetch". The same proxy answers on every origin that serves the app, so a proxy endpoint is rewritten to the page's origin.
 * Any other endpoint (a public cluster URL) is left alone. Pure: pass `origin` (the page's) explicitly; the providers pass location.origin.
 */
export const RPC_PROXY_PATH = "/api/burnticker/rpc";
export function sameOriginProxy(endpoint: string, origin: string | undefined): string {
  if (!origin) return endpoint;
  try {
    const u = new URL(endpoint);
    if (u.pathname !== RPC_PROXY_PATH) return endpoint;
    if (u.origin === origin) return endpoint;
    return `${origin}${RPC_PROXY_PATH}`;
  } catch { return endpoint; }
}

/**
 * The adapter's websocket (2026-10-15: the browser logged "ws error" dozens of times a page). With NEXT_PUBLIC_BURNTICKER_RPC_URL set the
 * HTTP endpoint is this site's own proxy (/api/burnticker/rpc, rpcProxy.ts), which forwards POSTs only, so web3.js's derived wss://<site>/api/burnticker/rpc
 * never opens and reconnects forever. Subscriptions (confirmTransaction's signature notice) go to the public cluster's websocket instead,
 * an origin the app's CSP already allows (csp.ts connect-src). No key is in it. Without the setting the endpoint is the public cluster's
 * own and web3.js derives the same wss itself (undefined here). Localnet keeps web3.js's own derivation.
 */
export const PUBLIC_WS: Record<string, string> = { mainnet: "wss://api.mainnet-beta.solana.com", devnet: "wss://api.devnet.solana.com" };
export function walletWsEndpoint(cluster: string, env: Env = {}): string | undefined {
  if (!(env.NEXT_PUBLIC_BURNTICKER_RPC_URL ?? "").trim()) return undefined;
  return PUBLIC_WS[cluster] ?? (cluster === "localnet" ? undefined : PUBLIC_WS.mainnet);
}

/** True when a page's address asks for the wallet list on arrival (the static pages' deep link). */
export const wantsConnect = (search: string): boolean => /(?:^|[?&])connect=1(?:&|$)/.test(search);

const PUB = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isAddress = (s: string): boolean => PUB.test(s.trim());

export interface MeInput {
  connected: boolean; connecting: boolean; publicKey: string | null; pasted: string;
  busy: boolean; error: string | null; data: { wallet: string; coins: unknown[]; pairs: unknown[] } | null;
}
export type MeState =
  | { kind: "prompt" }
  | { kind: "connecting" }
  | { kind: "loading"; wallet: string; source: "connected" | "pasted" }
  | { kind: "error"; wallet: string; source: "connected" | "pasted"; message: string }
  | { kind: "empty"; wallet: string; source: "connected" | "pasted" }
  | { kind: "list"; wallet: string; source: "connected" | "pasted"; coins: number; pairs: number };

/** The wallet "Your coins" reads: the connected one first, else a pasted address; null when neither. */
export function meWallet(i: Pick<MeInput, "connected" | "publicKey" | "pasted">): { wallet: string; source: "connected" | "pasted" } | null {
  if (i.connected && i.publicKey) return { wallet: i.publicKey, source: "connected" };
  return isAddress(i.pasted) ? { wallet: i.pasted.trim(), source: "pasted" } : null;
}

/** What "Your coins" shows. Disconnected and nothing pasted: the connect prompt, never an empty list. */
export function meState(i: MeInput): MeState {
  const w = meWallet(i);
  if (!w) return i.connecting ? { kind: "connecting" } : { kind: "prompt" };
  if (i.error) return { kind: "error", ...w, message: i.error };
  if (i.busy || !i.data || i.data.wallet !== w.wallet) return { kind: "loading", ...w };
  if (i.data.coins.length === 0 && i.data.pairs.length === 0) return { kind: "empty", ...w };
  return { kind: "list", ...w, coins: i.data.coins.length, pairs: i.data.pairs.length };
}
