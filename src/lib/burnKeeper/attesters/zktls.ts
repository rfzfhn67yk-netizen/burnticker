import { keccak256, recoverMessageAddress, stringToBytes } from "viem";
import { decimalToCents, type AttestedReading } from "@/lib/burnKeeper/attesters/types";
import { sourceForUrl, takeOrThrow } from "@/lib/burnticker/apiBudget";

/**
 * zkTLS ATTESTATION — PROTOTYPE (2026-10-09). For a tier-5 source (a page, not an API: LAUNCHPAD-PATH §2, §14) the attester is a
 * Reclaim Protocol attestor: it sits between our client and the origin during a real TLS session, sees only what the client
 * reveals, and signs a CLAIM — "an HTTPS request to <url> with <method> produced a response matching <responseMatches>, from which
 * <extractedParameters> were taken" — with its secp256k1 key. Verification here is done BY HAND (viem's keccak256 and EIP-191
 * recovery), against Reclaim's published format, so nobody has to install their SDK to check a proof:
 *
 *   identifier = keccak256(utf8(`${provider}\n${parameters}\n${canonicalJSON(context)}`))           (reclaim-js-sdk witness.ts)
 *   message    = `${identifier}\n${owner.toLowerCase()}\n${timestampS}\n${epoch}`                       (createSignDataForClaim)
 *   signer     = ecrecover(EIP-191 personal_sign(message), signature)  ∈  the attestor registry        (proofUtils.ts)
 *
 * WHAT IS CRYPTOGRAPHICALLY VERIFIED: that a key in Reclaim's attestor set signed exactly this claim (url, method, match rules, the
 * extracted values, the timestamp) — the proof cannot be edited after the fact, and the extracted value lives inside the signed
 * context. WHAT IS TRUSTED: (1) the attestor — that it really proxied a TLS session to that host and reported the match honestly
 * (the ZK/TEE machinery constrains it, but the verifier below does not re-run a circuit; a "zk" proof in Reclaim's current stack is
 * the attestor's signature plus, optionally, a GCP Confidential Space attestation of the attestor itself, which this prototype does
 * not check); (2) the attestor registry (fetched from api.reclaimprotocol.org, with a pinned copy for offline checks); (3) the origin —
 * Box Office Mojo's number is Box Office Mojo's number; (4) the regex — that it selects the row we say it selects (unit-tested on a
 * saved copy of the page). Nothing here is a consensus of independent observers; it is ONE named attestor, which is still one more
 * than the keeper alone.
 *
 * `prove` needs Reclaim's zkFetch SDK (@reclaimprotocol/zk-fetch — NOT a dependency of this repo: it pulls attestor-core, snarkjs and
 * native modules) and an app id + secret from https://dev.reclaimprotocol.org (create an application → copy "Application ID" and
 * "Application Secret"). They are read from the environment by NAME ONLY (RECLAIM_APP_ID, RECLAIM_APP_SECRET) and never logged.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Reclaim's proof format (reclaim-js-sdk interfaces.ts, 2026-10)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ReclaimClaimData { provider: string; parameters: string; owner: string; timestampS: number; context: string; identifier: string; epoch: number }
export interface ReclaimWitness { id: string; url: string }
export interface ReclaimProof {
  identifier: string;
  claimData: ReclaimClaimData;
  signatures: string[];
  witnesses: ReclaimWitness[];
  extractedParameterValues?: Record<string, string>;
  publicData?: unknown;
}

/** The attestor addresses https://api.reclaimprotocol.org/api/attestors returned on 2026-10-09 (lowercase). Refresh with `fetchReclaimAttestors`. */
export const PINNED_RECLAIM_ATTESTORS: readonly string[] = ["0x1be31a94361a391bbafb2a4ccd704f57dc04d4bb", "0x244897572368eadf65bfbc5aec98d8e5443a9072", "0x15ea90114bffea9bb996e8775bf6ca0a338e97e5"];
export const RECLAIM_ATTESTORS_URL = "https://api.reclaimprotocol.org/api/attestors";

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function fetchReclaimAttestors(fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 15_000): Promise<string[]> {
  await takeOrThrow(sourceForUrl(RECLAIM_ATTESTORS_URL));   // the request budget (apiBudget.ts)
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(RECLAIM_ATTESTORS_URL, { signal: ac.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`attestor registry HTTP ${res.status}`);
    const j = (await res.json()) as { data?: { address?: unknown }[] };
    const out = (j.data ?? []).map((x) => x.address).filter((a): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a)).map((a) => a.toLowerCase());
    if (!out.length) throw new Error("attestor registry returned no addresses");
    return out;
  } finally { clearTimeout(t); }
}

