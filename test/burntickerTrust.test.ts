// BURNTICKER TRUST PAGE — the transparency block (the owner, 2026-10-09: "make sure everything is transparent. i dont want to hide
// anything"): the committed config validates, every wallet role the owner named is present and reads TODO until a pubkey is set
// (from the file or the environment), unbuilt things are "not built" and never "coming soon", the decision log and changelog
// render as append-only entries, and buildTrustPage carries it all alongside the register.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTransparency, buildTrustPage, loadTransparency, readMarkdownLog, resolveWallets, teamWallets, transparencyProblems, DECISIONS_FILE, CHANGELOG_FILE, TRANSPARENCY_FILE, type TransparencyConfig } from "@/lib/burnticker/trust";
import { OPERATOR_LINE } from "@/lib/burnticker/fees";

const ROOT = path.resolve(import.meta.dirname, "..");
const KEEPER = "KeeperDataKey1111111111111111111111111111111";

describe("transparency.json", () => {
  test("the committed file validates and names every wallet role the owner listed", () => {
    const cfg = loadTransparency(ROOT);
    assert.equal(cfg.schema, "burnticker.transparency/v1");
    const roles = cfg.wallets.map((w) => w.role);
    for (const r of ["ops", "deployer", "keeper", "dev-fee", "squads-vault", "squads-member-1", "squads-member-2", "squads-member-3", "mint-deficit"]) assert.ok(roles.includes(r), `wallet role ${r}`);
    assert.ok(cfg.howBuilt.aiAssisted && !cfg.howBuilt.firmAudit, "written with AI assistance; not audited by a firm — both stated");
    assert.equal(cfg.howBuilt.reviews.length, 4, "three blind Claude reviews (the third with its re-check) + the pending ChatGPT review");
    assert.deepEqual(cfg.howBuilt.reviews.filter((r) => r.reportPath).map((r) => r.id), ["claude-blind-1", "claude-blind-2", "claude-blind-3"]);
    assert.equal(cfg.howBuilt.reviews.find((r) => r.id === "chatgpt-adversarial")?.status, "pending");
    const keeper = cfg.wallets.find((w) => w.role === "keeper")!;
    assert.ok(/recorded creator is the program's fee PDA/.test(keeper.description) && !/is LaunchLab's recorded creator/.test(keeper.description), "review H-2: the fee PDA, not the keeper, is the LaunchLab creator");
    const admin = cfg.wallets.find((w) => w.role === "platform-admin")!;
    assert.ok(/cannot be transferred to the Squads vault/.test(admin.description) && /untimelocked/.test(admin.description) && !/intended holder is the Squads vault/.test(admin.description), "D-3: the LaunchLab admin cannot move to Squads");
    assert.ok(cfg.limitations.some((l) => l.id === "quorum-1") && cfg.limitations.some((l) => l.id === "switchboard-down") && cfg.limitations.some((l) => l.id === "kalshi-offchain") && cfg.limitations.some((l) => l.id === "cap-25") && cfg.limitations.some((l) => l.id === "devnet-rehearsal") && cfg.limitations.some((l) => l.id === "one-shot"));
    assert.ok(cfg.policies.some((p) => p.id === "x-no-deletions") && cfg.policies.some((p) => p.id === "platform-never-buys") && cfg.policies.some((p) => p.id === "no-paid-promotion") && cfg.policies.some((p) => p.id === "nothing-coming-soon"));
    assert.equal(cfg.whoRunsThis.refuseListCode, "src/lib/ownTokens.ts");
    // the two sentences the launch runbook's gates 7 and 8 look for, verbatim
    assert.equal(cfg.policies.find((p) => p.id === "no-telegram-discord")?.text, "No Telegram or Discord: Burnticker and $DEFICIT communicate only through @burnticker / @USA_DEFICIT on X and the public repository. Any channel claiming otherwise is not ours.");
    assert.equal(cfg.policies.find((p) => p.id === "failure-definition")?.text, "Failure definition: if any coin on this platform trades at any price, nothing changes — no relaunch, no v2, no rebrand, no change to a rule. The rule runs and the receipts post.");
    // the rehearsal-coin slot: declared, not done, and on the bots' refuse list
    const reh = cfg.rehearsals.find((r) => r.symbol === "REHEARSAL")!;
    assert.ok(reh && reh.mint === null && reh.status === "not done" && /not for trading/.test(reh.text));
    const own = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.whoRunsThis.refuseListConfig), "utf8")) as { tokens: { symbol: string }[] };
    assert.ok(own.tokens.some((t) => t.symbol === "REHEARSAL") && own.tokens.some((t) => t.symbol === "DEFICIT"), "every platform coin, rehearsal included, is on the refuse list");
    assert.ok(fs.existsSync(path.join(ROOT, cfg.whoRunsThis.refuseListCode)) && fs.existsSync(path.join(ROOT, cfg.whoRunsThis.refuseListConfig)), "the refuse list it links to exists");
  });

  test("the validator refuses a missing role, a bad pubkey, a duplicate, and the words 'coming soon'", () => {
    const good = loadTransparency(ROOT);
    assert.deepEqual(transparencyProblems(good), []);
    const noOps = { ...good, wallets: good.wallets.filter((w) => w.role !== "ops") };
    assert.ok(transparencyProblems(noOps).some((p) => p.includes("role ops missing")));
    const badKey = { ...good, wallets: good.wallets.map((w) => (w.role === "keeper" ? { ...w, pubkey: "0xnot-a-solana-key" } : w)) };
    assert.ok(transparencyProblems(badKey).some((p) => p.includes("not a base58")));
    const dup = { ...good, wallets: [...good.wallets, good.wallets[0]] };
    assert.ok(transparencyProblems(dup).some((p) => p.includes("duplicate")));
    const soon = { ...good, limitations: [...good.limitations, { id: "x", status: "planned", text: "zkTLS attester coming soon" }] };
    assert.ok(transparencyProblems(soon).some((p) => p.includes("coming soon")));
    assert.ok(transparencyProblems(null).length > 0);
    assert.ok(transparencyProblems({ ...good, rehearsals: [{ ...good.rehearsals[0], mint: "nope" }] }).some((p) => p.includes("mint is not")));
    assert.ok(transparencyProblems({ ...good, rehearsals: [{ ...good.rehearsals[0], date: "10/09/2026" }] }).some((p) => p.includes("date must be")));
    assert.ok(transparencyProblems({ ...good, policies: good.policies.filter((p) => p.id !== "failure-definition") }).some((p) => p.includes("policy failure-definition missing")));
    assert.ok(transparencyProblems({ ...good, schema: "other" as TransparencyConfig["schema"] }).some((p) => p.includes("schema")));
  });

  test("wallets read TODO until a pubkey is set in the file or the named environment variable", () => {
    const cfg = loadTransparency(ROOT);
    const bare = resolveWallets(cfg, {});
    assert.ok(bare.every((w) => w.source === "todo" && w.resolved === null), "nothing is set yet: every row is a TODO, none is blank");
    const withEnv = resolveWallets(cfg, { BURNTICKER_KEEPER_PUBKEY: KEEPER });
    const keeper = withEnv.find((w) => w.role === "keeper")!;
    assert.equal(keeper.resolved, KEEPER); assert.equal(keeper.source, "env");
    const inFile = resolveWallets({ ...cfg, wallets: cfg.wallets.map((w) => (w.role === "ops" ? { ...w, pubkey: KEEPER } : w)) }, {});
    assert.equal(inFile.find((w) => w.role === "ops")!.source, "file");
    assert.equal(resolveWallets(cfg, { BURNTICKER_KEEPER_PUBKEY: "garbage" }).find((w) => w.role === "keeper")!.source, "todo");
  });
});

