// LAUNCH NIGHT 2026-10-13: the owner's first website launch ($PHINFLWIN, Eagles 2026 wins) and the bugs it hit, each reproduced on a local
// dev server against a registry seeded like makeWorld (a live coin beside the never-created draft of the same coin), then fixed here:
//   1 a failed launch step: the saved draft keeps its whole content (a kept slot), and "Start a new launch from the review" opens the review
//   2 "Your coins": a draft card says it is not created (no "live", no wind-down), and the checklist's "(the creator)" tail is gone
//   3 the review's duplicate notice counts created coins only
//   4 the league buttons are named by their league ("NFL"), the tooltip has one period
//   5 a page from an earlier build says so in one line (no reload by itself)
//   6 a wallet slower than the blockhash: the step is rebuilt and signed again, the integrity check still first
//   7 the hunt: the smaller wrong sentences and states found walking every coin kind
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { buildStepTx, launchlabPlan, memoryPlanStorage, signAndSendPlan, RESIGN_MAX, STALE_BLOCKHASH_MS, resignSentence, resignExhaustedSentence, type LaunchlabBundleLike, type SignPlan, type SendDeps } from "@/lib/burnticker/signPlan";
import { DRAFT_STORE, KEPT_STORE, draftLabel, isReviewedDraft, nextKept, pickOffer, resumeReviewHref, savedDraftLine } from "@/lib/burnticker/launchDraftStore";
import { DRAFT_CHIP, DRAFT_LINE, DRAFT_NEXT_LINE, DRAFTS_HEADING, EXPIRED_LINE, draftSupersededLine, isCreatedState, meCoinView, splitMeCoins, stateChip } from "@/lib/burnticker/meCoins";
import { AFTER_CREATE, checklistNextLine, checklistOf } from "@/lib/burnticker/checklist";
import { EXPIRED_DRAFT_LINE, NOT_CREATED_LINE, lifecycleFrom } from "@/lib/burnticker/tokenPage";
import { existingCoinsFor, isCreatedStatus } from "@/lib/burnticker/duplicateRuleMatch";
import { STALE_PAGE_LINE, mayCheck, staleNotice, usableBuildId, CHECK_EVERY_MS } from "@/lib/burnticker/buildVersion";
import { currentBuildId, resetBuildIdCache } from "@/lib/burnticker/buildVersionServer";
import { NO_SECOND_CHECK, TEAMS_NONE_LINE, TEAMS_UNREAD_LINE, leagueButtonName, leagueButtonTitle, pairBudgetLine } from "../src/app/burnticker/launch/pageCopy.ts";
import { costLine, endChoiceLabel, END_CHOICE_LABEL, END_CHOICE_LABEL_ENDS, budgetCopy } from "@/lib/burnticker/guidedLaunch";
import { denverDay } from "@/lib/burnticker/coinPage";
import { readinessOf } from "@/lib/burnticker/readiness";
import { outcomeNamer, searchHits } from "@/lib/burnticker/oracle/polymarket";
import { v1Creator } from "@/lib/burnticker/api/product";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { makeWorld, CREATOR as WORLD_CREATOR } from "./burntickerApiHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const clean = (t: string) => { const r = lintCopy(t, cfg); assert.ok(r.ok, `${r.hits.map((h) => `${h.phrase} (${h.rule})`).join(", ")}\n${t}`); assert.doesNotMatch(t, /\.\.(?!\.)/, `double period: ${t}`); };
const PAGE = read("src/app/burnticker/launch/page.tsx");

