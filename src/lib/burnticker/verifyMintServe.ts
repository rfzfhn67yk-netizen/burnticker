import "server-only";
import type { Platform } from "@/lib/burnticker/server";
import { isSolanaAddress, verifyMint, type MintFacts, type MintVerification } from "@/lib/burnticker/verifyMint";
import { PROGRAM_IDS, type Network } from "@/lib/burnticker/networks";
import { chainRegistrationReader, disclosedCoins, readAllRegistrations, type RegistrationReader } from "@/lib/burnticker/mintRegistration";

/**
 * The facts verifyMint.ts decides on, read from this host (website audit 4, BT-01): the registry row for the mint (the catalogue, on the
 * network the host reads) and the burn_receipts TokenConfig on EVERY network, read with a plain getAccountInfo against the canonical
 * per-network program ids (networks.ts — the same configuration as the receipt verifier). The host's own program client and its
 * BURNTICKER_PROGRAM_ID are not consulted: a host without them used to report the fake client's placeholder id and a definitive "not
 * registered". A failed read is "unavailable" (Unable to verify), never "no". Memoised 60 s per mint.
 */
const memo = new Map<string, { at: number; v: MintVerification }>();
const TTL_MS = 60_000;
let readerOverride: RegistrationReader | null = null;
/** For tests: replace the chain reader (null restores the RPC reader). */
export function setRegistrationReaderForTests(r: RegistrationReader | null): void { readerOverride = r; memo.clear(); }

const hostNet = (p: Pick<Platform, "cluster">): Network => (p.cluster === "mainnet" ? "mainnet" : "devnet");

export async function mintFacts(p: Platform, mint: string, o: { reader?: RegistrationReader } = {}): Promise<MintFacts> {
  const net = hostNet(p);
  const networks = await readAllRegistrations(mint, o.reader ?? readerOverride ?? chainRegistrationReader());
  const h = networks.find((n) => n.network === net)!;
  const program: MintFacts["program"] = h.state === "registered" ? { config: h.config!, rulesSha256: h.rulesSha256!, readings: h.readings ?? 0, burns: h.burns ?? 0 } : h.state === "not-registered" ? null : "unread";
  const t = p.registry.token(mint);
  const coin = t ? (() => {
    const rs = p.registry.receipts(t.mint);
    return { ticker: t.ticker, name: t.name, status: t.status, creator: t.creator, launchedAt: t.launchTx ? t.baselineAt : null, rulesSha256: t.rulesSha, receipts: rs.length, burns: rs.filter((b) => b.status === "confirmed" && (b.burnRaw ?? BigInt(0)) > BigInt(0)).length, platformId: t.platformId };
  })() : null;
  const d = disclosedCoins().find((c) => c.mint === mint) ?? null;
  return { mint, cluster: net, programId: PROGRAM_IDS[net].burn_receipts, program, networks, disclosed: d ? { network: d.network, ticker: d.ticker, label: d.label } : null, coin };
}

export async function verifyMintOn(p: Platform, mint: string, now = Date.now(), o: { reader?: RegistrationReader } = {}): Promise<MintVerification> {
  const m = mint.trim();
  const net = hostNet(p);
  if (!isSolanaAddress(m)) return verifyMint({ mint: m, cluster: net, programId: PROGRAM_IDS[net].burn_receipts, program: "unread", coin: null }, now);
  const hit = memo.get(m);
  if (hit && now - hit.at < TTL_MS && !o.reader) return hit.v;
  const v = verifyMint(await mintFacts(p, m, o), now);
  if (memo.size > 2000) memo.clear();
  // an unavailable read is not memoised: the next paste retries the chain
  if (!o.reader && v.verdict !== "unavailable") memo.set(m, { at: now, v });
  return v;
}

/** For tests. */
export function clearVerifyMintMemo(): void { memo.clear(); }
