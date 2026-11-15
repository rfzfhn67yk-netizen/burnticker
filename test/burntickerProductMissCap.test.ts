// AUDIT 2026-10-18 A-41: the anonymous search-miss log appended one row per miss to an append-only table: one client at the read
// bucket's rate wrote about 173,000 rows a day and the delete trigger blocked any cleanup. Misses are now daily counts per query,
// each capped, with a cap on the queries kept per day, day totals that keep counting past it, and a retention window.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ProductStore, MISS_COUNT_CAP, MISS_QUERIES_PER_DAY, MISS_RETENTION_DAYS } from "@/lib/burnticker/productStore";

const T0 = Date.parse("2026-10-18T15:20:00Z");
const rows = (db: DatabaseSync, table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

describe("A-41: search misses are bounded daily counts", () => {
  test("one query repeated 10,000 times is one row, its count capped; the day's totals keep the true number", () => {
    const db = new DatabaseSync(":memory:"), st = new ProductStore(db);
    for (let i = 0; i < 10_000; i++) st.logMiss({ query: "rays world series", cards: 0, reason: "no-card" }, T0 + i);
    assert.equal(rows(db, "search_misses"), 0, "the append-only table is no longer written");
    assert.equal(rows(db, "search_miss_counts"), 1);
    const s = st.missSummary(T0 - 3_600_000);
    assert.equal(s.queries[0].misses, MISS_COUNT_CAP);
    assert.equal(s.total, 10_000); assert.equal(s.noCard, 10_000);
  });

  test("distinct queries stop at the daily cap; later ones only add to the totals", () => {
    const db = new DatabaseSync(":memory:"), st = new ProductStore(db);
    let stored = 0;
    for (let i = 0; i < MISS_QUERIES_PER_DAY + 500; i++) if (st.logMiss({ query: `query number ${String.fromCharCode(97 + (i % 26))}${i.toString(36)}x`, cards: 1, reason: "no-click" }, T0)) stored++;
    assert.equal(stored, MISS_QUERIES_PER_DAY);
    assert.equal(rows(db, "search_miss_counts"), MISS_QUERIES_PER_DAY);
    assert.equal(st.missSummary(T0 - 1).noClick, MISS_QUERIES_PER_DAY + 500);
    const d = db.prepare("SELECT queries, over_cap FROM search_miss_days").get() as { queries: number; over_cap: number };
    assert.deepEqual({ ...d }, { queries: MISS_QUERIES_PER_DAY, over_cap: 500 });
    // the next UTC day starts empty
    assert.equal(st.logMiss({ query: "a brand new day", cards: 0, reason: "no-card" }, T0 + 86_400_000), true);
  });

  test("counts older than the retention window are deleted on the first miss of a new day", () => {
    const db = new DatabaseSync(":memory:"), st = new ProductStore(db);
    st.logMiss({ query: "old search", cards: 0, reason: "no-card" }, T0);
    st.logMiss({ query: "recent search", cards: 0, reason: "no-card" }, T0 + 10 * 86_400_000);
    assert.equal(rows(db, "search_miss_counts"), 2);
    st.logMiss({ query: "today search", cards: 0, reason: "no-card" }, T0 + (MISS_RETENTION_DAYS + 1) * 86_400_000);
    const left = (db.prepare("SELECT query FROM search_miss_counts ORDER BY day").all() as { query: string }[]).map((r) => r.query);
    assert.deepEqual(left, ["recent search", "today search"]);
    assert.equal(rows(db, "search_miss_days"), 2);
    assert.doesNotThrow(() => db.exec("DELETE FROM search_miss_counts"), "the count tables can be cleaned up");
  });

  test("old one-row-per-miss rows still count in the summary", () => {
    const db = new DatabaseSync(":memory:"), st = new ProductStore(db);
    db.prepare("INSERT INTO search_misses (hour, query, cards, reason) VALUES (?,?,?,?)").run("2026-10-18T14:00Z", "rays world series", 0, "no-card");
    st.logMiss({ query: "rays world series", cards: 2, reason: "no-click" }, T0);
    const s = st.missSummary(T0 - 3 * 3_600_000);
    assert.deepEqual(s.queries.map((q) => [q.query, q.misses, q.noCard, q.noClick, q.lastHour]), [["rays world series", 2, 1, 1, "2026-10-18T15:00Z"]]);
    assert.equal(s.total, 2);
  });
});
