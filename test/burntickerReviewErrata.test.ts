// The ChatGPT/Codex adversarial review (docs/burnticker/reviews/2026-10-10-chatgpt-pr-review.md) found four places where published
// copy did not match the source: the LP floor (checklist item 8: the general register_pool floor is 50 %, the fallback pool's 90 %),
// the burn_receipts entrypoint count (item 1: 24, not 23), the "no market cap anywhere" UI rule (Burn Derby compares OTHER coins'
// market caps as a rule input), and the devnet evidence's 2026-10-08 row (item 16: planned, not executed). These tests pin the copy to
// the source so the numbers cannot drift again, and keep the pre-registered checklist immutable (corrections go in its erratum).
// A second dated erratum (2026-10-10, owner decision) records that graduation LP is now LOCKED forever, not burned: its fees fund the
// burn (80 % burn pool, 20 % operator, compiled) — the copy sentence moved from "burns 100 %" to "locks 100 %".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BURN_RECEIPTS_IDL } from "@/lib/burnReceipts/idl";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { derbyAdmission } from "@/lib/burnticker/derby/admission";
import { openRegistry } from "@/lib/burnticker/registry";
import { FakeBurnProgram } from "@/lib/burnticker/program";
import type { CoinVsSpec } from "@/lib/burnticker/derby/spec";
import { BONK, SHIB, WIF, coinvsRule, fixtureFetch, launchSingle } from "./burntickerDerbyHelpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const BR = "programs/burn-receipts/programs/burn_receipts/src";
const CHECKLIST = "docs/burnticker/reviews/checklist.md";
const ERRATUM = "## Erratum 2026-10-10 (after the ChatGPT/Codex review)";
/** Every dated erratum, in the order they were appended (each one after the last; the pre-registered text before the first never changes). */
const ERRATA = [ERRATUM, "## Erratum 2026-10-10 (LP locked forever, owner decision)", "## Erratum 2026-10-11 (LP lock round 2, after the LP-lock blind review)", "## Erratum 2026-10-11 (winner takes the burn, LAUNCHPAD-PATH §40)", "## Erratum 2026-10-11 (winner takes the burn round 2, after the pair-forward blind review)", "## Erratum 2026-10-11 (pair-forward round-2 re-check, RI-2 wording)", "## Erratum 2026-10-11 (pair-forward round 3, after the re-check)", "## Erratum 2026-10-12 (market cap on coin cards, owner decision)", "## Erratum 2026-10-12 (end sinks, LAUNCHPAD-PATH §45, program round 4)", "## Erratum 2026-10-13 (external burn targets, program round 5)", "## Erratum 2026-10-13 (end-sink options, program round 5)", "## Erratum 2026-10-13 (burn dispersal, program round 5)", "## Erratum 2026-10-14 (round-5 blind review fixes)", "## Erratum 2026-10-15 (round-5 R5-8 and R5-9, owner decision)", "## Erratum 2026-10-15 (R5-8 / R5-9 after their blind review)"];
/** sha256 of the pre-registered checklist exactly as reviewed (everything before the erratum). It must never change. */
const CHECKLIST_PREREGISTERED_SHA256 = "7af9866eb64157d77205e63b34e4695aa9d1ecac6b12c4cbff58c5a068ff5f3b";
const LP_SENTENCE = "≥ 50 % at registration (≥ 90 % for the fallback pool); our platform locks 100 % at graduation";
const UI_RULE = "no price or odds for any Burnticker coin and no commentary on any number; a coin's card and page may show its market cap as a bare number read from its curve or pool (owner decision 2026-10-12); another coin's market cap may be a rule input, shown only as the rule sentence";

function walk(dir: string, exts: RegExp, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc); else if (exts.test(e.name)) acc.push(p);
  }
  return acc;
}

function erratumSection(heading = ERRATUM): string {
  const text = read(CHECKLIST);
  const i = text.indexOf(heading);
  assert.ok(i >= 0, `${CHECKLIST} must carry "${heading}"`);
  const next = ERRATA.map((h) => text.indexOf(h)).filter((j) => j > i).sort((a, b) => a - b)[0];
  return text.slice(i, next ?? text.length);
}

