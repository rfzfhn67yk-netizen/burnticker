import "server-only";
import type { Platform } from "@/lib/burnticker/server";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { isSolanaAddress, verifyMint, type MintFacts, type MintVerification } from "@/lib/burnticker/verifyMint";

/**
 * The facts verifyMint.ts decides on, read from this host: the registry row for the mint, and the program's TokenConfig through the
 * platform's own program client (the read-only ProgramBurnClient with a deployed program id + RPC). The FAKE program client never
 * counts as a program read — it would vouch for its own placeholders — so on a host without the program the answer says the program
 * was not read. Memoised 60 s per mint (a chain read per paste is the expensive part).
 */
const memo = new Map<string, { at: number; v: MintVerification }>();
const TTL_MS = 60_000;

export async function mintFacts(p: Platform, mint: string, o: { programRead?: boolean } = {}): Promise<MintFacts> {
  const programRead = o.programRead ?? !(p.program instanceof FakeBurnProgram);
  const t = p.registry.token(mint);
  let program: MintFacts["program"] = "unread";
  if (programRead) {
    try {
      const c = await p.program.port(mint).config();
      program = c ? { config: c.config, rulesSha256: c.rulesSha256, readings: c.readings, burns: c.burns } : null;
    } catch { program = "unread"; }
  }
  const coin = t ? (() => {
    const rs = p.registry.receipts(t.mint);
    return { ticker: t.ticker, name: t.name, status: t.status, creator: t.creator, launchedAt: t.launchTx ? t.baselineAt : null, rulesSha256: t.rulesSha, receipts: rs.length, burns: rs.filter((b) => b.status === "confirmed" && (b.burnRaw ?? BigInt(0)) > BigInt(0)).length, platformId: t.platformId };
  })() : null;
  return { mint, cluster: p.cluster, programId: p.program.programId, program, coin };
}

export async function verifyMintOn(p: Platform, mint: string, now = Date.now(), o: { programRead?: boolean } = {}): Promise<MintVerification> {
  const m = mint.trim();
  if (!isSolanaAddress(m)) return verifyMint({ mint: m, cluster: p.cluster, programId: p.program.programId, program: "unread", coin: null }, now);
  const hit = memo.get(m);
  if (hit && now - hit.at < TTL_MS && o.programRead === undefined) return hit.v;
  const v = verifyMint(await mintFacts(p, m, o), now);
  if (memo.size > 2000) memo.clear();
  if (o.programRead === undefined) memo.set(m, { at: now, v });
  return v;
}

/** For tests. */
export function clearVerifyMintMemo(): void { memo.clear(); }
