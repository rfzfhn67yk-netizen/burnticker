import { matchesSuffix } from "@/lib/burnticker/mintSuffix";
import type { GrindSnapshot } from "@/lib/burnticker/vanityMint";

/**
 * The words around the burn-ending mint address (owner, 2026-10-14; vanityMint.ts, mintBank.ts). Plain English, lint clean
 * (test/burntickerVanityMint.test.ts, test/burntickerMintBank.test.ts).
 *
 * Owner, 2026-10-14 night: "the BURN vanity address is mandatory. Save them like pump.fun does so they launch instantly." Every coin made
 * here gets an address that ends in burn. The site prepares the keys ahead of time (the mint key bank) and hands one to each creator at
 * launch; when none is ready, the creator's browser finds one, and the search panel below shows it working (a count, the seconds, how
 * many searches run at once, redrawn several times a second). There is no plain address any more. A coin page says its own address
 * ends in burn only when it does (coins made before 2026-10-14 have plain ones).
 */

export const MINT_SEARCH_LINE = "No prepared address was ready, so this browser is finding one that ends in burn. This usually takes under a minute.";
export const MINT_SEARCH_PAIR_LINE = "No prepared addresses were ready, so this browser is finding two that end in burn, one for each coin. This usually takes about a minute.";
export const MINT_SEARCH_DEVICE_LINE = "That is on a laptop. A phone can take a few minutes.";
export const MINT_SEARCH_PRIVATE_LINE = "The search runs in this browser, and the key it finds never leaves it.";
export const MINT_FAILED_LINE = "This browser could not run the address search, so nothing was sent. Please try again in a few minutes, when the site has prepared addresses ready again.";
/** The general line (the launch review, the sign card and a coin page whose address ends in burn). */
export const MINT_ADDRESS_NOTE = "Every coin made here gets an address that ends in burn. The address is prepared ahead of time on this site, handed to the creator at launch and used once. If none is ready, the creator's browser finds one.";
/**
 * THE DISCLOSURE (owner, 2026-10-14 night): wherever the launch flow says what the site controls. The launch review's "What you confirm
 * by launching", the trust page, the operator page and the whitepaper's custody section carry it (each pinned in a test).
 */
export const MINT_KEY_DISCLOSURE = "Every coin made here gets an address that ends in burn. This site prepares those mint keys ahead of time, keeps them encrypted, hands each one to its creator once at launch and deletes it 24 hours later if that launch does not happen. Until the coin is created the key only decides the address; it cannot move anything. The creator's wallet still signs the launch, and the key is never used for anything but creating that one mint. When no prepared key is ready, the creator's browser finds one instead, and that key never leaves the browser. Other launchpads prepare addresses the same way.";
/** The trust page's "How this was built" sentence: the disclosure itself. */
export const MINT_ADDRESS_TRUST = MINT_KEY_DISCLOSURE;

const n = (x: number) => Math.round(x).toLocaleString("en-US");

/** "Tried 1,234,567 addresses in 12 seconds, using 9 searches at once." */
export function mintSearchProgress(s: Pick<GrindSnapshot, "tries" | "elapsedMs" | "workers">): string {
  const sec = Math.floor(s.elapsedMs / 1000);
  return `Tried ${n(s.tries)} address${s.tries === 1 ? "" : "es"} in ${sec} second${sec === 1 ? "" : "s"}, using ${s.workers} search${s.workers === 1 ? "" : "es"} at once.`;
}

/** The found line: one address, or each side's. */
export function mintFoundLine(addresses: readonly string[]): string {
  if (!addresses.length) return "";
  return addresses.length === 1 ? `Found an address that ends in burn: ${addresses[0]}.` : `Found ${addresses.length} addresses that end in burn: ${addresses.join(" and ")}.`;
}

/** A coin page's line, only for a coin whose own mint ends in burn or BURN (never a plain one). */
export function coinAddressLine(mint: string): string | null {
  if (!matchesSuffix(mint)) return null;
  return `This coin's address ends in ${mint.slice(-4)}. Every coin made here gets an address that ends in burn.`;
}

export interface MintSearchView {
  state: "idle" | "searching" | "found" | "failed";
  lines: string[];
  /** the live counter line while searching */
  progress: string | null;
}

/** What the search panel shows for a pool snapshot (MintSearch.tsx draws it; the tests read it). Idle (no panel) unless a search ran. */
export function mintSearchView(s: GrindSnapshot): MintSearchView {
  const pair = s.wanted > 1;
  if (s.failed && s.found < s.wanted) return { state: "failed", lines: [MINT_FAILED_LINE], progress: null };
  if (s.wanted > 0 && s.found >= s.wanted) return { state: "found", lines: [mintFoundLine(s.addresses)], progress: null };
  if (!s.running) return { state: "idle", lines: [], progress: null };
  return {
    state: "searching",
    lines: [pair ? MINT_SEARCH_PAIR_LINE : MINT_SEARCH_LINE, MINT_SEARCH_DEVICE_LINE, ...(pair && s.found ? [`${s.found} of ${s.wanted} found.`] : [])],
    progress: mintSearchProgress(s),
  };
}

/**
 * Shown under the Launch button from the press until the wallet opens (owner, 2026-10-14: "people need to know the coin is launching
 * while it builds so they don't exit out"). The prepare step pins the coin's art and rule on Arweave and runs the pre-launch check,
 * which can take up to a minute.
 */
export const LAUNCHING_NOTICE = "Your coin is being prepared: its art and rule are being pinned on Arweave and the pre-launch check is running. This can take up to a minute. Keep this tab open; your wallet opens when it is ready.";

/** Above the Launch button when a launch signs more than one transaction (owner, 2026-10-14: say so before the wallet opens). */
export const signsLine = (n: number): string => `Your wallet asks ${n} times, once for each transaction, in order. Progress is kept between them, so a later step can be retried without redoing an earlier one.`;
