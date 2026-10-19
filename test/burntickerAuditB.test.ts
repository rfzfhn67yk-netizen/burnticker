// Prelaunch audits 2026-10-15, block B: the public-read CORS policy (F5), the pair share link's origin (F8), and the smaller page fixes.
// Each test failed before its fix (noted per test).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeWorld } from "./burntickerApiHelpers.ts";
import { setPlatformForTests } from "@/lib/burnticker/server";

const read = (p: string) => fs.readFileSync(p, "utf8");
const DEFICIT_ORIGIN = "https://deficit.burnticker.com";

describe("F5: the home endpoint answers the $DEFICIT shell's cross-origin read, every state", () => {
  test("cold 503 (the build failed) and the 200 both carry Access-Control-Allow-Origin (before: none, so the shell read null and hid Launch)", async () => {
    const { GET } = await import("../src/app/api/burnticker/home/route.ts");
    // a platform whose registry cannot even be reached: the first build rejects at once, so the cold path answers 503
    setPlatformForTests({ get registry(): never { throw new Error("registry down"); }, cluster: "devnet" } as never);
    const cold = await GET();
    assert.equal(cold.status, 503);
    assert.equal(cold.headers.get("access-control-allow-origin"), "*", "the 503 is readable from the sibling host");
    await makeWorld();
    const r = await GET();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    const j = await r.json() as { launch?: unknown };
    assert.ok("launch" in j, "the shell's field is there");
    const again = await GET();   // the memo hit
    assert.equal(again.headers.get("access-control-allow-origin"), "*");
  });
  test("the $DEFICIT shell reads the home from the apex, and no write route carries the public-read header", async () => {
    assert.match(read("site/deficit/index.html"), /fetch\("https:\/\/burnticker\.com\/api\/burnticker" \+ "\/home"/);
    void DEFICIT_ORIGIN;
    const { PUBLIC_READ_CORS } = await import("@/lib/burnticker/api/http");
    assert.deepEqual({ ...PUBLIC_READ_CORS }, { "access-control-allow-origin": "*" });
    for (const f of ["src/app/api/burnticker/launch/route.ts", "src/app/api/burnticker/v1/launch/bundle/route.ts", "src/app/api/burnticker/v1/launch/confirm/route.ts"]) assert.ok(!/PUBLIC_READ_CORS|access-control-allow-origin/i.test(read(f)), f);
  });
});

describe("F8: the pair page's share text links the public origin, never the proxy's localhost", () => {
  test("a request to http://localhost:3000 with a configured public origin shares the public URL (before: http://localhost:3000/burnticker)", async () => {
    const w = await makeWorld();
    // a pair row over the two fake coins (the share line only needs the two sides' pages)
    (w.registry as unknown as { pair: (id: string) => unknown }).pair = (id: string) => (id === "bronco-vs-deficit2" ? { pairId: id, mintA: w.bronco.mint, mintB: w.deficit.mint, selectorKey: "test", createdAt: 0 } : null);
    const prev = process.env.BURNTICKER_PUBLIC_ORIGIN;
    process.env.BURNTICKER_PUBLIC_ORIGIN = "https://burnticker.example";
    try {
      const { GET } = await import("../src/app/api/burnticker/pairs/[pairId]/route.ts");
      const r = await GET(new Request("http://localhost:3000/api/burnticker/pairs/bronco-vs-deficit2"), { params: Promise.resolve({ pairId: "bronco-vs-deficit2" }) });
      assert.equal(r.status, 200);
      const text = JSON.stringify((await r.json() as { share: unknown }).share);
      assert.ok(!/localhost/.test(text), text);
      assert.match(text, /https:\/\/burnticker\.example\/burnticker/);
    } finally { if (prev === undefined) delete process.env.BURNTICKER_PUBLIC_ORIGIN; else process.env.BURNTICKER_PUBLIC_ORIGIN = prev; }
  });
  test("no route builds a link from the request's own origin; the badge origin maps loopback to the public origin", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync("grep -rln 'URL(req.url).origin\\|URL(request.url).origin' src || true", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    assert.deepEqual(hits, [], "the pairs route used it (before)");
    const { badgeOrigin } = await import("@/lib/burnticker/badgeServe");
    assert.equal(badgeOrigin(new Request("http://localhost:3000/x"), {}), "https://burnticker.com");
    assert.equal(badgeOrigin(new Request("http://localhost:3000/x"), { BURNTICKER_PUBLIC_ORIGIN: "https://bt.example" }), "https://bt.example");
    assert.equal(badgeOrigin(new Request("https://preview.example/x"), {}), "https://preview.example");
  });
});

/** The body of the first `<head> {` block in a Caddyfile (balanced braces; comments stripped first). */
function caddyBlock(src: string, head: string): string {
  const i = src.indexOf(head);
  assert.ok(i >= 0, `block ${head}`);
  let d = 0, j = src.indexOf("{", i + head.length - 1);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}" && --d === 0) return src.slice(j + 1, k); }
  throw new Error(`unbalanced ${head}`);
}

