/**
 * FOLLOW A COIN'S RECEIPTS. Polls GET /v1/tokens/<TICKER>/receipts and prints every receipt it has not printed before, each with its
 * verifier call: by default the server's checks (GET /v1/tokens/<TICKER>/verify/<id>), or `--verify local` to re-run them on this
 * machine with the SDK (the settled result re-read from the source, the rule re-applied, the spend recomputed). Read-only: no key, no
 * signing, no posting. State (the receipts already printed) lives in STARTER_STATE/follow-<TICKER>.json.
 *
 *   npm run follow -- DEFICIT                  # poll every 60 s
 *   npm run follow -- DEFICIT --once           # one pass, then exit (cron-friendly)
 *   npm run follow -- DEFICIT --verify local   # verify on this machine instead of asking the server
 */
import fs from "node:fs";
import path from "node:path";
import { Burnticker, type ReceiptJson } from "./sdk.ts";
import { config, isMain, parseArgs, type StarterConfig } from "./config.ts";

export type VerifyMode = "server" | "local" | "none";
export interface FollowState { ticker: string; seen: string[] }

/** The key a receipt is remembered by: its event id plus its status, so a planned receipt that later confirms prints again. */
export const receiptKey = (r: Pick<ReceiptJson, "eventId" | "status">): string => `${r.eventId}|${r.status}`;

export function newReceipts(state: FollowState, receipts: readonly ReceiptJson[]): ReceiptJson[] {
  const seen = new Set(state.seen);
  return receipts.filter((r) => !seen.has(receiptKey(r)));
}

/** One receipt as two or three plain lines (what happened, the proof links, the verifier call). No price, no call to buy. */
export function formatReceipt(ticker: string, r: ReceiptJson, api: string, verdict: string | null): string {
  const what = r.status === "confirmed"
    ? `$${ticker} burned ${r.burned ?? "0"} · ${r.units} unit${r.units === 1 ? "" : "s"} · ${r.market} settled ${(r.result ?? r.value ?? "—").toString().toUpperCase()}`
    : `$${ticker} ${r.status}${r.skippedReason ? ` (${r.skippedReason})` : ""} · ${r.market}`;
  const proof = [r.txUrl ? `tx ${r.txUrl}` : null, r.settlementSourceUrl ? `source ${r.settlementSourceUrl}` : null].filter(Boolean).join(" · ");
  const verify = `verify: curl -s ${api}/tokens/${encodeURIComponent(ticker)}/verify/${encodeURIComponent(r.eventId)}`;
  return [`${r.settledAt.slice(0, 10)}  ${what}`, proof ? `            ${proof}` : null, `            ${verify}${verdict ? `  →  ${verdict}` : ""}`].filter(Boolean).join("\n");
}

export function loadState(dir: string, ticker: string): FollowState {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, `follow-${ticker}.json`), "utf8")) as FollowState; return { ticker, seen: Array.isArray(j.seen) ? j.seen : [] }; } catch { return { ticker, seen: [] }; }
}
export function saveState(dir: string, s: FollowState): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `follow-${s.ticker}.json`), `${JSON.stringify(s, null, 2)}\n`);
}

async function verdictFor(bt: Burnticker, ticker: string, r: ReceiptJson, mode: VerifyMode, coin: { rulesText: string; mint: string } | null): Promise<string | null> {
  if (mode === "none" || r.status !== "confirmed") return null;
  try {
    const v = mode === "server" ? await bt.verifyOnServer(ticker, r.eventId) : await bt.verifyReceipt(r, { ticker, rulesText: coin!.rulesText, mint: coin!.mint });
    const failed = v.checks.filter((c) => c.ok === false).map((c) => c.id);
    const open = v.checks.filter((c) => c.ok === null).map((c) => c.id);
    return v.verified ? `verified (${mode})${open.length ? `; not checkable here: ${open.join(", ")}` : ""}` : `NOT verified (${mode}): ${failed.join(", ") || "see the checks"}`;
  } catch (e) { return `verifier unavailable: ${(e as Error).message.slice(0, 120)}`; }
}

/** One poll: returns the lines printed for the receipts that were new, and the updated state. */
export async function followOnce(bt: Burnticker, ticker: string, state: FollowState, o: { api: string; verify: VerifyMode }): Promise<{ lines: string[]; state: FollowState }> {
  const { receipts } = await bt.receipts(ticker);
  const fresh = newReceipts(state, receipts);
  const coin = o.verify === "local" && fresh.some((r) => r.status === "confirmed") ? await bt.token(ticker).then((t) => ({ rulesText: t.rulesText, mint: t.status.mint })) : null;
  const lines: string[] = [];
  for (const r of fresh) lines.push(formatReceipt(ticker, r, o.api, await verdictFor(bt, ticker, r, o.verify, coin)));
  return { lines, state: { ticker, seen: [...state.seen, ...fresh.map(receiptKey)] } };
}

export async function main(argv: readonly string[], cfg: StarterConfig = config(), bt = new Burnticker({ apiBase: cfg.api }), log: (s: string) => void = console.log): Promise<void> {
  const { pos, opt } = parseArgs(argv);
  const ticker = (pos[0] ?? "").toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(ticker)) throw new Error("usage: follow <TICKER> [--once] [--interval 60] [--verify server|local|none]");
  const verify = (typeof opt.verify === "string" ? opt.verify : "server") as VerifyMode;
  if (!["server", "local", "none"].includes(verify)) throw new Error("--verify is server, local or none");
  const every = Math.max(15, Number(opt.interval ?? 60)) * 1000;
  let state = loadState(cfg.stateDir, ticker);
  log(`following $${ticker} on ${cfg.api} (${state.seen.length} receipt(s) already printed; verifier: ${verify})`);
  for (;;) {
    try {
      const r = await followOnce(bt, ticker, state, { api: cfg.api, verify });
      for (const l of r.lines) log(l);
      state = r.state; saveState(cfg.stateDir, state);
    } catch (e) { log(`poll failed: ${(e as Error).message.slice(0, 200)} — retrying`); }
    if (opt.once) return;
    await new Promise((res) => setTimeout(res, every));
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error((e as Error).message); process.exit(1); });
