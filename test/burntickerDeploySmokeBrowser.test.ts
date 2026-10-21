// The deploy smoke's 2026-10-20 additions: the browser step (HB-143), the route retry (HB-138) and the coin gate's routes (HB-100).
// The smoke scripts are private ops (scripts/ops is not in config/public-repo.allowlist): in the public tree these tests skip.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.join(import.meta.dirname, "..");
const BROWSER = path.join(ROOT, "scripts/ops/burnticker-browser-check.mts");
const SMOKE = path.join(ROOT, "scripts/ops/burnticker-deploy-smoke.mts");
const SH = path.join(ROOT, "scripts/ops/burnticker-deploy-smoke.sh");
const PRIVATE = fs.existsSync(BROWSER) && fs.existsSync(SMOKE) && fs.existsSync(SH);
const skip = PRIVATE ? false : "the smoke is private ops (not in the public tree)";

// the modules' shapes, written out: a static type import would make the public tree's import check follow a private file
type PR = { name: string; ok: boolean; line: string; saw: string[] };
type Spec = { name: string; path: string; landmark: unknown };
interface BC {
  browserPages(coin?: string): Spec[];
  checkPage(page: never, origin: string, spec: Spec, o?: { now?: () => number; timeoutMs?: number; settleMs?: number; pollMs?: number }): Promise<PR>;
  runBrowserCheck(origin: string, o?: { env?: Record<string, string>; load?: () => unknown; pageOpts?: { settleMs?: number } }): Promise<{ ok: boolean; skipped: boolean; line: string; pages: PR[] }>;
  loadPlaywright(env: Record<string, string>, from?: string): { skip: string } | { chromium: unknown };
}
type Route = { path: string; ok: readonly number[]; html?: RegExp };
interface SM {
  runSmoke(origin: string, o: { fetchImpl: typeof fetch; env: Record<string, string>; sleep?: (ms: number) => Promise<void>; retryPauseMs?: number }): Promise<{ name: string; ok: boolean; line: string }[]>;
  ROUTE_RETRY_PAUSE_MS: number;
  SMOKE_ROUTES: readonly Route[];
  routeProblem(rt: Route, r: { status: number; text: string; timedOut: boolean; error: string | null }): string | null;
  serverHtml(html: string): string;
}
const browser = async (): Promise<BC> => import(pathToFileURL(BROWSER).href) as Promise<BC>;
const smoke = async (): Promise<SM> => import(pathToFileURL(SMOKE).href) as Promise<SM>;

const ORIGIN = "https://bt.test";
type Snap = { title: string; text: string; headings: string[]; boundary: boolean; gridState: string | null };
type Msg = { type: string; text: string; url?: string };

/**
 * A fake Playwright page: `snaps` are what successive evaluate() calls see (the last one repeats), `console` and `errors` fire during
 * goto, `status` is the document's answer. A fake clock moves 500 ms per waitForTimeout.
 */
function fakePage(o: { snaps: Snap[]; console?: Msg[]; errors?: string[]; status?: number; gotoThrows?: string }) {
  const handlers: Record<string, ((x: unknown) => void)[]> = {};
  let i = 0, clock = 0;
  const page = {
    on(ev: string, cb: (x: unknown) => void) { (handlers[ev] ??= []).push(cb); return page; },
    async goto() {
      if (o.gotoThrows) throw new Error(o.gotoThrows);
      for (const m of o.console ?? []) for (const h of handlers.console ?? []) h({ type: () => m.type, text: () => m.text, location: () => ({ url: m.url ?? "" }) });
      for (const e of o.errors ?? []) for (const h of handlers.pageerror ?? []) h(new Error(e));
      return { status: () => o.status ?? 200 };
    },
    async evaluate<T>(): Promise<T> { const s = o.snaps[Math.min(i, o.snaps.length - 1)]; i++; return s as T; },
    async waitForTimeout(ms: number) { clock += ms; },
    async close() {},
    get evaluations() { return i; },
  };
  return { page, now: () => clock };
}
const snap = (p: Partial<Snap> = {}): Snap => ({ title: "Trust · Burnticker", text: "", headings: [], boundary: false, gridState: null, ...p });