describe("decision log and changelog", () => {
  test("the decision log has the dated entries of 2026-10-09 and the changelog says no deploy yet", () => {
    const d = readMarkdownLog(ROOT, DECISIONS_FILE);
    assert.ok(d.present && d.entries >= 9, `expected at least 9 decisions, got ${d.entries}`);
    for (const t of ["Name: Burnticker", "Fees:", "LP:", "Clean-platform standard", "Audit:", "Switchboard is gone", "Total transparency"]) assert.ok(d.markdown.includes(t), t);
    assert.ok(/^## 2026-10-09 — /m.test(d.markdown), "entries are dated headings");
    assert.ok(!/coming soon/i.test(d.markdown));
    const c = readMarkdownLog(ROOT, CHANGELOG_FILE);
    assert.ok(c.present && c.entries >= 1 && c.markdown.includes("no publish and no deploy yet"));
    const missing = readMarkdownLog(ROOT, "docs/burnticker/does-not-exist.md");
    assert.deepEqual(missing, { markdown: "", entries: 0, file: "docs/burnticker/does-not-exist.md", present: false });
  });
});

describe("buildTransparency / buildTrustPage", () => {
  test("the section carries the operator's real name, the refuse-list presence, the reviews' presence and the TODO count", () => {
    const t = buildTransparency(ROOT, {});
    assert.equal(t.whoRunsThis.operatorLine, OPERATOR_LINE);
    assert.ok(t.whoRunsThis.operatorLine.includes("the Burnticker operator"));
    assert.equal(t.whoRunsThis.refuseListPresent, true);
    assert.equal(t.howBuilt.reviewsReadmePresent, true);
    assert.deepEqual(t.howBuilt.reportsPresent.map((r) => r.present), [true, true, true, false], "the three Claude reports exist; the ChatGPT review has none yet and the page says so");
    assert.equal(t.walletsTodo, t.wallets.length);
    assert.ok(t.decisions.entries >= 9 && t.changelog.entries >= 1);
  });

  test("on a root without the files: the loader throws (no half-truth) and the logs read as absent", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-trust-"));
    assert.throws(() => buildTransparency(tmp, {}));
    fs.mkdirSync(path.join(tmp, "config", "burnticker"), { recursive: true });
    fs.copyFileSync(path.join(ROOT, TRANSPARENCY_FILE), path.join(tmp, TRANSPARENCY_FILE));
    const t = buildTransparency(tmp, {});
    assert.equal(t.whoRunsThis.refuseListPresent, false);
    assert.equal(t.howBuilt.reviewsReadmePresent, false);
    assert.equal(t.decisions.present, false);
    const page = await buildTrustPage({ reader: null, env: { BURNTICKER_KEEPER_PUBKEY: KEEPER }, root: tmp, siteDir: tmp, attesters: [], now: Date.parse("2026-10-10T00:00:00Z") });
    assert.equal(page.transparency.wallets.find((w) => w.role === "keeper")!.resolved, KEEPER);
    assert.ok(page.powers.placeholder);
    assert.ok(page.statements.some((s) => s.startsWith("No Telegram or Discord:")) && page.statements.some((s) => s.startsWith("Failure definition:")), "gates 7 and 8 among the standing facts");
    assert.equal(page.transparency.rehearsals.length, 1);
  });

  test("team wallets come from the platform's own variables only — no trading-arm variable is read", () => {
    const t = teamWallets({ BURNTICKER_FEE_WALLET: KEEPER, LIVE_WALLET_ADDRESS: KEEPER }, ROOT);
    assert.deepEqual(t.wallets.map((w) => w.label), ["developer fee wallet"]);
  });
});