// ---- 1 ------------------------------------------------------------------------------------------------------------------------------
describe("1: a failed launch keeps the whole draft, and Start a new launch opens the review", () => {
  const reviewed = { guide: { follow: "team", phase: "review", pairKind: null }, step: "launch", name: "Eagles 2026 Wins", ticker: "PHINFLWIN", team: { abbr: "PHI" } };
  const touched = { guide: { follow: "team", phase: "which", pairKind: null }, step: "team", name: "", ticker: "" };
  test("the owner's sequence: one tap on step 1 after the failure no longer erases the draft", () => {
    // before: the in-progress snapshot (touched) was the only slot, so the line said "unnamed" and the review was gone
    assert.equal(isReviewedDraft(reviewed), true); assert.equal(isReviewedDraft(touched), false);
    assert.deepEqual(nextKept(touched, reviewed), reviewed, "an unreviewed snapshot never replaces the kept draft");
    assert.deepEqual(nextKept(reviewed, null), reviewed);
    assert.deepEqual(pickOffer(touched, reviewed), reviewed, "the kept draft is offered over an unnamed one in progress");
    assert.deepEqual(pickOffer({ ...reviewed, name: "Other" }, reviewed)?.name, "Other", "a named draft in progress is newer and wins");
    assert.equal(pickOffer(null, null), null);
    assert.equal(savedDraftLine(reviewed), "You have a draft: Eagles 2026 Wins ($PHINFLWIN).");
    assert.equal(draftLabel(touched), "a team coin, not named yet");
    for (const s of [savedDraftLine(reviewed), savedDraftLine(touched), draftLabel({ guide: { follow: "coins" } })]) { assert.doesNotMatch(s, /unnamed/); clean(s); }
    assert.equal(resumeReviewHref("/burnticker/launch"), "/burnticker/launch?resume=review");
    assert.equal(DRAFT_STORE, "burnticker.launch.v2"); assert.notEqual(KEPT_STORE, DRAFT_STORE);
  });
  test("the page: kept on every reviewed write, offered by pickOffer, opened on ?resume=review, cleared by Start over and by a live launch", () => {
    assert.match(PAGE, /sessionStorage\.setItem\(STORE, snapshot\); if \(isReviewedDraft\(JSON\.parse\(snapshot\)\)\) sessionStorage\.setItem\(KEPT_STORE, snapshot\);/);
    assert.match(PAGE, /return pickOffer\(read\(STORE\), read\(KEPT_STORE\)\);/);
    assert.match(PAGE, /const resumeReview = !linked && q0\.get\(RESUME_PARAM\) === RESUME_REVIEW;/);
    assert.match(PAGE, /else if \(resumeReview && offer\) restoreFrom\(offer\);/);
    assert.match(PAGE, /set\("step", \(v: Step\) => setStep\(v === "launch" \? "review" : v\)\)/, "a draft saved at the signing step reopens on its review");
    assert.match(PAGE, /sessionStorage\.removeItem\(STORE\); sessionStorage\.removeItem\(KEPT_STORE\); sessionStorage\.removeItem\(CVC_STORE\);/);
    assert.match(PAGE, /onLive=\{dropDraft\}/); assert.match(PAGE, /const dropDraft = \(\) => \{ launched\.current = true;/);
    assert.match(PAGE, /data-saved-draft>\{savedDraftLine\(savedDraft\)\}/); assert.doesNotMatch(PAGE, /"unnamed"/);
    for (const f of ["src/app/burnticker/launch/LaunchRecovery.tsx", "src/app/burnticker/launch/SignCard.tsx"]) assert.match(read(f), /window\.location\.assign\(resumeReviewHref\(window\.location\.pathname\)\)/, f);
    assert.match(read("src/app/burnticker/launch/SignCard.tsx"), /useEffect\(\(\) => \{ if \(allLive\) onLive\?\.\(\); \}, \[allLive\]\);/);
  });
});

// ---- 2 ------------------------------------------------------------------------------------------------------------------------------
describe("2: Your coins tells a draft from a created coin", () => {
  const live = { ticker: "PHINFLWIN", mint: "LiveMint", state: "curve" }, draft = { ticker: "PHINFLWIN", mint: "DraftMint", state: "draft" }, other = { ticker: "KCNFLWIN", mint: "KcMint", state: "draft" };
  test("a draft card: not created, never live, no wind-down; a draft left over from a later launch says so", () => {
    const all = [draft, live, other];
    assert.deepEqual(splitMeCoins(all), { created: [live], drafts: [draft, other] });
    const v = meCoinView(draft, all);
    assert.deepEqual([v.created, v.chip, v.launchLink], [false, DRAFT_CHIP, false]);
    assert.deepEqual(v.lines, [DRAFT_LINE, draftSupersededLine("PHINFLWIN")]);
    assert.deepEqual(meCoinView(other, all).lines, [DRAFT_LINE, DRAFT_NEXT_LINE]); assert.equal(meCoinView(other, all).launchLink, true);
    assert.deepEqual(meCoinView({ ...other, state: "expired" }, all).lines, [EXPIRED_LINE]);
    assert.equal(meCoinView(live, all).created, true);
    for (const s of ["curve", "graduated", "retired", "voided", "paused"]) assert.equal(isCreatedState(s), true, s);
    for (const t of [DRAFT_CHIP, DRAFT_LINE, DRAFT_NEXT_LINE, EXPIRED_LINE, DRAFTS_HEADING, draftSupersededLine("PHINFLWIN"), stateChip("curve"), stateChip("voided")]) { assert.doesNotMatch(t, /\blive\b/i); clean(t); }
  });
  test("the API: a draft has no wind-down line; its lifecycle line never says live", async () => {
    const w = await makeWorld();
    const mint = Keypair.generate().publicKey.toBase58();
    w.registry.register({ mint, ticker: w.bronco.ticker, name: w.bronco.name, creator: WORLD_CREATOR, description: "a test", imageUrl: null, links: [], rulesText: w.bronco.rulesJson, feePda: Keypair.generate().publicKey.toBase58(), vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: w.bronco.platformId, baselineAt: new Date().toISOString(), status: "draft" } as Parameters<typeof w.registry.register>[0]);
    const r = await v1Creator(w.p, WORLD_CREATOR);
    const coins = (r as unknown as { body: { coins: { mint: string; state: string; windDown: string | null }[] } }).body?.coins ?? (r as unknown as { coins: { mint: string; state: string; windDown: string | null }[] }).coins;
    const d = coins.find((c) => c.mint === mint)!, l = coins.find((c) => c.mint === w.bronco.mint)!;
    assert.equal(d.state, "draft"); assert.equal(d.windDown, null, "no wind-down on a draft card");
    assert.equal(l.windDown, "This coin is live.");
    const reg = { ruleEnd: () => null, receipts: () => [], getStatus: () => null } as unknown as Parameters<typeof lifecycleFrom>[0];
    const rule = { kind: "binary", binary: { onYes: { fractionOfPool: 0.02 }, onNo: null }, scalar: null, onEnd: { windDownDays: 28, sweepThresholdLamports: 1 } } as unknown as Parameters<typeof lifecycleFrom>[2];
    assert.equal(lifecycleFrom(reg, { mint, status: "draft" }, rule).line, NOT_CREATED_LINE);
    assert.equal(lifecycleFrom(reg, { mint, status: "expired" }, rule).line, EXPIRED_DRAFT_LINE);
    for (const t of [NOT_CREATED_LINE, EXPIRED_DRAFT_LINE]) { assert.doesNotMatch(t, /\blive\b/); clean(t); }
  });
  test("the checklist: who does the step is its own sentence (no \"(the creator)\" tail); a draft's later steps wait for the launch", () => {
    const draft = checklistOf({ ticker: "T", mint: "M", status: "draft", launched: false, phase: "curve", poolRegistered: null, readings: 0, burns: 0 });
    const line = checklistNextLine(draft);
    assert.equal(line, "Next: Sign the launch transaction in your wallet. The draft is kept for 24 hours. This step is up to the creator.");
    assert.doesNotMatch(line, /\(the creator\)/);
    assert.ok(draft.steps.slice(2).every((s) => s.done === false && s.detail === AFTER_CREATE), "no curve, pool or reading is described for a coin that does not exist");
    const curve = checklistOf({ ticker: "T", mint: "M", status: "live", launched: true, phase: "curve", poolRegistered: false, readings: 0, burns: 0 });
    assert.match(checklistNextLine(curve), /This step is up to traders on the curve\.$/);
    for (const t of [line, checklistNextLine(curve), AFTER_CREATE]) clean(t);
  });
  test("the page: created coins first, drafts in their own section with no wind-down row, no checklist and no post", () => {
    const me = read("src/app/burnticker/me/page.tsx");
    assert.match(me, /const \{ created, drafts \} = splitMeCoins\(d\.coins\);/);
    const draftsBlock = me.slice(me.indexOf("{drafts.length > 0 &&"), me.indexOf("</section>}", me.indexOf("{drafts.length > 0 &&")));
    assert.ok(draftsBlock.length > 100);
    assert.doesNotMatch(draftsBlock, /wind-down|windDown|LaunchChecklist|todayPost|bt-chip">\{c\.state\}/);
    assert.match(me, /setCopied\(c\.mint\)/, "two coins with one ticker never both say copied");
  });
});

// ---- 3 ------------------------------------------------------------------------------------------------------------------------------
describe("3: the duplicate notice counts created coins only", () => {
  test("drafts and expired drafts never count; only drafts → nothing said", async () => {
    const w = await makeWorld();
    const rule = JSON.parse(w.bronco.rulesJson);
    const tokens = w.registry.tokens();
    assert.ok(existingCoinsFor(rule, tokens).some((h) => h.mint === w.bronco.mint));
    assert.deepEqual(existingCoinsFor(rule, tokens.map((t) => ({ ...t, status: "draft" as const }))), [], "a never-created draft is not a registered coin");
    for (const s of ["live", "paused", "retired"]) assert.equal(isCreatedStatus(s), true);
    for (const s of ["draft", "expired"]) assert.equal(isCreatedStatus(s), false);
    assert.match(read("src/app/burnticker/launch/DuplicateNotice.tsx"), /if \(!existing\.length\) return null;/);
  });
});

// ---- 4 ------------------------------------------------------------------------------------------------------------------------------
describe("4: the league buttons", () => {
  test("named by the league; the tooltip is one sentence with one period", () => {
    assert.equal(leagueButtonName("NFL", "The on-chain payout and the licensed final score confirm each other."), "NFL");
    assert.equal(leagueButtonName("XFL", null), `XFL, ${NO_SECOND_CHECK}`);
    assert.equal(leagueButtonTitle("The on-chain payout and the licensed final score confirm each other."), "The on-chain payout and the licensed final score confirm each other.");
    assert.equal(leagueButtonTitle("MLB's official feed"), "Results are checked against MLB's official feed.");
    for (const t of [leagueButtonTitle("MLB's official feed"), leagueButtonTitle("a sentence."), leagueButtonTitle(null)]) clean(t);
    assert.match(PAGE, /aria-label=\{leagueButtonName\(l\.label, l\.crossRead\)\} title=\{leagueButtonTitle\(l\.crossRead\)\}/);
    assert.doesNotMatch(PAGE, /`Checked against \$\{l\.crossRead\}\.`/);
  });
});

// ---- 5 ------------------------------------------------------------------------------------------------------------------------------
describe("5: a page from an earlier build says so", () => {
  test("the notice only when both ids are real and differ; at most one check a minute", () => {
    assert.equal(staleNotice("abc123XYZ", "abc123XYZ"), null);
    assert.equal(staleNotice("abc123XYZ", "def456UVW"), STALE_PAGE_LINE);
    assert.equal(staleNotice(null, "def456UVW"), null); assert.equal(staleNotice("development", "def456UVW"), null); assert.equal(staleNotice("abc123XYZ", { x: 1 }), null);
    assert.equal(usableBuildId("<script>"), false);
    assert.equal(mayCheck(null, 0), true); assert.equal(mayCheck(0, CHECK_EVERY_MS - 1), false); assert.equal(mayCheck(0, CHECK_EVERY_MS), true);
    assert.equal(STALE_PAGE_LINE, "This page is from an earlier version of the site. Reload to continue."); clean(STALE_PAGE_LINE);
  });
  test("the host's build id is read from <distDir>/BUILD_ID, null in development", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-build-"));
    resetBuildIdCache(); assert.equal(currentBuildId(1, {}, dir), null, "no BUILD_ID file (next dev)");
    fs.mkdirSync(path.join(dir, ".next")); fs.writeFileSync(path.join(dir, ".next", "BUILD_ID"), "Abc_123-xyz\n");
    resetBuildIdCache(); assert.equal(currentBuildId(1, {}, dir), "Abc_123-xyz");
    fs.mkdirSync(path.join(dir, ".next-staging")); fs.writeFileSync(path.join(dir, ".next-staging", "BUILD_ID"), "Other999");
    resetBuildIdCache(); assert.equal(currentBuildId(1, { NEXT_DIST_DIR: ".next-staging" }, dir), "Other999");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test("wired: the layout renders the served id, the review asks, the route answers no-store, nothing reloads by itself", () => {
    assert.match(read("src/app/burnticker/launch/layout.tsx"), /<VersionCheck served=\{currentBuildId\(\)\} \/>/);
    assert.match(PAGE, /if \(step === "review" && guide\.phase === "review"\) window\.dispatchEvent\(new Event\(VERSION_CHECK_EVENT\)\);/);
    const vc = read("src/app/burnticker/_components/VersionCheck.tsx");
    assert.match(vc, /window\.addEventListener\("focus", onFocus\)/); assert.match(vc, /mayCheck\(last\.current, now\)/);
    assert.equal((vc.match(/location\.reload\(\)/g) ?? []).length, 1, "the one reload is the button's"); assert.match(vc, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
    assert.match(read("src/app/api/burnticker/build/route.ts"), /\{ build: currentBuildId\(\) \}, \{ headers: \{ "cache-control": "no-store" \} \}/);
  });
});

// ---- 6 ------------------------------------------------------------------------------------------------------------------------------
describe("6: a wallet slower than the blockhash gets the step rebuilt and signed again", () => {
  const BHS = Array.from({ length: 6 }, () => Keypair.generate().publicKey.toBase58());
  const creatorKp = Keypair.generate(), CREATOR = creatorKp.publicKey.toBase58();
  const ix = (signer: string, data = 1) => ({ programId: "11111111111111111111111111111111", label: "test", dataBase64: Buffer.from([2, 0, 0, 0, data, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), keys: [{ pubkey: CREATOR, isSigner: true, isWritable: true }, { pubkey: signer, isSigner: signer !== CREATOR, isWritable: true }] });
  const bundle = (ticker: string): LaunchlabBundleLike => {
    const mint = Keypair.generate(), m = mint.publicKey.toBase58();
    return { mint: m, ticker, ready: true, pending: [], mintSecretKey: Buffer.from(mint.secretKey).toString("base64"), transactions: [{ label: "create", signers: ["creator", "mint"], instructions: [ix(m)] }] };
  };
  /** a clock the wallet moves forward by `walletMs[n]` on its n-th signature; isBlockhashValid answers from `valid` */
  const harness = (o: { walletMs: number[]; valid?: (bh: string) => boolean; sendErr?: (n: number) => string | null; tamper?: (tx: VersionedTransaction) => VersionedTransaction }) => {
    let clock = 1_000_000, signs = 0, fetches = 0, sends = 0;
    const sentBlockhashes: string[] = [], checked: string[] = [], notices: string[] = [];
    const d: SendDeps = {
      now: () => clock,
      latestBlockhash: async () => ({ blockhash: BHS[fetches++], lastValidBlockHeight: 100 }),
      signTransaction: async (tx) => { clock += o.walletMs[signs++] ?? 0; const t = o.tamper ? o.tamper(tx) : tx; t.sign([creatorKp]); return t; },
      lookupTable: async () => null,
      sendRaw: async (raw) => { sends++; const e = o.sendErr?.(sends); if (e) throw new Error(e); sentBlockhashes.push(VersionedTransaction.deserialize(raw).message.recentBlockhash); return "sig"; },
      confirm: async () => ({ err: null }),
      storage: memoryPlanStorage(),
      ...(o.valid ? { isBlockhashValid: async (bh: string) => { checked.push(bh); return o.valid!(bh); } } : {}),
      onNotice: (t) => notices.push(t),
    };
    return { d, get: () => ({ signs, fetches, sends, sentBlockhashes, checked, notices }) };
  };
  const planOf = (): SignPlan => {
    // the mint key travels base58 in real bundles; launchlabPlan accepts what the bundle route sends
    const b = bundle("SLOW");
    const mintKp = Keypair.fromSecretKey(Buffer.from(b.mintSecretKey!, "base64"));
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let x = BigInt("0x" + Buffer.from(mintKp.secretKey).toString("hex")), s = ""; while (x > BigInt(0)) { s = A[Number(x % BigInt(58))] + s; x /= BigInt(58); }
    return launchlabPlan([{ ...b, mintSecretKey: s }]);
  };
  test("past 45 s and expired on chain: rebuilt with a fresh blockhash, the wallet asked again with a sentence, then sent", async () => {
    const h = harness({ walletMs: [STALE_BLOCKHASH_MS + 30_000, 2_000], valid: (bh) => bh !== BHS[0] });
    const r = await signAndSendPlan(planOf(), CREATOR, h.d);
    assert.equal(r.error, null);
    const g = h.get();
    assert.deepEqual([g.signs, g.fetches, g.sends], [2, 2, 1]);
    assert.deepEqual(g.sentBlockhashes, [BHS[1]], "the fresh blockhash went out, never the expired one");
    assert.deepEqual(g.checked, [BHS[0]], "only the stale one is checked; the quick second signature is not");
    assert.deepEqual(g.notices, [resignSentence(0, 1)]); clean(resignSentence(0, 1));
  });
  test("past 45 s but still valid: sent as signed, no second prompt", async () => {
    const h = harness({ walletMs: [STALE_BLOCKHASH_MS + 1], valid: () => true });
    const r = await signAndSendPlan(planOf(), CREATOR, h.d);
    assert.equal(r.error, null); assert.deepEqual([h.get().signs, h.get().checked.length, h.get().notices.length], [1, 1, 0]);
  });
  test("a quick wallet is never checked", async () => {
    const h = harness({ walletMs: [5_000], valid: () => false });
    const r = await signAndSendPlan(planOf(), CREATOR, h.d);
    assert.equal(r.error, null); assert.deepEqual([h.get().signs, h.get().checked.length], [1, 0]);
  });
  test("still too slow after RESIGN_MAX more tries: stops before sending, with a sentence that says nothing was sent", async () => {
    const h = harness({ walletMs: Array(RESIGN_MAX + 1).fill(STALE_BLOCKHASH_MS + 60_000), valid: () => false });
    const r = await signAndSendPlan(planOf(), CREATOR, h.d);
    assert.deepEqual([r.failedAt, r.state, r.error], [0, "not-sent", resignExhaustedSentence(0, 1)]);
    assert.deepEqual([h.get().signs, h.get().sends], [RESIGN_MAX + 1, 0]);
    clean(resignExhaustedSentence(0, 1)); assert.match(resignExhaustedSentence(0, 1), /Nothing was sent\./);
  });
  test("a send refused with \"Blockhash not found\" (nothing left the node) is rebuilt and signed again too", async () => {
    const h = harness({ walletMs: [1_000, 1_000], sendErr: (n) => (n === 1 ? "failed to send transaction: Transaction simulation failed: Blockhash not found" : null) });
    const r = await signAndSendPlan(planOf(), CREATOR, h.d);
    assert.equal(r.error, null); assert.deepEqual([h.get().signs, h.get().sends], [2, 2]); assert.deepEqual(h.get().sentBlockhashes, [BHS[1]]);
  });
  test("the integrity check still runs first: a wallet that changes the transaction is refused before any blockhash check", async () => {
    let plan!: SignPlan;
    const h = harness({ walletMs: [STALE_BLOCKHASH_MS + 30_000], valid: () => false, tamper: () => buildStepTx({ ...plan.steps[0], instructions: [ix(plan.confirms[0].mint, 9)] }, CREATOR, plan.keys, BHS[0]) });
    plan = planOf();
    const r = await signAndSendPlan(plan, CREATOR, h.d);
    assert.deepEqual([r.state, h.get().sends, h.get().checked.length, h.get().signs], ["not-sent", 0, 0, 1]);
    assert.match(r.error!, /was not sent because the wallet changed the transaction's instructions or accounts/);
  });
  test("the card wires the check and the sentence", () => {
    const card = read("src/app/burnticker/launch/SignCard.tsx");
    assert.match(card, /isBlockhashValid: async \(b\) => \(await connection\.isBlockhashValid\(b, \{ commitment: "confirmed" \}\)\)\.value,/);
    assert.match(card, /onNotice: \(t\) => setNotice\(t\),/); assert.match(card, /data-resign-notice/);
    assert.match(read("src/lib/burnticker/rpcProxy.ts"), /"isBlockhashValid"/, "the browser's RPC proxy allows the call");
  });
});

// ---- 7 ------------------------------------------------------------------------------------------------------------------------------
describe("7: the hunt", () => {
  test("Your coins / the coin page: dates in Denver; a draft's readiness says it was never signed; a draft has no pool line", () => {
    assert.equal(denverDay("2026-10-14T03:30:00Z"), "Oct 13, 2026", "an evening launch in Denver is that evening's date, never UTC's next day");
    assert.equal(denverDay("nonsense"), "nonsense");
    const r = readinessOf({ launched: false } as Parameters<typeof readinessOf>[0]);
    assert.doesNotMatch(r.detail, /No coin is registered/); clean(r.detail);
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /\{s\.status !== "draft" && s\.status !== "expired" && <p className="mt-2 text-\[11px\] text-neutral-500">/);
  });
  test("the team list: \"No teams found\" only after this league's list answered; a failed read says so", () => {
    assert.match(PAGE, /teamsFor\?\.key === `\$\{leagueSeries\}\|\$\{teamsDivision\}` && <p[^>]*>\{teamsFor\.failed \? TEAMS_UNREAD_LINE : TEAMS_NONE_LINE\}/);
    for (const t of [TEAMS_NONE_LINE, TEAMS_UNREAD_LINE]) clean(t);
  });
  test("two separate coins: costs and shares are each coin's own", () => {
    assert.match(costLine("0.1138", 2), /Burns are paid from each coin's own trading fees/); assert.match(costLine("0.0569", 1), /from the coin's own/);
    const team = { schema: "burnticker.rules.v1", oracle: "catalogue", series: "espn.team:nfl-PHI-loss", market: null, filter: {}, kind: "scalar", scalar: { unit: 1, perUnit: { fractionOfPool: 0.02 }, baseline: 0, direction: "up" }, binary: null } as unknown as Parameters<typeof budgetCopy>[0];
    const line = pairBudgetLine(budgetCopy(team, 0.02, null).line);
    assert.doesNotMatch(line, /this coin/); assert.match(line, /of its own burn pool, buying and burning that coin/);
    for (const t of [costLine("0.1138", 2), line]) clean(t);
  });
  test("the end choice is headed by when it applies: \"does not win\" only where the coin can win", () => {
    assert.equal(endChoiceLabel({ winning: "If the Eagles win the championship, the rest burns this coin." }), END_CHOICE_LABEL);
    assert.equal(endChoiceLabel({ winning: null }), END_CHOICE_LABEL_ENDS); clean(END_CHOICE_LABEL_ENDS);
    assert.doesNotMatch(read("src/app/burnticker/launch/EndChoicePicker.tsx"), /END_CHOICE_LABEL\b/);
  });
  test("Coin comparison: a picked reference coin's source is whole sentences", () => {
    const tile = read("src/app/burnticker/launch/CoinVsCoinTile.tsx");
    assert.match(tile, /const first = pyth \? "Read from its Pyth feed\." : "Read from its pool, averaged over time\.";/);
    assert.match(tile, /\{refSourceLine\(value\.source === "pyth", value\.crossLine \?\? null, crossName\(value\.underlying\?\.cross\)\)\}/);
    assert.doesNotMatch(tile, /\? "Pyth feed" : "pool TWAP"/);
    for (const t of ["Read from its Pyth feed.", "Read from its pool, averaged over time."]) clean(t);
  });
  test("a Polymarket search lists the outcome it names first (\"Eagles Super Bowl\" showed 12 of 32 teams, Eagles not among them)", () => {
    const m = (team: string, i: number) => ({ conditionId: `0x${String(i).padStart(64, "0")}`, question: `Will the ${team} win the 2027 NFL championship?`, groupItemTitle: team, outcomes: ["Yes", "No"], endDate: "2027-03-31T00:00:00Z", closed: false, inactive: false, sportsMarketType: null, negRisk: true, outcomeFigures: null });
    const teams = ["Arizona Cardinals", "Atlanta Falcons", "Baltimore Ravens", "Buffalo Bills", "Carolina Panthers", "Chicago Bears", "Cincinnati Bengals", "Cleveland Browns", "Dallas Cowboys", "Denver Broncos", "Detroit Lions", "Green Bay Packers", "Houston Texans", "Philadelphia Eagles"];
    const ev = { slug: "pro-football-2027-champion", title: "Pro Football: 2027 Champion", endDate: "2027-03-31T00:00:00Z", closed: false, tags: [], markets: teams.map(m) } as unknown as Parameters<typeof searchHits>[0][number];
    const before = searchHits([ev]).events[0].markets.map((x) => x.question);
    assert.ok(!before.some((q) => /Eagles/.test(q)), "the old order (fixture check)");
    const after = searchHits([ev], { query: "Eagles Super Bowl" }).events[0].markets;
    assert.match(after[0].question, /Philadelphia Eagles/);
    assert.equal(outcomeNamer("the win")({ question: "x", groupItemTitle: "The Winners" }), false, "short words never match");
    assert.equal(outcomeNamer("")({ question: "x", groupItemTitle: "Eagles" }), false);
  });
});