describe("HB-143: the browser step judges what a real browser shows", { skip }, () => {
  test("Trust: the crash (error boundary after the status fetch) fails; the rendered page with Review findings passes", async () => {
    const b = await browser();
    const trust = b.browserPages().find((p) => p.name === "trust")!;
    // the HB-143 shape: the shell renders, then the client render throws and the boundary replaces it
    const crash = fakePage({ snaps: [snap({ text: "Trust Loading" }), snap({ text: "Something went wrong This page could not be shown.", boundary: true })], console: [{ type: "error", text: "[burnticker] page error: TypeError: Cannot read properties of undefined", url: `${ORIGIN}/_next/static/chunks/app.js` }] });
    const bad = await b.checkPage(crash.page as never, ORIGIN, trust, { now: crash.now });
    assert.equal(bad.ok, false);
    assert.match(bad.line, /error boundary/);
    assert.ok(bad.saw.some((l) => /console error: \[burnticker\] page error/.test(l)), "it prints what it saw");
    const good = fakePage({ snaps: [snap({ text: "Trust Loading" }), snap({ text: "Current status ... Review findings: what was fixed" })] });
    const ok = await b.checkPage(good.page as never, ORIGIN, trust, { now: good.now });
    assert.equal(ok.ok, true, ok.line);
    assert.ok(ok.saw.some((l) => /landmark "Review findings": found/.test(l)));
  });

  test("a page that waits past its settle time still catches a crash after the landmark appeared", async () => {
    const b = await browser();
    const trust = b.browserPages()[0];
    const late = fakePage({ snaps: [snap({ text: "Review findings" }), snap({ text: "Review findings" }), snap({ text: "This page could not be shown.", boundary: true })] });
    const r = await b.checkPage(late.page as never, ORIGIN, trust, { now: late.now, settleMs: 1_000, pollMs: 500 });
    assert.equal(r.ok, false);
    assert.match(r.line, /error boundary/);
  });

  test("home: the coin list must reach results or empty; loading at the timeout and an error state fail", async () => {
    const b = await browser();
    const home = b.browserPages().find((p) => p.name === "home")!;
    const loading = fakePage({ snaps: [snap({ gridState: "loading" })] });
    const r1 = await b.checkPage(loading.page as never, ORIGIN, home, { now: loading.now, timeoutMs: 5_000 });
    assert.equal(r1.ok, false); assert.match(r1.line, /coin list .* is missing \(grid state loading\)/);
    const err = fakePage({ snaps: [snap({ gridState: "error" })] });
    assert.equal((await b.checkPage(err.page as never, ORIGIN, home, { now: err.now, timeoutMs: 2_000 })).ok, false);
    const fine = fakePage({ snaps: [snap({ gridState: "loading" }), snap({ gridState: "results" })] });
    assert.equal((await b.checkPage(fine.page as never, ORIGIN, home, { now: fine.now })).ok, true);
  });

  test("console errors: the site's own fail; a handled 503 or 404 fetch and another origin's frame are notes", async () => {
    const b = await browser();
    const launch = b.browserPages().find((p) => p.name === "launch")!;
    const s = snap({ headings: ["Launch a coin"] });
    const own = fakePage({ snaps: [s], console: [{ type: "error", text: "Refused to connect to 'https://x.example' because it violates the Content Security Policy", url: `${ORIGIN}/burnticker/launch` }] });
    const r = await b.checkPage(own.page as never, ORIGIN, launch, { now: own.now });
    assert.equal(r.ok, false); assert.match(r.line, /1 console error, first: Refused to connect/);
    const notes = fakePage({ snaps: [s], console: [
      { type: "error", text: "Failed to load resource: the server responded with a status of 503 ()", url: `${ORIGIN}/api/burnticker/home` },
      { type: "error", text: "Failed to load resource: the server responded with a status of 404 ()", url: `${ORIGIN}/api/burnticker/tokens/DEFICIT` },
      { type: "error", text: "chart failed", url: "https://www.geckoterminal.com/embed.js" },
      { type: "warning", text: "a warning", url: `${ORIGIN}/x` },
    ] });
    const n = await b.checkPage(notes.page as never, ORIGIN, launch, { now: notes.now });
    assert.equal(n.ok, true, n.line);
    assert.equal(n.saw.filter((l) => /note, not a failure/.test(l)).length, 3);
    const five = fakePage({ snaps: [s], console: [{ type: "error", text: "Failed to load resource: the server responded with a status of 500 ()", url: `${ORIGIN}/api/burnticker/x` }] });
    assert.equal((await b.checkPage(five.page as never, ORIGIN, launch, { now: five.now })).ok, false, "a 500 is not a handled answer");
  });

  test("an uncaught page error, a non-200 document, a failed load and a missing heading each fail with their sentence", async () => {
    const b = await browser();
    const [, , launch, coin] = b.browserPages("deficit");
    const s = snap({ headings: ["Launch a coin Devnet"] });
    const pe = fakePage({ snaps: [s], errors: ["ReferenceError: x is not defined"] });
    assert.match((await b.checkPage(pe.page as never, ORIGIN, launch, { now: pe.now })).line, /uncaught error in the page: ReferenceError/);
    const st = fakePage({ snaps: [s], status: 502 });
    assert.match((await b.checkPage(st.page as never, ORIGIN, launch, { now: st.now })).line, /HTTP 502/);
    const gt = fakePage({ snaps: [s], gotoThrows: "net::ERR_NAME_NOT_RESOLVED" });
    assert.match((await b.checkPage(gt.page as never, ORIGIN, launch, { now: gt.now })).line, /did not load \(net::ERR_NAME_NOT_RESOLVED\)/);
    const nh = fakePage({ snaps: [snap({ headings: ["Coins"] })] });
    assert.match((await b.checkPage(nh.page as never, ORIGIN, launch, { now: nh.now, timeoutMs: 1_000 })).line, /"Launch a coin" heading is missing/);
    assert.equal(coin.path, "/burnticker/t/DEFICIT");
    const c = fakePage({ snaps: [snap({ headings: ["$DEFICIT"] })] });
    assert.equal((await b.checkPage(c.page as never, ORIGIN, coin, { now: c.now })).ok, true);
  });

  test("no Playwright or no Chrome: the step is skipped with a clear line and passes; BURNTICKER_SMOKE_BROWSER=0 skips it", async () => {
    const b = await browser();
    const none = await b.runBrowserCheck(ORIGIN, { load: () => ({ skip: "playwright-core is not installed in this checkout (it is a devDependency: run npm install)" }) });
    assert.deepEqual([none.ok, none.skipped], [true, true]);
    assert.match(none.line, /^browser check skipped: playwright-core is not installed/);
    const noChrome = await b.runBrowserCheck(ORIGIN, { env: {}, load: () => ({ chromium: { launch: async () => { throw new Error("Chromium distribution 'chrome' is not found at /Applications/Google Chrome.app\nmore"); } } }) as never });
    assert.deepEqual([noChrome.ok, noChrome.skipped], [true, true]);
    assert.match(noChrome.line, /^browser check skipped: Chrome \(channel "chrome"\) could not be started: Chromium distribution 'chrome' is not found/);
    const off = b.loadPlaywright({ BURNTICKER_SMOKE_BROWSER: "0" });
    assert.ok("skip" in off && /BURNTICKER_SMOKE_BROWSER=0/.test(off.skip));
    const missing = b.loadPlaywright({}, pathToFileURL(path.join("/nonexistent-dir", "x.mjs")).href);
    assert.ok("skip" in missing && /run npm install/.test(missing.skip));
  });

  test("runBrowserCheck: a fresh context per page, the Mac's Chrome channel, headless; one failing page fails the step", async () => {
    const b = await browser();
    const launches: unknown[] = [];
    let contexts = 0;
    const pages = b.browserPages();
    const snapsFor: Record<string, Snap> = { trust: snap({ text: "Review findings" }), home: snap({ gridState: "results" }), launch: snap({ headings: ["Launch a coin"] }), coin: snap({ headings: ["$DEFICIT"] }) };
    let n = 0;
    const chromium = { launch: async (o: unknown) => { launches.push(o); return { newContext: async () => { contexts++; const name = pages[n++].name; const f = fakePage({ snaps: [name === "launch" ? snap({ text: "This page could not be shown.", boundary: true }) : snapsFor[name]] }); return { newPage: async () => f.page, close: async () => {} }; }, close: async () => {} }; } };
    const r = await b.runBrowserCheck(ORIGIN, { env: {}, load: () => ({ chromium }) as never, pageOpts: { settleMs: 0 } });
    assert.deepEqual(launches, [{ channel: "chrome", headless: true }]);
    assert.equal(contexts, 4);
    assert.equal(r.ok, false); assert.equal(r.skipped, false);
    assert.match(r.line, /The browser check failed: \/burnticker\/launch: the page shows the error boundary/);
    assert.deepEqual(r.pages.map((p) => [p.name, p.ok]), [["trust", true], ["home", true], ["launch", false], ["coin", true]]);
  });

  test("the smoke's shell runs the browser step after the HTTP checks, and the step stays private", () => {
    const sh = fs.readFileSync(SH, "utf8");
    const http = sh.indexOf("scripts/ops/burnticker-deploy-smoke.mts \"$ORIGIN\""), br = sh.indexOf("scripts/ops/burnticker-browser-check.mts \"$ORIGIN\"");
    assert.ok(http > 0 && br > http, "the browser step runs after the HTTP checks");
    assert.match(sh, /^set -eu$/m, "a failed HTTP check stops before the browser step");
    assert.ok(!/^exec node[^\n]*burnticker-deploy-smoke\.mts/m.test(sh), "the HTTP checks no longer exec away the browser step");
    const allow = fs.readFileSync(path.join(ROOT, "config/public-repo.allowlist"), "utf8");
    assert.ok(!/browser-check/.test(allow));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    assert.match(pkg.devDependencies["playwright-core"] ?? "", /^\d+\.\d+\.\d+$/, "an exact version");
  });
});

