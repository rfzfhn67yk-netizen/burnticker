import { checkReceiptHref } from "@/lib/burnticker/coinPage";
import { groupDigits, shortDay } from "@/lib/burnticker/cardView";

/**
 * THE ACTIVITY ROWS (website-14, platform item 6; WEBSITE-10-11 brief rule 3: "attested readings, confirmed burns, graduations, pool
 * registrations, from the keeper's published files and the API. Never a mock row"). Four kinds, each labelled, each linking its own
 * evidence:
 *
 *   burn          a confirmed burn             its own receipt check (signature and network)
 *   reading       a reading signed on chain    its submit_reading transaction on the explorer (date, value, units, signature)
 *   graduation    the curve completed          the coin's page (the date is not read on chain here, so the row says so)
 *   pool          the pool was registered      the pool's address on the explorer (same: no date is read)
 *
 * Sources: a registered coin's status and receipts (the platform keeper, via the API), the $DEFICIT keeper's status.json and burns.json,
 * and the devnet rehearsal's evidence file. Pure and client-safe: the home API, the activity line and the coin pages' Burn log share it.
 */
// website-15 item 15: two mainnet record kinds from the operator's own files, labelled as what they are: a coin created on mainnet (its
// create transaction) and a mint address reserved before its coin exists (no date is claimed)
export type EventKind = "burn" | "reading" | "graduation" | "pool" | "created" | "reserved";
export const EVENT_LABEL: Record<EventKind, string> = { burn: "Burn", reading: "Reading", graduation: "Graduated", pool: "Pool registered", created: "Created", reserved: "Mint reserved" };

export interface ActivityEvent {
  kind: EventKind;
  /** an ISO date or time; null when the event's time is not read (graduations and pool registrations today) */
  at: string | null;
  network: "mainnet" | "devnet";
  ticker: string;
  text: string;
  href: string;
  /** the signature behind the row, when there is one */
  signature?: string | null;
}

const netOf = (cluster: string | null | undefined): "mainnet" | "devnet" => (cluster === "devnet" ? "devnet" : "mainnet");
const explorer = (net: string, id: string, kind: "tx" | "address" = "tx") => `https://explorer.solana.com/${kind}/${id}${net === "mainnet" ? "" : `?cluster=${net}`}`;
const unitsText = (n: number) => `${n === 1 ? "one unit" : `${groupDigits(n)} units`}`;
const day = (iso: string | null) => shortDay(iso) ?? iso ?? "";

/** The slice of a registered coin's status.json (pageTypes.ts TokenStatusJson) the rows need. */
export interface StatusForEvents {
  ticker: string; cluster: string;
  market?: { phase: "curve" | "migrating" | "graduated" | null; graduatedPool: string | null } | null;
  program?: { lastReading: { date: string; signature: string; txUrl?: string } | null; pool: { registered: boolean; address: string | null } } | null;
}
export interface ReceiptForEvents { status: string; settledAt: string; units: number; value: string | null; signature: string | null; readingDate?: string | null; burned?: string | null }

/** A registered coin's rows: its confirmed burns, its last signed reading, its graduation and its pool registration. */
export function eventsFromStatus(s: StatusForEvents, receipts: readonly ReceiptForEvents[] = []): ActivityEvent[] {
  const net = netOf(s.cluster), t = s.ticker, out: ActivityEvent[] = [];
  for (const r of receipts) {
    if (r.status !== "confirmed" || !r.signature) continue;
    out.push({ kind: "burn", at: r.settledAt, network: net, ticker: t, signature: r.signature, href: checkReceiptHref(r.signature, net)!, text: `$${t} burned ${r.burned ? `${groupDigits(r.burned)} tokens` : "its purchase"} on ${day(r.settledAt)}, from ${unitsText(r.units)}.` });
  }
  const lr = s.program?.lastReading ?? null;
  if (lr?.signature) {
    const same = receipts.filter((r) => r.readingDate === lr.date);
    const units = same.reduce((a, r) => a + (r.units || 0), 0);
    const value = same.find((r) => r.value !== null)?.value ?? null;
    out.push({ kind: "reading", at: lr.date, network: net, ticker: t, signature: lr.signature, href: lr.txUrl ?? explorer(net, lr.signature),
      text: `$${t}'s reading for ${day(lr.date)}${value ? `, value ${value},` : ""} was signed on chain${same.length ? `. It counted ${unitsText(units)}` : ""}.` });
  }
  if (s.market?.phase === "graduated") out.push({ kind: "graduation", at: null, network: net, ticker: t, href: `/burnticker/t/${encodeURIComponent(t)}`, text: `$${t} graduated from its curve to its Raydium pool. This site does not read the date.` });
  if (s.program?.pool.registered && s.program.pool.address) out.push({ kind: "pool", at: null, network: net, ticker: t, href: explorer(net, s.program.pool.address, "address"), text: `$${t}'s Raydium pool is registered with the burn program. This site does not read the date.` });
  return out;
}