describe("checklist: pre-registered text is immutable, corrections go in the erratum", () => {
  test("everything before the erratum is byte-identical to the pre-registered checklist", () => {
    const text = read(CHECKLIST);
    const i = text.indexOf(ERRATUM);
    assert.ok(i > 0, "erratum present");
    const before = text.slice(0, i).replace(/\n+$/, "\n");
    assert.equal(crypto.createHash("sha256").update(before).digest("hex"), CHECKLIST_PREREGISTERED_SHA256, "the pre-registered checklist text was edited — append to the erratum instead");
  });
  test("every dated erratum is present, once, in the order appended", () => {
    const text = read(CHECKLIST);
    const at = ERRATA.map((h) => text.indexOf(h));
    assert.ok(at.every((i) => i > 0), JSON.stringify(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    for (const h of ERRATA) assert.equal(text.split(h).length, 2, `${h} appears once`);
  });
  test("the round-2 erratum states both programs' entrypoint counts from lib.rs, the registration order, the platform pin and burn_lp", () => {
    const e = erratumSection(ERRATA[2]);
    const count = (lib: string) => { const src = read(lib); const start = src.indexOf("#[program]"); const open = src.indexOf("{", start); let depth = 0, end = open; for (let i = open; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) { end = i; break; } } return [...src.slice(open, end).matchAll(/\bpub fn ([a-z_0-9]+)\s*[<(]/g)].length; };
    const pc = count("programs/burn-receipts/programs/pair_curve/src/lib.rs");
    assert.equal(pc, 9);
    assert.match(e, new RegExp(`pair_curve has \\*\\*${pc} entrypoints\\*\\*`));
    // As written on 2026-10-11 (26 then); the pair entrypoints came after — the winner-takes-the-burn erratum states 29.
    assert.match(e, /burn_receipts still has \*\*26 entrypoints\*\*/);
    for (const re of [/register_fee_key` runs BEFORE `register_pool`/, /BURNTICKER_PLATFORM/, /PlatformNotPinned/, /burn_lp/, /memo v2/]) assert.match(e, re);
  });
  test("the winner-takes-the-burn erratum states the pair entrypoints, the result message, the forward and the crank gate", () => {
    const e = erratumSection(ERRATA[3]);
    for (const re of [/\*\*29 entrypoints\*\*/, /link_pair/, /submit_pair_result/, /forward_to_winner/, /BURNRECEIPTS-PAIR-v1/, /ForwardRequired/, /PairResultPending/, /72 h/, /draw/, /emit!/, /lookup table/]) assert.match(e, re);
  });
  test("the round-2 pair erratum states 30 entrypoints, the no-wedge rules, the loser's consent, unlink and the ordering fixes", () => {
    const e = erratumSection(ERRATA[4]);
    for (const re of [/\*\*30 entrypoints\*\*/, /unlink_pair/, /PairResultNotServable/, /0 lamports/, /PairForwardMissing/, /loser's attester quorum/, /PairStillLive/, /PairHasReadings/, /PairDateBeforePairing/]) assert.match(e, re);
  });
  test("the re-check erratum corrects the 'never burns the losing coin' sentence (RI-2) and the whitepaper says the same", () => {
    const e = erratumSection(ERRATA[5]);
    assert.match(e, /unless no forward lands within 72 hours, in which case it burns as a plain period and a `PairForwardMissing` event is published/);
    assert.ok(read("docs/burnticker/WHITEPAPER.md").includes("a lost period never burns the losing coin unless no forward lands within 72 hours, in which case it burns as a plain period and a PairForwardMissing event is published"));
    assert.ok(!/a lost period never burns the losing coin[;.]/.test(read("docs/burnticker/WHITEPAPER.md")));
  });
  test("the round-3 erratum states 31 entrypoints, 100 errors, terminal-only unlink, one attester set, voidBy, pair_after_date and the forward window", () => {
    const e = erratumSection(ERRATA[6]);
    for (const re of [/\*\*31 entrypoints\*\*/, /100 error codes/, /apply_paired_attester_change/, /UNLINK_VOID_BY_PASSED/, /PairAttestersDiffer/, /pair_void_by/, /pair_after_date/, /PairTerminal/, /ForwardWindowClosed/]) assert.match(e, re);
  });
  test("the round-4 erratum states 33 entrypoints, 110 errors, the EndSink, the RuleEnd, forward_on_end and its program-chosen destination", () => {
    const e = erratumSection(ERRATA[8]);
    for (const re of [/\*\*33 entrypoints\*\*/, /110 error codes/, /37 event types/, /submit_rule_end/, /forward_on_end/, /BURNTICKER_FLAGSHIP/, /BURNRECEIPTS-END-v1/, /RuleEnded/, /ForwardOnEndRequired/, /never as a refund or a payout/]) assert.match(e, re);
  });
  test("the round-5 erratum states 39 entrypoints, 129 errors, 42 events, the burn target, its admission, the Pyth guard and the four places SOL leaves a fee PDA", () => {
    const e = erratumSection(ERRATA[9]);
    for (const re of [/\*\*39 entrypoints\*\*/, /129 error codes/, /AMM v4/, /Pyth/, /TargetPythInvalid/, /42 event types/, /pin_burn_target/, /crank_target_burn/, /burn_target_kind/, /BurnTargetSet/, /Token-2022 refused/, /2 % of that pool's SOL reserve/, /TargetPoolUnhealthy/, /four places/]) assert.match(e, re);
  });
  test("the end-sink options erratum states 41 entrypoints, 131 errors, 43 events, the incinerator sink and the r5 create's restriction", () => {
    const e = erratumSection(ERRATA[10]);
    for (const re of [/\*\*41 entrypoints\*\*/, /131 error codes/, /43 event types/, /burn_sol_on_end/, /initialize_token_r5/, /LostPathBurnsSelf/, /1nc1nerator11111111111111111111111111111111/, /SolBurnedOnEnd/, /deliberate restriction/, /five places/]) assert.match(e, re);
  });
  test("the burn-dispersal erratum states 42 entrypoints, 136 errors, 44 events, crank_carried, the queue rule and the six places", () => {
    const e = erratumSection(ERRATA[11]);
    for (const re of [/\*\*42 entrypoints\*\*/, /136 error codes/, /44 event types/, /crank_carried/, /ReadingPending/, /SpendAboveCap/, /NothingCarried/, /BelowFloor/, /RuleNotLive/, /CarriedSpent/, /six places/, /never moves the cursor/]) assert.match(e, re);
  });
  test("the round-5 review erratum states 43 entrypoints, 141 errors, 45 events, the retired create, release_target, the Pyth rules and the fence", () => {
    const e = erratumSection(ERRATA[12]);
    for (const re of [/\*\*43 entrypoints\*\*/, /141 error codes/, /45 event types/, /InitializeTokenRetired/, /TargetDecimalsTooLarge/, /sponsored/, /release_target/, /TargetNotStalled/, /TargetReleased/, /PythWentBackwards/, /PythFeedSkew/, /burn_target_kind/, /seven places/]) assert.match(e, re);
  });
  test("the R5-8 / R5-9 erratum states 43 entrypoints, 144 errors, 45 events, the carried pace and the target-coin liveness", () => {
    const e = erratumSection(ERRATA[13]);
    for (const re of [/\*\*43 entrypoints\*\*/, /\*\*144 error codes\*\*/, /45 event types/, /CarriedTooSoon/, /InvalidCarriedPace/, /BurnTargetAccountMissing/, /MIN_CARRIED_INTERVAL_SECS/, /CarriedPace/, /piece=<n>/, /TokenConfig's size\s+and layout do not change/, /BurnTarget` is pinned/, /stays dead/, /seven places/]) assert.match(e, re);
    assert.equal(BURN_RECEIPTS_IDL.instructions.length, 43);
    assert.equal(BURN_RECEIPTS_IDL.errors.length, 144);
    assert.equal(BURN_RECEIPTS_IDL.events.length, 45);
    for (const n of ["CarriedTooSoon", "InvalidCarriedPace", "BurnTargetAccountMissing"]) assert.ok(BURN_RECEIPTS_IDL.errors.some((x) => x.name === n), n);
    assert.match(read("docs/burnticker/WHITEPAPER.md"), /Error codes: 144\./);
    assert.match(read("docs/burnticker/WHITEPAPER.md"), /The program has 45 event types:/);
  });
  test("the R5-8 / R5-9 blind-review erratum states the budget, the version check and the stalled target", () => {
    const e = erratumSection(ERRATA[14]);
    for (const re of [/43 entrypoints, 45 event types, 144 error codes/, /CARRIED_BUDGET_WINDOW_SECS/, /dust budget/, /budget_lamports/, /CarriedTooSoon/, /InvalidCarriedPace/, /budget_left_lamports/, /last_unblocked_at >\s+last_burn_at/, /release_target/, /seven places/]) assert.match(e, re);
    assert.ok(BURN_RECEIPTS_IDL.constants?.some((c) => c.name === "CARRIED_BUDGET_WINDOW_SECS" && c.value === "600"));
    assert.ok(!BURN_RECEIPTS_IDL.constants?.some((c) => c.name === "MIN_CARRIED_INTERVAL_SECS"));
    const ev = BURN_RECEIPTS_IDL.types?.find((t) => t.name === "CarriedSpent") as { type: { fields: { name: string }[] } } | undefined;
    assert.ok(ev?.type.fields.some((f) => f.name === "budget_left_lamports") && !ev.type.fields.some((f) => f.name === "next_piece_at"));
  });
  test("the LP-lock erratum states the policy, the compiled split and the unchanged item-8 floor", () => {
    const e = erratumSection(ERRATA[1]);
    for (const re of [/100 % of the graduation LP is \*\*locked\*\*/, /\["fee_keys"\]/, /LOCK_FEE_BURN_BPS = 8000/, /LOCK_FEE_OPERATOR_BPS = 2000/, /TreasuryNotPinned/, /claim_lock_fees/, /our platform locks 100 % at graduation/, /16\.8 bps burn pool \+ 4\.2 bps/]) assert.match(e, re);
  });
});

describe("LP floor copy matches the program constants (review item 8)", () => {
  const constants = read(`${BR}/constants.rs`);
  const bps = (name: string) => Number(new RegExp(`pub const ${name}: u128 = ([0-9_]+);`).exec(constants)?.[1].replace(/_/g, ""));
  test("the program: register_pool floor 50 %, fallback pool 90 %", () => {
    assert.equal(bps("MIN_LOCKED_LP_BPS"), 5_000);
    assert.equal(bps("FALLBACK_MIN_LOCKED_LP_BPS"), 9_000);
  });
  test("the checklist erratum states 50 % / 90 %", () => {
    const e = erratumSection();
    assert.match(e, /50 %/);
    assert.match(e, /90 %/);
    assert.match(e, /MIN_LOCKED_LP_BPS/);
  });
  test("the trust page states the floor in the owner's words", () => {
    assert.ok(read("src/lib/burnticker/trust.ts").includes(LP_SENTENCE), "trust.ts statements carry the LP sentence");
  });
  test("no public copy claims a generic ≥ 90 % LP floor (90 % appears only for the fallback pool or a pair pool's creation LP)", () => {
    const files = [
      "docs/burnticker/WHITEPAPER.md", "docs/burnticker/README.md", "docs/burnticker/CHECK-THIS-YOURSELF.md", "docs/burnticker/PAIR-CURVE.md",
      "docs/burnticker/transparency.md", "docs/burn-receipts/README.md", "config/burnticker/transparency.json", "config/public-repo/overlay/README.md",
      "src/lib/burnticker/trust.ts", "src/lib/burnticker/tokenPage.ts",
      ...walk("site/burnticker", /\.html$/), ...walk("src/app/burnticker", /\.tsx?$/),
    ].filter((f) => fs.existsSync(path.join(ROOT, f)));
    const bad: string[] = [];
    for (const f of files) read(f).split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/(≥|>=|at least|either)\s*90\s*%/g)) {
        const near = line.slice(Math.max(0, m.index! - 200), m.index! + 200);
        if (!/LP|liquidity/i.test(near)) continue;
        if (/fallback|set_registration_policy|stranding|R3-2|pair|creation/i.test(near)) continue;
        bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
    assert.deepEqual(bad, [], `generic ≥ 90 % LP claims (the general floor is 50 %): use "${LP_SENTENCE}"`);
  });
});

describe("burn_receipts entrypoint count matches the copy (review item 1)", () => {
  function programEntrypoints(): string[] {
    const src = read(`${BR}/lib.rs`);
    const start = src.indexOf("#[program]");
    assert.ok(start >= 0, "lib.rs has a #[program] module");
    const open = src.indexOf("{", start);
    let depth = 0, end = open;
    for (let i = open; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) { end = i; break; } }
    return [...src.slice(open, end).matchAll(/\bpub fn ([a-z_0-9]+)\s*[<(]/g)].map((m) => m[1]);
  }
  const n = programEntrypoints().length;
  test("lib.rs, the IDL and the Powers Register agree", () => {
    assert.equal(n, 43, "43 entrypoints in the #[program] module today (24 + register_fee_key + claim_lock_fees + link_pair + submit_pair_result + forward_to_winner + unlink_pair + apply_paired_attester_change + submit_rule_end + forward_on_end + round 5's pin_burn_target, crank_target_burn, propose / cancel / veto / apply_target_pool, initialize_token_r5, burn_sol_on_end, crank_carried, release_target) — update the copy below if this changes");
    assert.equal(BURN_RECEIPTS_IDL.instructions.length, n);
    assert.deepEqual([...BURN_RECEIPTS_IDL.instructions.map((x) => x.name)].sort(), [...programEntrypoints()].sort());
    assert.equal((JSON.parse(read("docs/burn-receipts/powers-register.json")) as { instructions: unknown[] }).instructions.length, n);
  });
  test("the whitepaper's instruction table states and lists the same number", () => {
    const wp = read("docs/burnticker/WHITEPAPER.md");
    const m = /^### 13\.3 Instructions \((\d+),/m.exec(wp);
    assert.ok(m, "whitepaper §13.3 header");
    assert.equal(Number(m[1]), n);
    const section = wp.slice(m.index).split(/\n(?=#{2,3} )/)[0];
    const rows = section.split("\n").filter((l) => /^\| `[a-z_0-9]+` \|/.test(l));
    assert.equal(rows.length, n);
  });
  test("the latest checklist erratum states the real count", () => {
    assert.match(erratumSection(ERRATA[ERRATA.length - 1]), new RegExp(`\\b${n} entrypoints\\b`));
  });
});

describe("no market cap / price for any Burnticker coin (Claims and UI trust boundaries)", () => {
  // The UI and page sources a creator or buyer reads.
  const UI = [...walk("src/app/burnticker", /\.tsx?$/), "src/lib/burnticker/coinCard.ts", "src/lib/burnticker/tokenPage.ts", "src/lib/burnticker/fieldHelp.ts", "src/lib/burnticker/describe.ts"];
  /** Code without comments (a block comment, or // after whitespace — a URL's "://" survives). */
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}])\/\/.*$/gm, "$1");
  // The only places "market cap" may be rendered: Burn Derby's flippening, where it names OTHER coins' caps as the rule's input.
  const RULE_INPUT_SITES = new Set(["src/app/burnticker/launch/CoinVsCoinTile.tsx", "src/lib/burnticker/coinCard.ts"]);

  // Erratum 2026-10-12 (owner decision): a coin card's market cap, a bare number read from the coin's own curve. The index card carries the
  // field (declared once, read once from the curve), the card prints it in its row; nothing else reads a market-data field.
  // third audit 2026-10-19 B-6: the index card's holders are the wallets (program accounts left out, cardView.ts walletHolders)
  const CARD_MCAP = /^marketCap(\?: string \| null;|: c\?\.marketCap \?\? s\.market\?\.pool\?\.marketCap \?\? null, holders: walletHolders\(s\.market\?\.holders\),)$/;
  // the coin page's market facts read the same curve field (coinPage.ts marketFacts); its one mention is the status type's curve shape
  const PAGE_MCAP = (f: string, l: string) => f === "src/app/burnticker/t/[ticker]/page.tsx" && /^interface Market \{.*progressPct: number; poolId: string; marketCap\?: string \| null \} \| null;/.test(l.trim());
  test("no UI source reads a market-data field (cap, fdv, price, bid/ask, outcome prices) except the card's own curve read", () => {
    const FIELD = /\b(marketCap|market_cap|marketcap|mcapUsd|fdv|priceUsd|usdPrice|priceNative|lastTradePrice|outcomePrices|bestBid|bestAsk)\b/;
    const hits = UI.flatMap((f) => code(f).split("\n").map((l, i) => (FIELD.test(l) && !(f.endsWith("tokenPage.ts") && CARD_MCAP.test(l.trim())) && !PAGE_MCAP(f, l) ? `${f}:${i + 1}: ${l.trim().slice(0, 140)}` : null)).filter((x): x is string => !!x));
    assert.deepEqual(hits, []);
    assert.equal(code("src/lib/burnticker/tokenPage.ts").split("\n").filter((l) => /\bmarketCap\b/.test(l)).length, 2, "the index card's field: declared once, read once");
    const view = read("src/lib/burnticker/cardView.ts"), card = read("src/app/burnticker/_components/CoinCard.tsx");
    // site polish (audit 6 item 23): a number and its unit; before graduation its basis in words ("from the curve", coin card status
    // 2026-10-18), nothing else; an untraded curve has no figure at all ("No trades yet")
    assert.match(view, /const mcap: CardCell = mcapCell\(\{ cap: t\.marketCap, quote: t\.quote, phase: t\.phase, raised: t\.raised \}, NOT_READ\.mcapNotRead, t\.poolNote \?\? null\);/, "a number and its unit, no commentary");
    assert.match(view, /return `\$\{groupDigits\(value\)\} \$\{quote \?\? "SOL"\}\$\{phase === "graduated" \? "" : ` \$\{CURVE_BASIS\}`\}`;/);
    assert.match(card, /<div data-row="mcap"><dt title=\{CARD_MEANINGS\.mcap\}>\{CARD_LABELS\.mcap\}<\/dt><dd><Cell v=\{v\} c=\{v\.mcap\} \/><\/dd><\/div>/);
    assert.doesNotMatch(code("src/lib/burnticker/market.ts"), /price/i, "the curve read computes a number, it names no price");
    assert.match(read("src/lib/burnticker/coinPage.ts"), /value: `\$\{dec2\(i\.curve\.marketCap\)\} \$\{quote\}`/, "the coin page's row: a bare number and its unit");
  });

  test("\"market cap\" is rendered only at the documented rule-input sites, and only as another coin's rule input", () => {
    const outside: string[] = [];
    for (const f of UI) code(f).split("\n").forEach((l, i) => {
      if (!/market ?cap/i.test(l)) return;
      if ((f.endsWith("tokenPage.ts") && CARD_MCAP.test(l.trim())) || PAGE_MCAP(f, l)) return; // the card's own field (Erratum 2026-10-12)
      if (!RULE_INPUT_SITES.has(f)) { outside.push(`${f}:${i + 1}: ${l.trim().slice(0, 140)}`); return; }
      // coinCard: the derby flippening one-liner names the two UNDERLYINGS (d.a / d.b), never the coin's own ticker
      if (f.endsWith("coinCard.ts")) assert.ok(/d\.a\.symbol/.test(l) && /d\.b\.symbol/.test(l) && !/ticker/i.test(l), `${f}:${i + 1}: a market-cap line must name the derby underlyings only`);
      // CoinVsCoinTile: the flippening toggle's label (the measure of the two input coins)
      if (f.endsWith("CoinVsCoinTile.tsx")) assert.match(l, /flippening/, `${f}:${i + 1}: only the flippening toggle may say market cap`);
    });
    assert.deepEqual(outside, [], "market cap rendered outside the Burn Derby rule-input sites");
  });

  test("the copy lint admits another coin's market cap as a rule input but never a $TICKER's", () => {
    const cfg = loadCopyLintConfig();
    assert.equal(lintCopy("burns once if WIF's market cap passes SHIB's", cfg).ok, true);
    assert.equal(lintCopy("burns once if $WIF's market cap passes SHIB's", cfg).ok, false);
    assert.equal(lintCopy("$DEFICIT market cap", cfg).ok, false);
    assert.equal(lintCopy("the price of $DEFICIT", cfg).ok, false);
  });

  test("a Burnticker platform coin is refused as a flippening input (derby/admission.ts underlyingRefusals)", async () => {
    const NOW = Date.UTC(2026, 9, 10, 12);
    const flip: CoinVsSpec = { selector: "coinvs", a: WIF, b: BONK, window: "daily", measure: "mcap", season: { start: "2026-10-11", days: 30 }, flip: true };
    const d = { registry: openRegistry(":memory:"), fetchImpl: fixtureFetch(), now: NOW };
    assert.deepEqual(await derbyAdmission(coinvsRule(flip), d), [], "two outside coins are admitted");
    await launchSingle(d.registry, new FakeBurnProgram("devnet"), coinvsRule({ ...flip, a: BONK, b: SHIB, measure: "pct", flip: false }), "WIF");
    const refusals = await derbyAdmission(coinvsRule(flip), d);
    assert.ok(refusals.some((r) => r.kind === "platform-coin" && /WIF is a Burnticker platform coin/.test(r.reason)), JSON.stringify(refusals));
  });

  test("the UI rule is worded the same in ui-conventions.md and on the trust page", () => {
    assert.ok(read("docs/burnticker/ui-conventions.md").includes(UI_RULE), "ui-conventions.md");
    const policies = (JSON.parse(read("config/burnticker/transparency.json")) as { policies: { id: string; text: string }[] }).policies;
    assert.ok(policies.some((p) => p.text.includes(UI_RULE)), "a transparency.json policy (shown on the trust page)");
    assert.ok(read("src/lib/burnticker/trust.ts").includes(UI_RULE), "trust.ts statements");
  });
});