/** RFC 8785 (JSON Canonicalization Scheme) as Reclaim's `canonicalize` dependency applies it: sorted keys, no whitespace, JSON number spelling. */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return "";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** The claim identifier: keccak256 of provider, parameters and the re-canonicalised context, newline-joined. */
export function reclaimClaimIdentifier(c: Pick<ReclaimClaimData, "provider" | "parameters" | "context">): string {
  let ctx = c.context || "";
  if (ctx.length) {
    let parsed: unknown;
    try { parsed = JSON.parse(ctx); } catch { throw new Error("claim context is not JSON"); }
    ctx = canonicalJson(parsed);
  }
  return keccak256(stringToBytes(`${c.provider}\n${c.parameters}\n${ctx}`)).toLowerCase();
}

/** The exact string an attestor signs (EIP-191 personal message). */
export function reclaimSignedMessage(c: Pick<ReclaimClaimData, "owner" | "timestampS" | "epoch"> & { identifier: string }): string {
  return [c.identifier.toLowerCase(), c.owner.toLowerCase(), String(c.timestampS), String(c.epoch)].join("\n");
}

export interface ReclaimVerification {
  ok: boolean;
  identifier: string;
  signers: string[];
  /** Signers that are in the attestor set — the claim is only as good as this list is non-empty. */
  attestingSigners: string[];
  /** The request the attestor vouches for. */
  request: { url: string; method: string; responseMatches: unknown[] } | null;
  /** Values the attestor signed as extracted from the response (inside the signed context). */
  extracted: Record<string, string>;
  timestampS: number;
  checks: string[];
  problems: string[];
}

/**
 * Verifies a Reclaim proof by hand. `attestors` is the registry to check signers against (lowercase addresses); `expect` pins the
 * URL (exact, or a predicate) and the provider so a valid proof of the WRONG page is refused. Pure given its inputs.
 */
