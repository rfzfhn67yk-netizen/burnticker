/**
 * TRUST OPS IN THE PUBLIC API (2026-10-10 night; OpenAPI 1.7.0): GET /v1/snapshots — the daily registry snapshots pinned to Arweave.
 * Kept out of src/lib/burnticker/api/spec.ts's table like the trust pack's (a two-line splice there). Same conventions: hand-written
 * JSON Schema, additive only within v1.
 */
type Schema = Record<string, unknown>;
const str: Schema = { type: "string" };
const int: Schema = { type: "integer" };
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, required, ...extra });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

export const OPS_SCHEMAS: Record<string, Schema> = {
  RegistrySnapshot: obj({
    date: { ...str, description: "the UTC date the snapshot was captured (one per date, written once)" }, sha256: { ...str, pattern: "^[0-9a-f]{64}$", description: "sha256 of the canonical JSONL bytes on Arweave" },
    arweaveTxId: str, url: { ...str, description: "where the bytes are (https://arweave.net/<id> on mainnet, Irys devnet's gateway otherwise)" },
    rowCounts: { type: "object", additionalProperties: int, description: "rows per table: rules, readings, receipts, pairs, pair_outcomes, rule_ends, token_meta" },
    bytes: int, uploader: str, capturedAt: { ...str, description: "ISO time of capture" }, verify: { ...str, description: "the command that re-downloads and recomputes it" },
  }, ["date", "sha256", "arweaveTxId", "url", "rowCounts"]),
  RegistrySnapshots: obj({
    schema: { const: "burnticker.snapshots/v1" }, cluster: str, count: int, latest: { anyOf: [ref("RegistrySnapshot"), { type: "null" }] }, snapshots: arr(ref("RegistrySnapshot")),
    format: str, verifier: str, note: str,
  }, ["schema", "count", "latest", "snapshots"], { description: "Every daily registry snapshot, newest first: the append-only ledger (rules, readings, receipts, pairs, rule ends, launch pins) as canonical JSONL, pinned to Arweave with its sha256 recorded in a write-once table." }),
};

export const OPS_ENDPOINTS = [
  { operationId: "listSnapshots", method: "GET" as const, path: "/snapshots", tag: "platform", summary: "The daily registry snapshots pinned to Arweave", description: "Since 1.7.0. Once per UTC day the keeper exports the append-only ledger of the registry — rules, readings, receipts, pairs, pair outcomes, rule ends and launch pins — as canonical JSONL (fixed table order, rows in primary-key order, sorted keys), uploads it to Arweave through Irys and records { date, sha256, arweaveTxId, rowCounts } in a write-once table. Re-download and recompute any of them with scripts/burnticker-verify-snapshot.mts <txid>; with --db it also checks that every row is still present, unchanged, in a later copy of the registry. No payer, no snapshot: nothing is ever hosted in place of the Arweave copy.", params: [{ name: "limit", in: "query" as const, required: false, description: "1–400 (default 60)", schema: int }], request: null, response: "RegistrySnapshots", errors: [400, 429], cacheSec: 60, bucket: "read" as const },
];