describe("devnet evidence: the 2026-10-08 row is planned, not executed (review item 16)", () => {
  type Row = { recordDate: string; status: string; signature: string | null; burned: string | null };
  const rows = JSON.parse(read("docs/burnkeeper/evidence/devnet-2026-10-10/burns.json")) as Row[];
  test("burns.json: two confirmed burns with signatures; 2026-10-08 planned with no burn and no signature", () => {
    const confirmed = rows.filter((r) => r.status === "confirmed");
    assert.deepEqual(confirmed.map((r) => r.recordDate), ["2026-10-06", "2026-10-07"]);
    assert.ok(confirmed.every((r) => r.signature && r.burned));
    const oct8 = rows.find((r) => r.recordDate === "2026-10-08")!;
    assert.deepEqual([oct8.status, oct8.signature, oct8.burned], ["planned", null, null]);
  });
  test("the transparency limitation counts two burns and says 2026-10-08 is planned", () => {
    const lim = (JSON.parse(read("config/burnticker/transparency.json")) as { limitations: { id: string; text: string }[] }).limitations.find((l) => l.id === "devnet-rehearsal")!;
    assert.match(lim.text, /two buy-back burns/);
    assert.match(lim.text, /2026-10-08 row[\s\S]{0,120}planned, not executed/);
  });
  test("no summary of the devnet run claims three burns", () => {
    const files = ["docs/burnkeeper/devnet-run.md", "docs/burnkeeper/devnet-run-log-2026-10-10.md", "docs/burnticker/README.md", "docs/burnticker/CHECK-THIS-YOURSELF.md", "docs/burnticker/WHITEPAPER.md", "config/burnticker/transparency.json", "src/lib/burnticker/trust.ts", "site/burnticker/index.html"];
    const bad = files.flatMap((f) => read(f).split("\n").map((l, i) => (/\b(three|3) (program |buy-?back )?burns\b/i.test(l) ? `${f}:${i + 1}` : null)).filter(Boolean));
    assert.deepEqual(bad, []);
  });
});