export async function verifyReclaimProof(proof: ReclaimProof, o: { attestors: readonly string[]; expect?: { url?: string | ((u: string) => boolean); provider?: string }; now?: number; maxAgeS?: number | null }): Promise<ReclaimVerification> {
  const checks: string[] = [], problems: string[] = [];
  const c = proof?.claimData;
  const out: ReclaimVerification = { ok: false, identifier: "", signers: [], attestingSigners: [], request: null, extracted: {}, timestampS: c?.timestampS ?? 0, checks, problems };
  if (!c || typeof c.parameters !== "string" || typeof c.owner !== "string" || !Array.isArray(proof.signatures) || !proof.signatures.length) { problems.push("not a Reclaim proof (claimData/signatures missing)"); return out; }
  // 1. The identifier is a hash of the claim: recompute it.
  let id: string;
  try { id = reclaimClaimIdentifier(c); } catch (e) { problems.push((e as Error).message); return out; }
  out.identifier = id;
  if (id !== String(proof.identifier).toLowerCase() || id !== String(c.identifier).toLowerCase()) problems.push(`identifier mismatch: recomputed ${id}, proof says ${proof.identifier}`);
  else checks.push("identifier = keccak256(provider, parameters, canonical context) — the claim was not edited");
  // 2. Recover every signer and require at least one registered attestor.
  const msg = reclaimSignedMessage({ identifier: id, owner: c.owner, timestampS: c.timestampS, epoch: c.epoch });
  const reg = new Set(o.attestors.map((a) => a.toLowerCase()));
  for (const sig of proof.signatures) {
    try {
      const addr = (await recoverMessageAddress({ message: msg, signature: sig as `0x${string}` })).toLowerCase();
      out.signers.push(addr);
      if (reg.has(addr)) out.attestingSigners.push(addr);
    } catch { problems.push(`signature ${String(sig).slice(0, 18)}… does not recover`); }
  }
  if (!out.attestingSigners.length) problems.push(`no signer is a registered attestor (signers: ${out.signers.join(", ") || "none"})`);
  else checks.push(`signed by registered attestor(s) ${out.attestingSigners.join(", ")} over "identifier\\nowner\\ntimestampS\\nepoch" (EIP-191)`);
  const named = new Set((proof.witnesses ?? []).map((w) => String(w.id).toLowerCase()));
  if (out.attestingSigners.some((s) => !named.has(s))) problems.push("a signer is not among the proof's named witnesses");
  // 3. The request the attestor vouches for, and the values it signed.
  try {
    const p = JSON.parse(c.parameters) as { url?: unknown; method?: unknown; responseMatches?: unknown };
    if (typeof p.url !== "string" || typeof p.method !== "string") throw new Error("parameters lack url/method");
    out.request = { url: p.url, method: p.method, responseMatches: Array.isArray(p.responseMatches) ? p.responseMatches : [] };
    if (o.expect?.provider && c.provider !== o.expect.provider) problems.push(`provider is ${c.provider}, expected ${o.expect.provider}`);
    if (o.expect?.url) {
      const okUrl = typeof o.expect.url === "function" ? o.expect.url(p.url) : p.url === o.expect.url;
      if (!okUrl) problems.push(`proof is for ${p.url}, not the expected source`); else checks.push(`request url ${p.url} (${p.method}) is the expected source`);
    }
  } catch (e) { problems.push(`parameters: ${(e as Error).message}`); }
  try {
    const ctx = c.context ? (JSON.parse(c.context) as { extractedParameters?: Record<string, unknown> }) : {};
    for (const [k, v] of Object.entries(ctx.extractedParameters ?? {})) if (typeof v === "string") out.extracted[k] = v;
    if (Object.keys(out.extracted).length) checks.push(`extracted values are inside the signed context: ${Object.keys(out.extracted).join(", ")}`);
  } catch { problems.push("context is not JSON"); }
  // 4. Age (optional).
  if (o.maxAgeS != null && o.now != null) {
    const age = Math.floor(o.now / 1000) - c.timestampS;
    if (age > o.maxAgeS) problems.push(`claim is ${age}s old, ceiling ${o.maxAgeS}s`); else checks.push(`claim age ${age}s within ${o.maxAgeS}s`);
  }
  out.ok = problems.length === 0;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sources (tier 5: pages). One definition = the URL, the match rules the attestor applies, and how to turn the match into a number.
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ZkTlsSource {
  id: string;
  name: string;
  /** The page for a period key (e.g. Box Office Mojo weekend "2026W40"). */
  urlFor(period: string): string;
  /** The period key for a date (the most recent completed period on or before it). */
  periodFor(date: Date): string;
  /** Reclaim HTTP-provider rules: a regex with named groups; the attestor signs the groups as extractedParameters. */
  responseMatches: { type: "regex"; value: string }[];
  responseRedactions: { regex: string }[];
  /** Local extraction (tests, previews) with the same regex. */
  extract(html: string): Record<string, string> | null;
  /** The number the rule indexes, from the extracted groups. */
  valueOf(extracted: Record<string, string>): { value: string; unit: string; label: string };
  trust: string[];
}

/** ISO week key as Box Office Mojo spells it: /weekend/2026W40/ = the weekend ending Sunday of ISO week 40. */
export function bomWeekKey(d: Date): string {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = u.getUTCDay() || 7;                      // Mon=1..Sun=7
  u.setUTCDate(u.getUTCDate() + 4 - day);              // Thursday of this ISO week
  const yearStart = Date.UTC(u.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((u.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${u.getUTCFullYear()}W${String(week).padStart(2, "0")}`;
}

/** Row 1 of the weekend table as served on 2026-10-09 (test/fixtures/bom-weekend-2026W40-row1.html): rank cell, title link, weekend gross. */
const BOM_TOP_REGEX = String.raw`mojo-field-type-rank mojo-sort-column">1</td>[\s\S]*?mojo-field-type-release mojo-cell-wide"><a class="a-link-normal" href="/release/(?<release>rl\d+)/[^"]*">(?<title>[^<]+)</a></td><td class="a-text-right mojo-field-type-money[^"]*">\$(?<gross>[\d,]+)</td>`;

export const BOM_WEEKEND_TOP: ZkTlsSource = {
  id: "bom.weekend.top",
  name: "Box Office Mojo — domestic weekend #1 gross",
  urlFor: (period) => `https://www.boxofficemojo.com/weekend/${period}/`,
  periodFor: (d) => bomWeekKey(new Date(d.getTime() - ((d.getUTCDay() || 7) === 7 ? 0 : 0))),
  responseMatches: [{ type: "regex", value: BOM_TOP_REGEX }],
  responseRedactions: [{ regex: BOM_TOP_REGEX }],
  extract(html) {
    const m = new RegExp(BOM_TOP_REGEX).exec(html);
    if (!m?.groups) return null;
    return { release: m.groups.release, title: m.groups.title, gross: m.groups.gross };
  },
  valueOf(x) {
    const gross = (x.gross ?? "").replace(/,/g, "");
    if (!/^\d+$/.test(gross)) throw new Error(`gross ${JSON.stringify(x.gross)} is not a dollar figure`);
    return { value: gross, unit: "USD", label: `${x.title} (${x.release})` };
  },
  trust: ["Box Office Mojo's published figure (Amazon/IMDb) — estimates on Sunday, actuals Monday; the rule must name which", "the regex selects the rank-1 row of the weekend table as laid out on 2026-10-09; a redesign breaks the match (fails closed)", "the Reclaim attestor's TLS session reached www.boxofficemojo.com (DNS/CA trust as any browser)"],
};

export const ZKTLS_SOURCES: Record<string, ZkTlsSource> = { [BOM_WEEKEND_TOP.id]: BOM_WEEKEND_TOP };

// ---------------------------------------------------------------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ZkTlsProofBundle {
  provider: "reclaim";
  source: string;
  period: string;
  url: string;
  createdAt: string;
  proof: ReclaimProof;
}

export interface ZkTlsVerified {
  ok: boolean;
  source: string;
  url: string;
  value: { value: string; unit: string; label: string } | null;
  verification: ReclaimVerification;
  trusted: string[];
}

export interface ZkTlsProvider {
  readonly id: "reclaim";
  /** Produces a proof for `source` at `period`. Needs the SDK and credentials; see the file header. */
  prove(source: ZkTlsSource, period: string): Promise<ZkTlsProofBundle>;
  verify(bundle: ZkTlsProofBundle, o?: { attestors?: readonly string[]; now?: number; maxAgeS?: number | null }): Promise<ZkTlsVerified>;
}

export const RECLAIM_ENV = { appId: "RECLAIM_APP_ID", appSecret: "RECLAIM_APP_SECRET" } as const;

type ZkFetchModule = { ReclaimClient: new (appId: string, appSecret: string) => { zkFetch(url: string, init: Record<string, unknown>, rules: Record<string, unknown>): Promise<unknown> } };

/**
 * The Reclaim provider. `loadSdk` is injectable (tests pass a fake); the default imports @reclaimprotocol/zk-fetch lazily and
 * explains how to install it when it is absent. `env` is read by name; values never leave this function.
 */
export function reclaimProvider(deps: { env?: Record<string, string | undefined>; loadSdk?: () => Promise<ZkFetchModule>; fetchImpl?: FetchLike; now?: () => number } = {}): ZkTlsProvider {
  const env = deps.env ?? process.env;
  const loadSdk = deps.loadSdk ?? (async () => {
    try { return (await import(/* webpackIgnore: true */ "@reclaimprotocol/zk-fetch" as string)) as ZkFetchModule; }
    catch { throw new Error("@reclaimprotocol/zk-fetch is not installed (it is intentionally not a dependency: attestor-core, snarkjs, native modules). Install it in a scratch checkout: npm i @reclaimprotocol/zk-fetch — then re-run prove."); }
  });
  return {
    id: "reclaim",
    async prove(source, period) {
      const appId = env[RECLAIM_ENV.appId]?.trim(), appSecret = env[RECLAIM_ENV.appSecret]?.trim();
      if (!appId || !appSecret) throw new Error(`set ${RECLAIM_ENV.appId} and ${RECLAIM_ENV.appSecret} (from https://dev.reclaimprotocol.org → your application); they are read by name and never printed`);
      const sdk = await loadSdk();
      const url = source.urlFor(period);
      const client = new sdk.ReclaimClient(appId, appSecret);
      const proof = (await client.zkFetch(url, { method: "GET", headers: { accept: "text/html", "user-agent": "Mozilla/5.0" } }, { responseMatches: source.responseMatches, responseRedactions: source.responseRedactions })) as ReclaimProof;
      if (!proof?.claimData) throw new Error("zkFetch returned no proof");
      return { provider: "reclaim", source: source.id, period, url, createdAt: new Date(deps.now?.() ?? Date.now()).toISOString(), proof };
    },
    async verify(bundle, o = {}) {
      const source = ZKTLS_SOURCES[bundle.source];
      if (!source) throw new Error(`unknown zkTLS source ${bundle.source}`);
      const attestors = o.attestors ?? (await fetchReclaimAttestors(deps.fetchImpl).catch(() => PINNED_RECLAIM_ATTESTORS));
      const verification = await verifyReclaimProof(bundle.proof, { attestors, expect: { url: source.urlFor(bundle.period), provider: "http" }, now: o.now, maxAgeS: o.maxAgeS ?? null });
      let value: ZkTlsVerified["value"] = null;
      if (verification.ok) {
        try { value = source.valueOf(verification.extracted); } catch (e) { verification.problems.push((e as Error).message); verification.ok = false; }
      }
      return { ok: verification.ok, source: source.id, url: source.urlFor(bundle.period), value, verification, trusted: [`the attestor(s) ${verification.attestingSigners.join(", ") || "(none)"} and Reclaim's attestor registry`, ...source.trust] };
    },
  };
}

/** A verified zkTLS value as an AttestedReading (the Attester shape the keeper gate consumes). */
export function zkTlsAttestedReading(v: ZkTlsVerified): AttestedReading {
  if (!v.ok || !v.value) throw new Error(`zkTLS proof not verified: ${v.verification.problems.join("; ")}`);
  return { attester: `zktls:reclaim:${v.source}`, value: v.value.value, cents: decimalToCents(v.value.value), slot: null, observedAt: v.verification.timestampS * 1000, jobHash: null, feedHash: v.verification.identifier.replace(/^0x/, ""), oracles: v.verification.attestingSigners, evidence: { url: v.url, label: v.value.label, unit: v.value.unit, checks: v.verification.checks } };
}