describe("HB-138: a route that fails is asked again after a pause before the smoke calls it dead", { skip }, () => {
  const fakeFetch = (fails: Map<string, number>) => (async (u: string) => {
    const url = new URL(u);
    const left = fails.get(url.pathname) ?? 0;
    if (left > 0) { fails.set(url.pathname, left - 1); return new Response("x", { status: 503 }); }
    if (url.pathname === "/burnticker/t/NOPE") return new Response("<html><h1>We could not find that page.</h1></html>", { status: 404 });
    if (url.pathname === "/burnticker/no-such-page-deploy-smoke") return new Response("", { status: 404 });
    if (url.pathname.endsWith("/")) return new Response(null, { status: 308 });
    if (url.pathname === "/api/burnticker/build") return new Response(JSON.stringify({ build: "b" }), { status: 200 });
    if (url.pathname.startsWith("/burnticker")) return new Response("<html></html>", { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

  test("passing on the second try: the routes check passes and names the route 'slow on the first try'", async () => {
    const s = await smoke();
    const pauses: number[] = [];
    const c = await s.runSmoke(ORIGIN, { fetchImpl: fakeFetch(new Map([["/burnticker/about", 1], ["/burnticker/derby", 1]])), env: {}, sleep: async (ms) => { pauses.push(ms); } });
    const routes = c.find((x) => x.name === "routes")!;
    assert.equal(routes.ok, true, routes.line);
    assert.match(routes.line, /slow on the first try: .*\/burnticker\/about \(HTTP 503 \(wanted 200\), then 200 in \d+ ms\)/);
    assert.match(routes.line, /\/burnticker\/derby/);
    assert.deepEqual(pauses, [15_000], "one 15 s pause for the whole retry");
    assert.equal(s.ROUTE_RETRY_PAUSE_MS, 15_000);
  });

  test("failing twice: the route is wrong, and the line says it failed twice", async () => {
    const s = await smoke();
    const c = await s.runSmoke(ORIGIN, { fetchImpl: fakeFetch(new Map([["/burnticker/bounty", 2]])), env: {}, retryPauseMs: 0 });
    const routes = c.find((x) => x.name === "routes")!;
    assert.equal(routes.ok, false);
    assert.match(routes.line, /1 route\(s\) answered wrong: \/burnticker\/bounty HTTP 503 \(wanted 200\) \(twice; first: HTTP 503 \(wanted 200\)\)/);
  });

  test("no failure: no pause at all", async () => {
    const s = await smoke();
    let paused = false;
    const c = await s.runSmoke(ORIGIN, { fetchImpl: fakeFetch(new Map()), env: {}, sleep: async () => { paused = true; } });
    assert.equal(c.find((x) => x.name === "routes")!.ok, true);
    assert.equal(paused, false);
  });
});

describe("HB-100: the smoke's route list checks the proxy's coin gate", { skip }, () => {
  test("/burnticker/t/NOPE must be 404 (never 500); /burnticker/t/DEFICIT must be 200", async () => {
    const s = await smoke();
    const nope = s.SMOKE_ROUTES.find((r) => r.path === "/burnticker/t/NOPE")!;
    assert.deepEqual(nope.ok, [404]);
    assert.deepEqual(s.SMOKE_ROUTES.find((r) => r.path === "/burnticker/t/DEFICIT")!.ok, [200]);
    const base = { timedOut: false, error: null };
    assert.equal(s.routeProblem(nope, { ...base, status: 404, text: "<main><h1>We could not find that page.</h1></main>" }), null);
    // the HB-100 bug: the words only in the client payload (a script), Next's bare error document in the HTML
    // publish 103: the server-rendered copy is off until the rewrite works behind Caddy; any 404 passes, a 500 never does
    assert.equal(s.routeProblem(nope, { ...base, status: 404, text: "<html><body>404</body></html>" }), null);
    assert.match(s.routeProblem(nope, { ...base, status: 500, text: "error" }) ?? "", /HTTP 500 \(wanted 404\)/);
    assert.match(s.routeProblem(nope, { ...base, status: 200, text: "could not find" }) ?? "", /HTTP 200 \(wanted 404\)/);
    assert.equal(s.serverHtml("a<script type=\"x\">b</script>c<SCRIPT>d</SCRIPT>e"), "ace");
    const src = fs.readFileSync(SMOKE, "utf8");
    assert.match(src, /\/burnticker\/t\/NOPE answers 404 \(any 404; since the\n\/\/\s+publish 103 hotfix the server-rendered not-found words are not required/, "the note in the route list's comment (reviewer H)");
  });
});