/** The $DEFICIT keeper's rows from its status.json and burns.json (statusPage.ts StatusJson and BurnJson). Unknown shapes give no rows. */
export function eventsFromKeeper(status: unknown, burnsFile: unknown, opts: { includeBurns?: boolean } = {}): ActivityEvent[] {
  const s = status as { schema?: string; ticker?: string; cluster?: string; curve?: { phase?: string } | null; program?: { attestation?: { lastReading?: KeeperReading | null; readings?: KeeperReading[] }; pool?: { registered?: boolean; address?: string | null } } | null } | null;
  if (!s || s.schema !== "burnkeeper.status/v1") return [];
  const t = s.ticker ?? "DEFICIT", net = netOf(s.cluster === "mainnet-beta" ? "mainnet" : s.cluster), out: ActivityEvent[] = [];
  const att = s.program?.attestation;
  const readings = att?.readings?.length ? att.readings : att?.lastReading ? [att.lastReading] : [];
  for (const r of readings.slice(0, 12)) {
    if (!r.signature) continue;
    out.push({ kind: "reading", at: r.recordDate, network: net, ticker: t, signature: r.signature, href: r.txUrl ?? explorer(net, r.signature),
      text: `$${t}'s reading for ${day(r.recordDate)} was signed on chain. The debt was ${trillions(r.value)}${typeof r.units === "number" ? `, which counted ${unitsText(r.units)}` : ""}.` });
  }
  if (s.curve?.phase === "graduated") out.push({ kind: "graduation", at: null, network: net, ticker: t, href: "https://deficit.burnticker.com/", text: `$${t} graduated from its curve to its Raydium pool. This site does not read the date.` });
  if (s.program?.pool?.registered && s.program.pool.address) out.push({ kind: "pool", at: null, network: net, ticker: t, href: explorer(net, s.program.pool.address, "address"), text: `$${t}'s Raydium pool is registered with the burn program. This site does not read the date.` });
  if (opts.includeBurns) {
    const rows = Array.isArray(burnsFile) ? burnsFile : (burnsFile as { burns?: unknown[] } | null)?.burns ?? [];
    for (const b of rows as { status?: string; signature?: string | null; recordDate?: string; burned?: string | null; units?: number }[]) {
      if (b.status !== "confirmed" || !b.signature || !b.recordDate) continue;
      out.push({ kind: "burn", at: b.recordDate, network: net, ticker: t, signature: b.signature, href: checkReceiptHref(b.signature, net)!, text: `$${t} burned ${b.burned ? `${groupDigits(b.burned)} tokens` : "its purchase"} for the reading of ${day(b.recordDate)}, from ${unitsText(b.units ?? 0)}.` });
    }
  }
  return out;
}
interface KeeperReading { recordDate: string; value: string; units: number | null; signature: string | null; txUrl: string | null }
const trillions = (v: string) => { const n = Number(v); return Number.isFinite(n) ? `$${(n / 1e12).toFixed(3)} trillion` : `$${v}`; };

/** Newest first, mainnet before devnet, undated rows after the dated ones of their network; one row per signature. */
export function sortEvents(evs: readonly ActivityEvent[], limit = 12): ActivityEvent[] {
  const seen = new Set<string>();
  const uniq = evs.filter((e) => { const k = e.signature ? `${e.kind}:${e.signature}` : `${e.kind}:${e.network}:${e.ticker}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return uniq.sort((a, b) => (a.network !== b.network ? (a.network === "mainnet" ? -1 : 1) : a.at === b.at ? 0 : a.at === null ? 1 : b.at === null ? -1 : b.at.localeCompare(a.at))).slice(0, limit);
}