describe("H2: Caddy passes the launch routes' own 5xx answers through; the fallback is for a dead upstream or a deploy", () => {
  const caddy = read("deploy/caddy/Caddyfile").replace(/^\s*#.*$/gm, "");
  const site = caddyBlock(caddy, "{$BURNTICKER_DOMAIN:burnticker.com} {");
  const app = caddyBlock(site, "handle @app {");
  test("both launch routes (the page's and /v1/launch/bundle) are matched first, at 90 s, with no 5xx replacement (before: handle_response swapped the refusal for 'the app is catching up', and the bundle had 20 s)", () => {
    const m = app.match(/@app_launch path ([^\n]+)/);
    assert.ok(m, "the launch matcher");
    const paths = m![1].trim().split(/\s+/);
    for (const p of ["/api/burnticker/launch", "/api/burnticker/launch/*", "/api/burnticker/v1/launch/*"]) assert.ok(paths.includes(p), p);   // audit C: every v1 launch route, not only bundle
    assert.ok(app.indexOf("handle @app_launch") < app.indexOf("handle @app_api"), "the launch block comes before the general API block");
    const launch = caddyBlock(app, "handle @app_launch {");
    assert.match(launch, /response_header_timeout 90s/);
    assert.ok(!/handle_response|app_fallback/.test(launch), "the app's own 5xx answer reaches the page");
    assert.ok(!/handle_response|app_fallback/.test(caddyBlock(app, "handle @app_api {")));
  });
  test("a dead or timed-out upstream still gets the JSON 503 and the fallback page (Caddy's own errors)", () => {
    const errs = caddyBlock(site, "handle_errors {");
    assert.match(errs, /@api_down \{\s*path \/api\/burnticker\/\*\s*expression \{err\.status_code\} >= 500\s*\}/);
    assert.match(caddyBlock(errs, "handle @api_down {"), /import app_fallback_api/);
    assert.match(caddyBlock(errs, "handle @app_down {"), /import app_fallback_page/);
  });
  test("a page's own 5xx gets the static fallback only while /deploying.json exists; otherwise the response is copied through", async () => {
    const pages = caddyBlock(app.slice(app.search(/handle \{\s*reverse_proxy/)), "handle {");
    const hr = caddyBlock(pages, "handle_response @upstream_5xx {");
    assert.match(hr, /@deploying file \{\s*root \/var\/www\/burnticker\s*try_files \/deploying\.json\s*\}/);
    assert.match(caddyBlock(hr, "handle @deploying {"), /import app_fallback_page/);
    assert.match(hr.slice(hr.lastIndexOf("handle {")), /copy_response/);
    const { DEPLOY_NOTICE_PATH } = await import("@/lib/burnticker/deployNotice");
    // the deploy script is private (not in the public tree): checked only where it exists
    if (fs.existsSync("scripts/ops/deploy-burnticker-host.sh")) assert.match(read("scripts/ops/deploy-burnticker-host.sh"), new RegExp(`\\$WWW${DEPLOY_NOTICE_PATH.replace(".", "\\.")}`), "the deploy script writes the marker Caddy checks");
  });
});

describe("F6: /burnticker/verify recognises the flagship $DEFICIT (it lives in its own keeper, not the creator registry)", () => {
  const FLAG = "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj";
  const SHA = "8e3e8b66748a7630b9fe0e9793583434a076f2a03e335cad3d4c965758a15be9";
  type Net = "devnet" | "mainnet";
  const readerOf = (main: { state: "registered" | "not-registered" | "unavailable"; sha?: string }, dev: "registered" | "not-registered" = "not-registered") => async (network: Net, programId: string) =>
    network === "mainnet"
      ? { network, programId, state: main.state, config: main.state === "registered" ? "381XXZHdFYgR8kQPZPSj6NQ4GsnQALBJjLFGgaKyAj9h" : null, rulesSha256: main.state === "registered" ? main.sha ?? SHA : null, readings: main.state === "registered" ? 1 : null, burns: main.state === "registered" ? 0 : null, reason: main.state === "unavailable" ? "RPC down" : null }
      : { network, programId, state: dev, config: dev === "registered" ? "Cfg" : null, rulesSha256: dev === "registered" ? "c".repeat(64) : null, readings: dev === "registered" ? 1 : null, burns: dev === "registered" ? 0 : null, reason: null };
  test("the flagship facts come from the platform's own files: its mint, mainnet, and the rules file's sha256", async () => {
    const { flagshipFacts } = await import("@/lib/burnticker/verifyMintServe");
    const f = flagshipFacts();
    assert.equal(f?.mint, FLAG); assert.equal(f?.network, "mainnet"); assert.equal(f?.rulesSha256, SHA); assert.equal(f?.ticker, "DEFICIT");
  });
  test("flagship on a mainnet host: yes, named as the flagship (before: 'not a coin launched on Burnticker')", async () => {
    const { verifyMintOn, clearVerifyMintMemo } = await import("@/lib/burnticker/verifyMintServe");
    const { lintCopy } = await import("@/lib/launch/copyLint");
    const w = await makeWorld(); clearVerifyMintMemo();
    const v = await verifyMintOn({ ...w.p, cluster: "mainnet" }, FLAG, Date.now(), { reader: readerOf({ state: "registered" }) as never });
    assert.equal(v.verdict, "burnticker");
    assert.match(v.headline, /flagship \$DEFICIT/);
    assert.doesNotMatch(v.summary, /not a coin launched on Burnticker|another launchpad/);
    assert.equal(v.flagship?.rulesMatch, true);
    assert.equal(v.links.page, "/deficit/");
    assert.equal(v.checks.find((c) => c.id === "registry")?.ok, null, "catalogue absence is neutral for the flagship");
    assert.deepEqual(lintCopy([v.headline, v.summary, ...v.checks.map((c) => c.detail)].join("\n")).hits, []);
  });
  test("wrong network: on a devnet host the flagship is still judged on mainnet, and the page says where it lives", async () => {
    const { verifyMintOn, clearVerifyMintMemo } = await import("@/lib/burnticker/verifyMintServe");
    const w = await makeWorld(); clearVerifyMintMemo();
    const v = await verifyMintOn(w.p, FLAG, Date.now(), { reader: readerOf({ state: "registered" }) as never });
    assert.equal(v.verdict, "burnticker");
    assert.match(v.summary, /This site shows devnet; the flagship lives on mainnet\./);
    // its address with no record on mainnet (only a devnet record) is not a yes
    clearVerifyMintMemo();
    const off = await verifyMintOn(w.p, FLAG, Date.now(), { reader: readerOf({ state: "not-registered" }, "registered") as never });
    assert.equal(off.verdict, "not-registered");
  });
  test("mismatched hash: the program's record on mainnet holds another rules hash → 'Rules do not match the program'", async () => {
    const { verifyMintOn, clearVerifyMintMemo } = await import("@/lib/burnticker/verifyMintServe");
    const w = await makeWorld(); clearVerifyMintMemo();
    const v = await verifyMintOn({ ...w.p, cluster: "mainnet" }, FLAG, Date.now(), { reader: readerOf({ state: "registered", sha: "d".repeat(64) }) as never });
    assert.equal(v.verdict, "not-registered");
    assert.equal(v.headline, "Rules do not match the program");
    assert.equal(v.flagship?.rulesMatch, false);
  });
  test("the rehearsal coin stays a disclosed rehearsal; a third-party registered token stays program-only with neutral wording", async () => {
    const { verifyMintOn, clearVerifyMintMemo } = await import("@/lib/burnticker/verifyMintServe");
    const w = await makeWorld(); clearVerifyMintMemo();
    const reh = await verifyMintOn({ ...w.p, cluster: "mainnet" }, "FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp", Date.now(), { reader: readerOf({ state: "registered", sha: "e".repeat(64) }) as never });
    assert.equal(reh.verdict, "program-only"); assert.match(reh.headline, /rehearsal/); assert.equal(reh.flagship, null);
    clearVerifyMintMemo();
    const other = await verifyMintOn({ ...w.p, cluster: "mainnet" }, "So11111111111111111111111111111111111111112", Date.now(), { reader: readerOf({ state: "registered", sha: "e".repeat(64) }) as never });
    assert.equal(other.verdict, "program-only");
    assert.equal(other.flagship, null);
    assert.match(other.summary, /It is not in the catalogue of coins launched on this site\./);
    assert.doesNotMatch(other.summary, /not a coin launched on Burnticker/);
  });
});

describe("F7: /burnticker/me never shows one wallet's answer under another", () => {
  const deferred = <T,>() => { let res!: (v: T) => void; const p = new Promise<T>((r) => { res = r; }); return { p, res }; };
  for (const order of ["older answers first", "newer answers first"] as const) test(`switching A → B while A is in flight, ${order}: only B's answer is kept (before: A's late answer rendered under B)`, async () => {
    const { readLatest, shownFor } = await import("@/lib/burnticker/latestRead");
    let slot: { key: string; value: string } | null = null;
    const set = (r: { key: string; ok: boolean; value?: string }) => { if (r.ok) slot = { key: r.key, value: r.value! }; };
    const a = deferred<string>(), b = deferred<string>();
    const cancelA = readLatest("A", () => a.p, set as never);
    cancelA();   // the page switched to B: its effect cleanup cancels A
    readLatest("B", () => b.p, set as never);
    if (order === "older answers first") { a.res("coins of A"); await a.p; b.res("coins of B"); await b.p; }
    else { b.res("coins of B"); await b.p; a.res("coins of A"); await a.p; }
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(slot, { key: "B", value: "coins of B" });
    assert.equal(shownFor(slot, "B"), "coins of B");
    assert.equal(shownFor(slot, "A"), null, "a kept answer is shown only for its own wallet");
    assert.equal(shownFor(slot, ""), null);
  });
  test("a cancelled read's failure is not reported either; the page wires both reads through readLatest and shownFor", async () => {
    const { readLatest } = await import("@/lib/burnticker/latestRead");
    let calls = 0;
    const c = readLatest("A", (signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))), () => { calls++; });
    c(); await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls, 0);
    const page = read("src/app/burnticker/me/page.tsx");
    assert.match(page, /const d = shownFor\(slot, who\), err = shownFor\(errSlot, who\);/);
    assert.match(page, /return readLatest\(who, \(signal\) => fetch\(`\/api\/burnticker\/v1\/creators\/\$\{who\}`, \{ signal \}\)/);
    assert.match(page, /return readLatest\(mine, \(signal\) => fetch\(`\/burnticker\/creator\/\$\{mine\}\/summary`, \{ signal \}\)/);
    assert.match(page, /const sumRead = mine && sumSlot\?\.key === mine \? sumSlot : null;/);
  });
});

describe("H7: an error boundary, safe param decoding, and pages that survive odd API fields", () => {
  test("the Burnticker error boundary keeps the layout, retries the segment, and names a deploy only while /deploying.json exists", async () => {
    const src = read("src/app/burnticker/error.tsx");
    assert.match(src, /^"use client";/);
    assert.match(src, /const again = \(\) => \(retry \?\? reset\)\?\.\(\);/);
    assert.match(src, /\{deploying \? ERROR_COPY\.deploying : ERROR_COPY\.body\}/);
    assert.ok(!/<html|<body/.test(src), "inside the root layout: the site's header and footer stay");
    const g = read("config/public-repo/overlay/src/app/global-error.tsx");
    assert.match(g, /<html lang="en">/); assert.match(g, /\(retry \?\? reset\)\?\.\(\)/);
    const { ERROR_COPY, deployRunning } = await import("@/lib/burnticker/errorCopy");
    const { lintCopy } = await import("@/lib/launch/copyLint");
    for (const [k, t] of Object.entries(ERROR_COPY)) assert.deepEqual(lintCopy(t).hits, [], k);
    assert.doesNotMatch(ERROR_COPY.body, /updat/i, "the neutral text never blames an update");
    const json = (ok: boolean) => (async () => new Response("{}", { status: ok ? 200 : 404, headers: { "content-type": ok ? "application/json" : "text/html" } })) as unknown as typeof fetch;
    assert.equal(await deployRunning(json(true)), true);
    assert.equal(await deployRunning(json(false)), false);
    assert.equal(await deployRunning((async () => { throw new Error("offline"); }) as unknown as typeof fetch), false);
  });
  test("a param such as %E0 no longer throws URIError (before: decodeURIComponent on an already-decoded param crashed the page)", async () => {
    const { safeParam } = await import("@/lib/burnticker/safeParam");
    assert.throws(() => decodeURIComponent("%E0"), URIError);
    assert.equal(safeParam("%E0"), "%E0");
    assert.equal(safeParam("A%20B"), "A%20B", "audit 2026-10-18 A-42: Next already decoded the param once; it is never decoded again");
    const { resolveLeagueSeason } = await import("@/lib/burnticker/leagues");
    assert.equal(resolveLeagueSeason("%E0", "%E0"), null);
    const { creatorData } = await import("@/lib/burnticker/creatorServe");
    assert.deepEqual(await creatorData("%E0"), { kind: "bad-wallet" });
    for (const f of ["src/app/burnticker/embed/[ticker]/route.ts", "src/app/burnticker/embed/pairs/[pairId]/route.ts", "src/lib/burnticker/creatorServe.ts", "src/app/burnticker/creator/[wallet]/page.tsx", "src/lib/burnticker/leagues.ts", "src/app/burnticker/derby/[tournamentId]/page.tsx", "src/lib/burnticker/badgeServe.ts", "src/lib/burnticker/feeds.ts", "src/lib/burnticker/api/product.ts", "src/app/api/burnticker/v1/check/receipts/[signature]/route.ts", "src/app/api/burnticker/v1/verify-mint/[mint]/route.ts"])
      assert.ok(!/(?<!try \{ (raw = )?)decodeURIComponent\(/.test(read(f)), `${f} decodes through safeParam`);
  });
  test("the embed route answers a malformed id without throwing", async () => {
    await makeWorld();
    const { GET } = await import("../src/app/burnticker/embed/[ticker]/route.ts") as unknown as { GET: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response> };
    const r = await GET(new Request("http://localhost:3000/burnticker/embed/%25E0"), { params: Promise.resolve({ ticker: "%E0" }) });
    assert.ok(r.status < 500, String(r.status));
  });
  test("API fields that are missing or not numbers show a dash, never a crash; the receipt checker checks r.ok", async () => {
    const { fixed, joinList, finiteNumber } = await import("@/lib/burnticker/safeFormat");
    assert.equal(fixed(1.234), "1.23"); assert.equal(fixed("2.5"), "2.50"); assert.equal(fixed(undefined), "—"); assert.equal(fixed(null), "—"); assert.equal(fixed(NaN), "—"); assert.equal(fixed(Infinity), "—"); assert.equal(fixed("x"), "—");
    assert.equal(joinList(["a", "b"], "; "), "a; b"); assert.equal(joinList(undefined, "; "), ""); assert.equal(joinList("ab", "; "), ""); assert.equal(joinList(["a", null, 3], ","), "a,3");
    assert.equal(finiteNumber("NaN"), null); assert.equal(finiteNumber("12"), 12); assert.equal(finiteNumber(""), null);
    const coin = read("src/app/burnticker/t/[ticker]/page.tsx"), pair = read("src/app/burnticker/p/[pairId]/page.tsx");
    assert.ok(!/\.pctOfSupply\.toFixed|\.toFixed\(2\)\}%|operator\.can\.join|checks\.join/.test(coin), "the coin page formats API fields through safeFormat");
    assert.match(coin, /readings\.filter\(\(r\) => r\.value !== null && finiteNumber\(r\.value\) !== null\)/);
    assert.ok(!/supplyPctA\.toFixed|x\.pct\.toFixed/.test(pair));
    assert.match(read("src/app/burnticker/check/ReceiptVerifier.tsx"), /if \(!r\.ok\) throw new Error\(`The sample receipts could not be loaded just now/);
  });
});

describe("V1 and the check page's standing limitations", () => {
  test("the $DEFICIT footer's trade sentence (it ends in the full trade URL) wraps instead of pushing the page sideways at 320 and 390 px", () => {
    const html = read("site/deficit/index.html");
    assert.match(html, /footer #trade,footer \.gap,footer \.links a\{overflow-wrap:anywhere\}/);
    assert.match(html, /\$\("trade"\)\.textContent = "\$DEFICIT trades on Raydium\.[^"]*The trade link is " \+ url;/, "the sentence that carries the URL");
  });
  test("the limitations match the current facts: the operator statement's state (signed, or a template awaiting the owner's signature) and pair launches are on; history is dated", async () => {
    const { buildChecklist } = await import("@/lib/burnticker/trustpack/checklist");
    const c = buildChecklist(process.cwd());
    const text = c.notDone.map((n) => `${n.id}: ${n.text}`).join("\n");
    const op = JSON.parse(read("config/burnticker/operator.json")) as { signedMessage: { signature: string | null } };
    // 2026-10-19: the text changed to name both keeper keys, so the file is a template until the owner re-signs it; the limitation then stands
    const signedNow = op.signedMessage.signature !== null;
    assert.equal(c.notDone.some((n) => n.id === "signed-operator-message"), !signedNow, "a signed statement is not a standing limitation; an unsigned one is");
    if (signedNow) assert.doesNotMatch(text, /statement is not signed yet/i);
    assert.doesNotMatch(text, /pair launches stay off/i);
    const pair = c.notDone.find((n) => n.id === "paircurve-findings-open");
    assert.match(pair?.text ?? "", /As of 2026-10-11, round 3 had not had an independent re-check of its own\./);
    assert.match(pair?.text ?? "", /Pair launches are on/);
    const { lintCopy } = await import("@/lib/launch/copyLint");
    const t = JSON.parse(read("config/burnticker/transparency.json")) as { limitations: { id: string; text: string }[] };
    for (const id of ["signed-operator-message", "paircurve-findings-open"]) assert.deepEqual(lintCopy(t.limitations.find((l) => l.id === id)!.text).hits, [], id);
    assert.doesNotMatch(read("docs/burnticker/CHECK-THIS-YOURSELF.md"), /statement is not signed yet|pair launches stay off/);
  });
});

describe("re-review: no echoed error carries an RPC or feed address with its key", () => {
  const LEAK = "fetch failed at https://mainnet.helius-rpc.com/?api-key=SECRET123 (503)";
  test("runV1's catch-all and the launch verifier's RPC-read refusals hide the address (before: the full message, key included)", async () => {
    const { runV1 } = await import("@/lib/burnticker/api/http");
    const r = await runV1("getCurrentStatus", new Request("http://bt.test/api/burnticker/v1/current-status", { headers: { "x-forwarded-for": "203.0.113.41" } }), async () => { throw new Error(LEAK); });
    const text = await r.text();
    assert.doesNotMatch(text, /SECRET123|helius-rpc/); assert.match(text, /\[address hidden\]/);
    const { connectionLaunchVerifier } = await import("@/lib/burnticker/launchVerify");
    const v = connectionLaunchVerifier({ getTransaction: async () => { throw new Error(LEAK); } } as never, { burnProgramId: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM" });
    const out = await v.verify("5".repeat(88), {} as never);
    assert.ok(!out.ok);
    assert.doesNotMatch(JSON.stringify(out), /SECRET123|helius-rpc/);
  });
  test("every named read routes its message through safeErrorText", () => {
    for (const f of ["src/lib/burnticker/api/http.ts", "src/lib/burnticker/launchVerify.ts", "src/lib/burnticker/coverage/preflight.ts"]) assert.ok(!/\(e as Error\)\.message/.test(read(f)), f);
    const v1 = read("src/lib/burnticker/api/v1.ts");
    assert.ok(!/fail\(\d+, \(e as Error\)\.message|e\.message\.slice/.test(v1), "v1.ts");
    const h = read("src/lib/burnticker/api/handlers.ts");
    assert.match(h, /takeLiveFromChain\([^\n]*catch \(e\) \{ return fail\(409, safeErrorText\(e, 600\), \{ code: "launch-race" \}\); \}/);
    assert.ok(!/fail\(\d+, \(e as Error\)\.message/.test(h), "handlers.ts");
  });
});
