// zkTLS ATTESTER TOOLING (2026-10-09) — Reclaim Protocol, prototype. Credentials are read by NAME from the environment
// (RECLAIM_APP_ID, RECLAIM_APP_SECRET) and never printed; `prove` also needs @reclaimprotocol/zk-fetch, which is not a dependency.
//
//   R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnkeeper-attest-zktls.mts "$@"; }   (a function: zsh does not split $R)
//   R sources                                       the page sources and what each trusts
//   R prove bom.weekend.top [--period 2026W40] [--out proof.json]
//                                                    asks a Reclaim attestor to fetch the page and sign the match; writes the proof bundle
//   R verify <proof.json> [--offline] [--max-age-s N]
//                                                    recomputes the claim identifier, recovers the signer(s), checks the attestor registry
//                                                    (live, or the pinned copy with --offline), checks the URL is the source's, prints the value
//   R extract <page.html> [--source bom.weekend.top] applies the source's regex to a saved page (what the attestor would match)
//
// Getting credentials: https://dev.reclaimprotocol.org → New application → copy Application ID and Application Secret into your shell
// (export RECLAIM_APP_ID=… RECLAIM_APP_SECRET=…). Install the SDK in a scratch checkout, not this repo: npm i @reclaimprotocol/zk-fetch

import fs from "node:fs";
import { bomWeekKey, fetchReclaimAttestors, PINNED_RECLAIM_ATTESTORS, RECLAIM_ATTESTORS_URL, reclaimProvider, verifyReclaimProof, ZKTLS_SOURCES, type ZkTlsProofBundle } from "../src/lib/burnKeeper/attesters/zktls.ts";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1]; return args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3); };
const flag = (n: string) => args.includes(`--${n}`);
const out = (o: unknown) => console.log(JSON.stringify(o, null, 2));

try {
  if (cmd === "sources") {
    out(Object.values(ZKTLS_SOURCES).map((s) => ({ id: s.id, name: s.name, exampleUrl: s.urlFor(s.periodFor(new Date())), currentPeriod: s.periodFor(new Date()), responseMatches: s.responseMatches, trust: s.trust })));
    process.exit(0);
  }
  if (cmd === "prove") {
    const source = ZKTLS_SOURCES[args[1] ?? ""]; if (!source) throw new Error(`prove <source>: one of ${Object.keys(ZKTLS_SOURCES).join(", ")}`);
    const period = opt("period") ?? source.periodFor(new Date(Date.now() - 86_400_000));
    const bundle = await reclaimProvider().prove(source, period);
    const file = opt("out") ?? `data/attest/zktls-${source.id}-${period}.json`;
    fs.mkdirSync(file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".", { recursive: true });
    fs.writeFileSync(file, JSON.stringify(bundle, null, 2));
    const v = await reclaimProvider().verify(bundle);
    out({ wrote: file, url: bundle.url, verified: v.ok, value: v.value, signers: v.verification.attestingSigners, problems: v.verification.problems });
    process.exit(v.ok ? 0 : 2);
  }
  if (cmd === "verify") {
    const file = args[1]; if (!file) throw new Error("verify <proof.json>");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ZkTlsProofBundle | { proof: ZkTlsProofBundle["proof"] } | ZkTlsProofBundle["proof"];
    const attestors = flag("offline") ? PINNED_RECLAIM_ATTESTORS : await fetchReclaimAttestors().catch((e: Error) => { console.error(`registry unreachable (${e.message}); using the pinned copy`); return PINNED_RECLAIM_ATTESTORS; });
    const maxAgeS = opt("max-age-s") ? Number(opt("max-age-s")) : null;
    if ("provider" in raw && "source" in raw) {
      // A bundle written by `prove`: the proof must be for the named source's page.
      const v = await reclaimProvider().verify(raw, { attestors, now: Date.now(), maxAgeS });
      out({ file, ok: v.ok, source: v.source, url: v.url, value: v.value, cryptographicallyVerified: v.verification.checks, trusted: v.trusted, problems: v.verification.problems, signers: v.verification.signers, identifier: v.verification.identifier, extracted: v.verification.extracted, claimTimestamp: new Date(v.verification.timestampS * 1000).toISOString(), attestorRegistry: flag("offline") ? "pinned 2026-10-09" : RECLAIM_ATTESTORS_URL });
      process.exit(v.ok ? 0 : 2);
    }
    // A bare Reclaim proof (any provider/page): verify the claim itself; the request it vouches for is printed, not pinned.
    const proof = "proof" in raw ? raw.proof : raw;
    const v = await verifyReclaimProof(proof, { attestors, expect: { provider: "http" }, now: Date.now(), maxAgeS });
    out({ file, ok: v.ok, request: v.request, cryptographicallyVerified: v.checks, trusted: [`the attestor(s) ${v.attestingSigners.join(", ") || "(none)"} and Reclaim's attestor registry`, "the origin named in request.url", "the responseMatches rules select what they claim to"], problems: v.problems, signers: v.signers, identifier: v.identifier, extracted: v.extracted, claimTimestamp: new Date(v.timestampS * 1000).toISOString(), attestorRegistry: flag("offline") ? "pinned 2026-10-09" : RECLAIM_ATTESTORS_URL });
    process.exit(v.ok ? 0 : 2);
  }
  if (cmd === "extract") {
    const file = args[1]; if (!file) throw new Error("extract <page.html>");
    const source = ZKTLS_SOURCES[opt("source") ?? "bom.weekend.top"]; if (!source) throw new Error("unknown --source");
    const x = source.extract(fs.readFileSync(file, "utf8"));
    out({ source: source.id, matched: !!x, extracted: x, value: x ? source.valueOf(x) : null, weekKeyToday: bomWeekKey(new Date()) });
    process.exit(x ? 0 : 2);
  }
  console.error("usage: see the header of scripts/burnkeeper-attest-zktls.mts"); process.exit(1);
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
