// BURNTICKER PUBLIC API v1 (2026-10-09) — every endpoint under src/app/api/burnticker/v1/ called in-process against the fakes, each
// 200 validated against its OpenAPI response schema; the error paths (404/400/403/409/415/429); cache and CORS headers; the
// cross-site refusal on every POST; a launch bundle that never carries a secret and never signs; and no adopt-existing-token path.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { postGraduationShareLine } from "@/lib/burnticker/feeShareLine";
import { Keypair, Transaction } from "@solana/web3.js";
import { buildOpenApi, ENDPOINTS, endpoint, RATE_LIMITS } from "@/lib/burnticker/api/spec";
import { limiter, RateLimiter, clientKey } from "@/lib/burnticker/api/http";
import { DEFAULT_ON_END, lockRule } from "@/lib/burnticker/rules";
import { burnPoolFor } from "@/lib/burnKeeper/burnPool";
import { PLACEHOLDER_PROGRAM_ID } from "@/lib/burnticker/program";
import { PLACEHOLDER_BLOCKHASH } from "@/lib/burnticker/transactions";
import { claimLockFeesFor } from "@/lib/burnticker/lockFeesKeeper";
import { postGraduationBpsFor } from "@/lib/burnticker/fees";
import { API, CREATOR, HOST, POST_HEADERS, ROUTE_MODULES, callRoute, makeWorld, validateSchema, type World } from "./burntickerApiHelpers.ts";
import { BRONCOS, DENVER_HIGH, DEBT_RULE } from "./burntickerHelpers.ts";

const DOC = buildOpenApi() as { paths: Record<string, Record<string, { responses: Record<string, { content: { "application/json": { schema: Record<string, unknown> } } }> }>> };

