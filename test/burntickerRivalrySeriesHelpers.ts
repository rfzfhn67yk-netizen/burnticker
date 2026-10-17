// Shared world for the rivalry-series tests (test/burntickerRivalrySeries*.test.ts): a synthetic NBA league schedule (the league's own cdn
// feed, read here because the client has no TheSportsDB key: the cdn is the fallback when it answers, espn.ts probe note; the live cdn
// answers 403 since 2026-10-12, test/burntickerNbaSchedule.test.ts covers that path), a fake moneyline market per game paying the side with more points (a level score: a split,
// read as a draw), and a winner-takes-the-burn pair of two LaunchLab coins on the two mirror series. Not a test file itself. No network.
import { Keypair } from "@solana/web3.js";
import { openRegistry, type Registry, type TokenRow } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import { buildPairBundles, FakeLaunchLab } from "@/lib/burnticker/launchBundle";
import { CatalogueAdapter } from "@/lib/burnticker/catalogue";
import type { KeeperDeps } from "@/lib/burnticker/multiKeeper";
import { EspnClient, NBA_LEAGUE_SCHEDULE, meetingsPairSeries } from "@/lib/burnticker/sources/espn";
import { nativeRule, setNativeClients } from "@/lib/burnticker/sources/native";
import { memoryFirstReadStore, type GameDeps } from "@/lib/burnticker/sources/gameSettle";
import { DEFAULT_ON_END, lockRule, WIND_DOWN_ON_END, type BurnRule } from "@/lib/burnticker/rules";
import type { FetchLike, OracleAdapter } from "@/lib/burnticker/oracle/types";

export const CREATOR = "CreatorWa11et111111111111111111111111111111";
export const ATTESTER = "KeeperDataKey1111111111111111111111111111111";
const TEAMS: Record<string, { city: string; name: string }> = { PHI: { city: "Philadelphia", name: "76ers" }, BOS: { city: "Boston", name: "Celtics" }, NYK: { city: "New York", name: "Knicks" }, MIA: { city: "Miami", name: "Heat" } };
/** One listed game: home, away, scores; `post` = a playoff game (id 004…); `status` 1 with "Cancelled" text = a cancelled game. */
export interface G { id: string; at: string; home: string; away: string; hs?: number | null; as?: number | null; post?: boolean; status?: 1 | 2 | 3; text?: string }
let seq = 0;
export const game = (at: string, home: string, away: string, hs: number | null, as_: number | null, o: Partial<G> = {}): G => ({ id: `${o.post ? "004" : "002"}25${String(++seq).padStart(5, "0")}`, at, home, away, hs, as: as_, ...o });
export function nbaBody(games: readonly G[]): unknown {
  const side = (abbr: string, score: number | null | undefined) => ({ teamTricode: abbr, teamCity: TEAMS[abbr].city, teamName: TEAMS[abbr].name, score: score ?? 0 });
  return { leagueSchedule: { seasonYear: "2025-26", gameDates: [{ games: games.map((g) => ({ gameId: g.id, gameDateTimeUTC: g.at, gameStatus: g.status ?? 3, gameStatusText: g.text ?? (g.status === 1 ? "7:00 pm ET" : "Final"), homeTeam: side(g.home, g.hs), awayTeam: side(g.away, g.as) })) }] } };
}
/** Both teams' other games: PHI's season ends 2026-04-12 (no playoffs beyond the meetings); BOS plays NYK in the playoffs until 2026-05-20. */
export const FILLER: G[] = [
  game("2025-10-22T23:00:00Z", "PHI", "NYK", 110, 100), game("2026-04-12T23:00:00Z", "MIA", "PHI", 101, 99),
  game("2025-10-23T23:00:00Z", "BOS", "MIA", 120, 100), game("2026-05-12T23:00:00Z", "NYK", "BOS", 99, 104, { post: true }), game("2026-05-20T23:00:00Z", "BOS", "NYK", 90, 95, { post: true }),
];
/** The day after the later season's last game (BOS, 2026-05-20). */
export const END_DAY = "2026-05-21";
/** After both seasons and the 4-day grace. */
export const AFTER = Date.parse("2026-06-01T12:00:00Z");

