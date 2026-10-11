import { fail, ok, type ApiResult } from "@/lib/burnticker/api/http";
import type { Platform } from "@/lib/burnticker/server";
import { listSnapshots, SNAPSHOT_SCHEMA, SNAPSHOT_TABLE_NAMES, type SnapshotRecord } from "@/lib/burnticker/ops/snapshot";

/** GET /v1/snapshots (1.7.0): the registry's write-once snapshots table, newest first. No network; one small query. */
export const VERIFY_CMD = "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-verify-snapshot.mts";
const view = (s: SnapshotRecord, cluster: string) => ({ date: s.date, sha256: s.sha256, arweaveTxId: s.arweaveTxId, url: s.url, rowCounts: s.rowCounts, bytes: s.bytes, uploader: s.uploader, capturedAt: new Date(s.capturedAt).toISOString(), verify: `${VERIFY_CMD} ${s.arweaveTxId} --cluster ${cluster === "mainnet" ? "mainnet" : "devnet"}` });

export function v1Snapshots(p: Pick<Platform, "registry" | "cluster">, q: URLSearchParams): ApiResult {
  const raw = q.get("limit");
  const limit = raw === null ? 60 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 400) return fail(400, "limit must be an integer 1–400");
  const rows = listSnapshots(p.registry, limit).map((s) => view(s, p.cluster));
  return ok({
    schema: "burnticker.snapshots/v1", cluster: p.cluster, count: rows.length, latest: rows[0] ?? null, snapshots: rows,
    format: `${SNAPSHOT_SCHEMA}: one header line, then one canonical JSON line per row, tables ${SNAPSHOT_TABLE_NAMES.join(", ")}`,
    verifier: `${VERIFY_CMD} <txid> [--cluster mainnet] [--db <registry copy>]`,
    note: "Taken once per UTC day by the keeper; a date without a row had no snapshot (the upload payer was not set, or the upload failed and is retried). The chain stays the final word on every burn.",
  });
}