/** Calls an operation and checks a 200 against the operation's documented schema. */
async function call(operationId: string, pathParams: Record<string, string> = {}, o: { query?: string; body?: unknown; headers?: Record<string, string>; expect?: number } = {}) {
  const ep = endpoint(operationId);
  const path = ep.path.replace(/\{(\w+)\}/g, (_m, k) => encodeURIComponent(pathParams[k]));
  const res = await callRoute(`${API}${path}${o.query ? `?${o.query}` : ""}`, { method: ep.method, headers: ep.method === "POST" ? { ...POST_HEADERS, ...(o.headers ?? {}) } : o.headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const body = await res.json() as Record<string, unknown>;
  assert.equal(res.status, o.expect ?? 200, `${operationId} → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const schema = DOC.paths[ep.path][ep.method.toLowerCase()].responses[String(res.status)]?.content["application/json"].schema;
  assert.ok(schema, `${operationId}: status ${res.status} is documented`);
  assert.deepEqual(validateSchema(schema, body, DOC as unknown as Record<string, unknown>), [], `${operationId} ${res.status} matches its schema`);
  return { res, body };
}

let w: World;
before(async () => { w = await makeWorld(); });

describe("v1 read endpoints", () => {
  test("GET /catalogue: sources with tiers, the public selection config (header values withheld), cacheable + CORS-open", async () => {
    const { res, body } = await call("getCatalogue");
    const sources = body.sources as { id: string; tier: number; config: Record<string, unknown> | null }[];
    const debt = sources.find((s) => s.id === "treasury.debt")!;
    assert.equal(debt.tier, 4);
    assert.ok(debt.config && (debt.config.request as { url: string }).url.startsWith("https://api.fiscaldata.treasury.gov/"));
    const edgar = sources.find((s) => s.id.startsWith("edgar"));
    if (edgar?.config) { assert.equal((edgar.config.request as Record<string, unknown>).headers, undefined); assert.deepEqual((edgar.config.request as { headerNames: string[] }).headerNames, ["user-agent"]); }
    assert.ok(!JSON.stringify(body).includes("@gmail.com"), "no contact address leaks through a header value");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("cache-control")!, /^public, max-age=300/);
    assert.ok(res.headers.get("ratelimit-remaining"));
  });
  test("GET /sources/{id}/preview: the source fixes the unit; the mapping is ours; unknown source → 404, bad mapping → 400", async () => {
    const { body } = await call("getSourcePreview", { id: "treasury.debt" }, { query: "fractionOfPool=0.05" });
    assert.equal((body.rule as { scalar: { unit: number } }).scalar.unit, 1e9);
    assert.ok((body.rows as unknown[]).length > 0);
    await call("getSourcePreview", { id: "no.such" }, { expect: 404 });
    await call("getSourcePreview", { id: "treasury.debt" }, { query: "fractionOfPool=0.5", expect: 400 });
  });
  test("GET /kalshi/search: a search, one series with open markets, an unknown series → 404", async () => {
    const { body } = await call("searchKalshi", {}, { query: "q=nfl&category=Sports" });
    assert.equal((body.results as { ticker: string }[])[0].ticker, "KXNFLGAME");
    const one = await call("searchKalshi", {}, { query: "series=KXHIGHDEN" });
    assert.equal((one.body.series as { ticker: string }).ticker, "KXHIGHDEN");
    assert.ok((one.body.openCount as number) > 0);
    await call("searchKalshi", {}, { query: "series=KXNOPE", expect: 404 });
  });
  test("GET /tokens: registry list with receipt and burn counts; paging; a bad status → 400", async () => {
    const { body } = await call("listTokens");
    assert.equal(body.total, 2);
    const b = (body.tokens as { ticker: string; burns: number; rulesSha256: string; status: string }[]).find((t) => t.ticker === "BRONCO")!;
    assert.equal(b.burns, 1); assert.equal(b.status, "live"); assert.equal(b.rulesSha256, lockRule(BRONCOS).sha256);
    const page = await call("listTokens", {}, { query: "limit=1&offset=1" });
    assert.equal(page.body.count, 1);
    await call("listTokens", {}, { query: "status=bogus", expect: 400 });
  });
  test("GET /tokens/{ticker}: by ticker (any case) or by mint; status + receipts + rules text; unknown → 404", async () => {
    const { body } = await call("getToken", { ticker: "bronco" });
    assert.equal((body.status as { ticker: string }).ticker, "BRONCO");
    assert.equal(body.rulesText, lockRule(BRONCOS).text);
    assert.ok("impliedChance" in (body.status as { next: object }).next);
    const byMint = await call("getToken", { ticker: w.bronco.mint });
    assert.equal((byMint.body.status as { mint: string }).mint, w.bronco.mint);
    await call("getToken", { ticker: "NOPE" }, { expect: 404 });
  });
  test("GET /tokens/{ticker}/receipts: every receipt recomputed green", async () => {
    const { body } = await call("getReceipts", { ticker: "BRONCO" });
    const rs = body.receipts as { eventId: string; status: string; verify: { verified: boolean } }[];
    assert.deepEqual(rs.map((r) => [r.eventId, r.status]), [["KXNFLGAME-26SEP27LARDEN-DEN", "confirmed"], ["KXNFLGAME-26OCT04DENSF-DEN", "nothing"]]);
    assert.ok(rs.every((r) => r.verify.verified));
    await call("getReceipts", { ticker: "NOPE" }, { expect: 404 });
  });
  test("GET /tokens/{ticker}/verify/{id}: rules, memo, source (Kalshi re-read), units, spend and the chain memo all pass", async () => {
    const { body } = await call("verifyReceipt", { ticker: "BRONCO", id: "KXNFLGAME-26SEP27LARDEN-DEN" });
    assert.equal(body.verified, true);
    const checks = Object.fromEntries((body.checks as { id: string; ok: boolean | null }[]).map((c) => [c.id, c.ok]));
    assert.deepEqual(checks, { rules: true, memo: true, source: true, units: true, spend: true, chain: true });
    const treasury = await call("verifyReceipt", { ticker: "DEFICIT2", id: "2026-10-08" });
    assert.equal(treasury.body.verified, true, JSON.stringify(treasury.body.checks));
    await call("verifyReceipt", { ticker: "BRONCO", id: "NOPE" }, { expect: 404 });
  });
  test("GET /trust: the Powers Register, designed fees (dev 25 bps, creator cash 0), live fees honest about having no RPC", async () => {
    const { body } = await call("getTrust");
    const fees = body.fees as { designed: { devFeeBps: number; creatorCashBps: number }; live: { found: boolean } };
    assert.equal(fees.designed.devFeeBps, 25); assert.equal(fees.designed.creatorCashBps, 0); assert.equal(fees.live.found, false);
    assert.equal(body.rpcConfigured, false);
    assert.ok((body.cannot as string[]).some((s) => /Adopt an existing token/.test(s)));
  });
  test("GET /tokens/{ticker}: the lp block (since 1.8.0) — locked forever, the Fee Key at the fee-keys PDA, the last claim_lock_fees receipt", async () => {
    const before = await call("getToken", { ticker: "DEFICIT2" });
    const lp0 = (before.body.status as { lp: { policy: string; feeKey: string | null; lockedPct: number; lastClaim: unknown; split: { burnBps: number; operatorBps: number } } }).lp;
    assert.deepEqual([lp0.policy, lp0.feeKey, lp0.lockedPct, lp0.lastClaim, lp0.split.burnBps, lp0.split.operatorBps], ["locked-forever", null, null, null, 8000, 2000], "sixth pass B-16a: no lock percentage before graduation");
    const port = w.program.lockFees.port(w.deficit.mint).graduate().accrue(BigInt(1234567));
    const r = await claimLockFeesFor({ registry: w.registry, lockFees: w.program.lockFees, log: () => {}, now: () => Date.UTC(2026, 9, 11, 12), dryRun: false }, w.deficit);
    assert.equal(r.outcome, "claimed");
    const { body } = await call("getToken", { ticker: "DEFICIT2" });
    const st = body.status as { trust: { lpBurnedPct: number; lpLockedPct: number; lpPolicy: string }; lp: { feeKey: string; feeKeyOwner: string; lockProgram: string; lastClaim: { sol: string; toBurnPool: string; toOperator: string; line: string; txUrl: string }; totals: { claims: number }; urls: { feeKey: string } } };
    assert.deepEqual([st.trust.lpBurnedPct, st.trust.lpLockedPct, st.trust.lpPolicy], [0, 100, "locked-forever"]);
    assert.equal(st.lp.feeKey, port.feeKey);
    assert.equal(st.lp.feeKeyOwner, w.program.lockFees.feeKeysPda());
    assert.equal(st.lp.lockProgram, "DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX");
    assert.deepEqual([st.lp.lastClaim.sol, st.lp.lastClaim.toBurnPool, st.lp.lastClaim.toOperator], ["0.001234567", "0.000987654", "0.000246913"]);
    assert.match(st.lp.lastClaim.line, /^0\.001234567 SOL of pool fees was claimed\. 0\.000987654 SOL \(80%\) went to the burn pool/);
    assert.match(st.lp.urls.feeKey, /^https:\/\/solscan\.io\/account\/.+\?cluster=devnet$/);
    assert.equal(st.lp.totals.claims, 1);
  });
  test("GET /trust: the lpLock policy block (since 1.8.0) and the designed fees say locked, not burned", async () => {
    const { body } = await call("getTrust");
    const lp = body.lpLock as { policy: string; treasuryPinned: boolean; operatorTreasury: string; split: { burnBps: number; operatorBps: number }; perSwapAfterGraduationBps: { toBurnPool: number; toOperator: number; burnedTotal: number } };
    assert.equal(lp.policy, "locked-forever");
    assert.deepEqual([lp.split.burnBps, lp.split.operatorBps], [8000, 2000]);
    // the test host is devnet: its CPMM tier (index 0, creator fee 25 bps, no protocol share) is not mainnet's tier 9
    const devnet = postGraduationBpsFor("devnet");
    assert.deepEqual([lp.perSwapAfterGraduationBps.toBurnPool, lp.perSwapAfterGraduationBps.toOperator, lp.perSwapAfterGraduationBps.burnedTotal], [devnet.lpToBurnPool, devnet.lpToOperator, devnet.burnPoolTotal]);
    assert.deepEqual([devnet.lpToBurnPool, devnet.lpToOperator, devnet.burnPoolTotal], [16.8, 4.2, 41.8]);
    assert.equal(lp.operatorTreasury, "A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD");
    const d = (body.fees as { designed: { lpBurnedPct: number; lpLockedPct: number } }).designed;
    assert.deepEqual([d.lpBurnedPct, d.lpLockedPct], [0, 100]);
    assert.ok((body.statements as string[]).some((x) => x.startsWith(postGraduationShareLine((body.fees as { designed: { postGraduation: { legs: { label: string; bps: number }[] } } }).designed.postGraduation))), "the operator's share is led by the whole swap (fees copy, 2026-10-12)");
  });
  test("GET /openapi.json: the generated document", async () => {
    const { body, res } = await call("getOpenApi");
    assert.equal(body.openapi, "3.1.0");
    assert.match(res.headers.get("cache-control")!, /max-age=3600/);
  });
});

describe("v1 POST endpoints", () => {
  test("POST /rules/validate: canonical bytes + sha256 + receipt format; every problem listed on 400", async () => {
    const { body } = await call("validateRule", {}, { body: { rule: DENVER_HIGH, ticker: "dnvr" } });
    const l = lockRule(DENVER_HIGH);
    assert.equal(body.canonical, l.text); assert.equal(body.sha256, l.sha256);
    assert.match(body.receiptFormat as string, new RegExp(`^BT\\|DNVR\\|.*rules=sha256:${l.sha12}\\|v3$`));
    const bad = await call("validateRule", {}, { body: { rule: { ...BRONCOS, floorUsd: 1, binary: { onYes: { fractionOfPool: 0.5 } } } }, expect: 400 });
    assert.equal(bad.body.ok, false);
    assert.ok((bad.body.problems as string[]).length >= 2);
  });
  test("POST /kalshi/backtest: matched markets and the sentence; a catalogue rule previews from its fixture; invalid → 400", async () => {
    const { body } = await call("backtestKalshi", {}, { body: { rule: BRONCOS, months: 12 } });
    assert.equal(body.sha256, lockRule(BRONCOS).sha256);
    assert.ok((body.matched as number) > 0);
    const cat = await call("backtestKalshi", {}, { body: { rule: DEBT_RULE } });
    assert.match(cat.body.sentence as string, /saved sample/);
    await call("backtestKalshi", {}, { body: { rule: { nope: 1 } }, expect: 400 });
  });
  test("POST /launch/bundle: unsigned base64 transactions + the wizard's review; the caller's mint, no secret; creator = the burn program's fee PDA", async () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const { body } = await call("buildLaunchBundle", {}, { body: { creator: CREATOR, mint, ticker: "dnvr", name: "Denver Heat", description: "hot days burn", rule: DENVER_HIGH, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true }, register: false } });
    const review = body.review as { mint: string; rules: { sha256: string }; receiptFormat: string; addresses: { feePda: string }; burnPoolAuthority: string; disclosure: { eventContract: string | null } };
    assert.equal(review.mint, mint);
    assert.equal(review.rules.sha256, lockRule({ ...DENVER_HIGH, onEnd: DEFAULT_ON_END }).sha256, "since 1.4.0 a rule without onEnd gets the default wind-down");
    assert.equal(review.addresses.feePda, burnPoolFor(PLACEHOLDER_PROGRAM_ID, new (await import("@solana/web3.js")).PublicKey(mint)).feePda.toBase58());
    assert.equal(review.burnPoolAuthority, review.addresses.feePda, "LaunchLab's recorded creator is the fee PDA, not the keeper");
    assert.ok(review.disclosure.eventContract);
    assert.equal(body.ready, false); assert.ok((body.pending as string[]).length > 0);
    assert.equal(body.registered, null, "register: false leaves no draft");
    assert.ok(!JSON.stringify(body).includes("mintSecretKey\":\""), "no secret in the response");
    const txs = body.transactions as { transaction: string | null; message: string; blockhashPlaceholder: boolean; recentBlockhash: string; signers: string[] }[];
    assert.equal(txs[0].blockhashPlaceholder, true); assert.equal(txs[0].recentBlockhash, PLACEHOLDER_BLOCKHASH);
    assert.deepEqual(txs[0].signers, ["creator", "mint"]);
    if (txs[0].transaction) {
      const tx = Transaction.from(Buffer.from(txs[0].transaction, "base64"));
      assert.equal(tx.feePayer!.toBase58(), CREATOR);
      assert.ok(tx.signatures.every((s) => s.signature === null), "never signed");
    }
    assert.equal(w.registry.token(mint), null);
  });
  test("POST /launch/bundle registers a draft by default; a second coin may share the ticker; /launch/confirm takes it live; bad input → 400", async () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const blockhash = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
    const { body } = await call("buildLaunchBundle", {}, { body: { creator: CREATOR, mint, ticker: "HEAT", name: "Heat", rule: DENVER_HIGH, acknowledgements: { ruleLocked: true, noReturns: true }, recentBlockhash: blockhash } });
    assert.deepEqual(body.registered, { status: "draft", ticker: "HEAT", mint });
    assert.equal((body.transactions as { recentBlockhash: string }[])[0].recentBlockhash, blockhash);
    const twin = await call("buildLaunchBundle", {}, { body: { creator: CREATOR, mint: Keypair.generate().publicKey.toBase58(), ticker: "HEAT", name: "Heat again", rule: DENVER_HIGH, acknowledgements: { ruleLocked: true, noReturns: true } } });
    assert.equal((twin.body.registered as { ticker: string }).ticker, "HEAT", "tickers are not unique (owner 2026-10-12)");
    const sig = "5".repeat(88);
    const c = await call("confirmLaunch", {}, { body: { mint, signature: sig } });
    assert.equal(c.body.status, "live");
    await call("confirmLaunch", {}, { body: { mint: Keypair.generate().publicKey.toBase58(), signature: sig }, expect: 404 });
    await call("confirmLaunch", {}, { body: { mint, signature: "short" }, expect: 400 });
    const noMint = await call("buildLaunchBundle", {}, { body: { creator: CREATOR, ticker: "NOMINT", name: "x", rule: DENVER_HIGH, acknowledgements: { ruleLocked: true, noReturns: true } }, expect: 400 });
    assert.match(noMint.body.error as string, /mint is required/);
    await call("buildLaunchBundle", {}, { body: { creator: CREATOR, mint: Keypair.generate().publicKey.toBase58(), ticker: "ACK", name: "no acks", rule: DENVER_HIGH, acknowledgements: { ruleLocked: false, noReturns: true } }, expect: 400 });
  });
  test("there is no adopt-an-existing-token path: an already-registered mint is refused (409), and no endpoint accepts an existing coin", async () => {
    await call("buildLaunchBundle", {}, { body: { creator: CREATOR, mint: w.bronco.mint, ticker: "ADOPT", name: "adopt", rule: BRONCOS, acknowledgements: { ruleLocked: true, noReturns: true } }, expect: 409 });
    for (const e of ENDPOINTS) assert.doesNotMatch(`${e.path} ${e.operationId}`, /adopt|import|attach|migrate/i);
  });
  test("every POST refuses a cross-site browser request (403) and a non-JSON body (415), before reading the body", async () => {
    limiter.reset();
    for (const e of ENDPOINTS.filter((x) => x.method === "POST")) {
      const cross = await callRoute(`${API}${e.path}`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" }, body: "{}" });
      assert.equal(cross.status, 403, e.operationId);
      const foreign = await callRoute(`${API}${e.path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
      assert.equal(foreign.status, 403, e.operationId);
      const none = await callRoute(`${API}${e.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(none.status, 403, `${e.operationId}: a bot must send Origin`);
      const text = await callRoute(`${API}${e.path}`, { method: "POST", headers: { "content-type": "text/plain", origin: `http://${HOST}` }, body: "{}" });
      assert.equal(text.status, 415, e.operationId);
      assert.equal(cross.headers.get("access-control-allow-origin"), null, "no CORS on POST");
    }
  });
});

describe("rate limits", () => {
  test("a client is limited per bucket with Retry-After; another client is not; the right-most forwarded hop is the client", async () => {
    limiter.reset();
    const hdr = { "x-forwarded-for": "198.51.100.7" };
    let last: Response | null = null;
    // AUDIT A C1 (7): confirmations left the write bucket (they are metered on the heavy one); bundles spend it
    for (let i = 0; i <= RATE_LIMITS.write.burst; i++) last = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: { ...POST_HEADERS, ...hdr }, body: JSON.stringify({ mint: "x" }) });
    assert.equal(last!.status, 429);
    assert.ok(Number(last!.headers.get("retry-after")) > 0);
    const other = await callRoute(`${API}/launch/bundle`, { method: "POST", headers: { ...POST_HEADERS, "x-forwarded-for": "198.51.100.8" }, body: JSON.stringify({ mint: "x" }) });
    assert.notEqual(other.status, 429);
    const read = await callRoute(`${API}/openapi.json`, { headers: hdr });
    assert.equal(read.status, 200, "the read bucket is separate");
    assert.equal(clientKey(new Request("http://x/", { headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.9" } })), "203.0.113.9");
    limiter.reset();
  });
  test("the bucket refills over time", () => {
    const l = new RateLimiter({ read: { burst: 2, refillPerSec: 1, human: "" }, heavy: { burst: 1, refillPerSec: 1, human: "" }, write: { burst: 1, refillPerSec: 1, human: "" }, confirm: { burst: 1, refillPerSec: 1, human: "" } });
    assert.ok(l.take("c", "read", 0).ok); assert.ok(l.take("c", "read", 0).ok); assert.equal(l.take("c", "read", 0).ok, false);
    assert.ok(l.take("c", "read", 1000).ok);
  });
});

test("every v1 route module exists and every endpoint in the spec has one", async () => {
  assert.equal(ROUTE_MODULES.length, ENDPOINTS.length);
  for (const m of ROUTE_MODULES) { const mod = await import(`../src/app/api/burnticker/v1/${m}/route.ts`); assert.ok(mod.GET || mod.POST, m); }
});