/** `now`: the world's clock, which a game coin's 12 hours after the first read (gameSettle.ts gameSchedule) is measured on. */
export function fakeDeps(games: readonly G[], now: () => number = Date.now): GameDeps {
  return {
    tsdbKey: null, apiSportsKey: null, firstReads: memoryFirstReadStore(), now,
    market: async (g) => ({ conditionId: `0x${g.eventId.padStart(64, "0")}`, question: `${g.away.name} vs. ${g.home.name}`, outcomes: [g.home.name, g.away.name], url: `https://polymarket.com/event/nba-${g.eventId}` }),
    payout: async (id) => { const g = games.find((x) => `0x${x.id.padStart(64, "0")}` === id); if (!g || g.status === 1) return { resolved: false, outcome: null }; return { resolved: true, outcome: (g.hs ?? 0) > (g.as ?? 0) ? 0 : (g.hs ?? 0) < (g.as ?? 0) ? 1 : null }; },
  };
}
export function scheduleClient(games: readonly G[], now: () => number): EspnClient {
  const body = nbaBody(games);
  const fetchImpl: FetchLike = async (url) => (url === NBA_LEAGUE_SCHEDULE ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) });
  return new EspnClient({ fetchImpl, now, minIntervalMs: 0, ttlMs: 0, tsdbKey: null });
}
const stubOracle: OracleAdapter = { id: "stub", searchSeries: async () => [], seriesInfo: async () => null, settledSince: async () => ({ events: [], awaitingFinal: 0, refusals: [], settlementSourceUrl: null }), impliedChance: async () => ({ chance: null, marketTicker: null, closeTime: null, basis: "stub" }) };

export const SERIES = meetingsPairSeries("nba", "PHI", "BOS", 2026);
export const meetingsRule = (series: string = SERIES.a, f = 0.02): BurnRule => ({ ...nativeRule(series, { fractionOfPool: f }), onEnd: { ...DEFAULT_ON_END } } as BurnRule);

export interface RivalWorld { registry: Registry; program: FakeBurnProgram; deps: KeeperDeps; clock: { now: number }; a: TokenRow; b: TokenRow; pairId: string; logs: string[]; flagship: string }
/** $PHIVBOS (side A, PHI's series) and $BOSVPHI (side B, the mirror), both pinned to the pair-winner end sink, and a live $DEFICIT stand-in. */
export async function rivalWorld(games: readonly G[], o: { now?: number } = {}): Promise<RivalWorld> {
  const registry = openRegistry(":memory:");
  const program = new FakeBurnProgram("devnet");
  program.autoRegisterPool = true; program.pinEndSinks = true;
  const clock = { now: o.now ?? AFTER };
  program.now = () => clock.now;
  const logs: string[] = [];
  const all = [...games, ...FILLER];
  setNativeClients({ espn: scheduleClient(all, () => clock.now), games: fakeDeps(all, () => clock.now) });
  const pr = await buildPairBundles({ a: { creator: CREATOR, ticker: "PHIVBOS", name: "76ers vs Celtics, 76ers side", description: "", imageUrl: null, links: [], rule: meetingsRule(), firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, cluster: "devnet" }, b: { ticker: "BOSVPHI", name: "Celtics vs 76ers, Celtics side", description: "", imageUrl: null, links: [] }, voidBy: "2026-12-31" },
    { program, launchLab: new FakeLaunchLab(), devFeeWallet: null, attesters: [ATTESTER], quorum: 1, metadataUri: (m) => `https://x/${m}.json` });
  const reg = (bundle: typeof pr.a, ticker: string) => {
    const t = registry.register({ mint: bundle.mint, ticker, name: ticker, creator: CREATOR, description: bundle.description, imageUrl: null, links: [], rulesText: bundle.rules.text, feePda: bundle.addresses.feePda, vault: bundle.addresses.vault, tokenConfig: bundle.addresses.tokenConfig, poolId: bundle.addresses.poolId, launchTx: null, cluster: "devnet", platformId: null, baselineAt: "2025-10-01T00:00:00Z", status: "draft" }, Date.parse("2025-10-01T00:00:00Z"));
    registry.markLaunched(t.mint, `launch${ticker}`, bundle.addresses.poolId, "2025-10-01T00:00:00Z");
    registry.addAttester({ mint: t.mint, pubkey: ATTESTER, role: "data-key", addedAt: 0, timelockUntil: null });
    program.supplies.set(t.mint, BigInt("1000000000000000"));
    if (program.tokens.has(t.mint)) program.deposit(t.mint, BigInt(5_000_000_000));
    return registry.token(t.mint)!;
  };
  const a = reg(pr.a, "PHIVBOS"), b = reg(pr.b, "BOSVPHI");
  registry.registerPair(pr.pairId, a.mint, b.mint, 0);
  const flagship = Keypair.generate().publicKey.toBase58();
  await program.initializeToken({ mint: flagship, creator: CREATOR, ticker: "DEFICIT", rulesSha256: "ab".repeat(32), selectorKey: "flagship", mode: "buyback", attesters: [ATTESTER], quorum: 1, vault: null, rule: lockRule({ ...nativeRule("nws.high:DEN-90"), onEnd: WIND_DOWN_ON_END }).rule });
  program.fake(flagship).registerPool();
  program.endSink.flagship = flagship;
  const deps: KeeperDeps = { registry, program, oracles: { kalshi: stubOracle, catalogue: new CatalogueAdapter() }, attester: ATTESTER, log: (l) => logs.push(l), now: () => clock.now, dryRun: false };
  return { registry, program, deps, clock, a, b, pairId: pr.pairId, logs, flagship };
}
