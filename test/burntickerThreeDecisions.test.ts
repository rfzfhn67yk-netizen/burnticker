// THREE DECISIONS TO A COIN (the owner, 2026-10-10: "it feels overly complicated to get a coin set up … the UI needs to be simpler, even
// if it means giving up a little bit of adjustability"). On the web, from landing on /burnticker/launch to the wallet signature, the
// creator makes at most three decisions: (a) what burns it, (b) accept or edit the suggested name + ticker, (c) Launch. Every other
// control is a preselected preset (data-optional) or gone from the UI — and still in the API (POST /api/burnticker/v1/launch/bundle).
//
// The check is on the source of the three launch files: every <button>/<input>/<select>/<textarea> says which decision it is
// (data-decision="what" | "name" | "launch"), that it is optional with a default already chosen (data-optional), or that it is
// navigation (data-nav). A failure names the element.
import { OPERATOR_SHARE_LINE, PAIR_OPERATOR_SHARE_LINE } from "@/lib/burnticker/feeShareLine";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DENVER_HIGH } from "./burntickerHelpers.ts";
import { API, CREATOR, POST_HEADERS, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { Keypair } from "@solana/web3.js";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const PAGE = "src/app/burnticker/launch/page.tsx", TILE = "src/app/burnticker/launch/CoinVsCoinTile.tsx", REVIEW = "src/app/burnticker/launch/ReviewCard.tsx";
// website-15 item 13 (owner decision 2026-10-12): the creator's optional image, description and links are their own component
const PROFILE = "src/app/burnticker/launch/ProfileFields.tsx";
const FILES = [PAGE, TILE, REVIEW, PROFILE];

/** Every interactive element: its tag text (attributes up to the closing > at brace depth 0) and its line. */
function elements(src: string): { tag: string; line: number }[] {
  const out: { tag: string; line: number }[] = [];
  for (const m of src.matchAll(/<(button|input|select|textarea)\b/g)) {
    let depth = 0, end = -1;
    for (let k = m.index!; k < Math.min(src.length, m.index! + 2000); k++) { const ch = src[k]; if (ch === "{") depth++; else if (ch === "}") depth--; else if (ch === ">" && depth === 0) { end = k; break; } }
    out.push({ tag: src.slice(m.index!, end), line: src.slice(0, m.index!).split("\n").length });
  }
  return out;
}
const decisionOf = (tag: string) => /data-decision="([a-z]+)"/.exec(tag)?.[1] ?? null;
const name = (f: string, e: { tag: string; line: number }) => `${path.basename(f)}:${e.line} ${e.tag.slice(0, 110).replace(/\s+/g, " ")}`;

describe("three decisions to a coin", () => {
  test("every interactive element on the way to the signature declares its decision, its default, or that it navigates", () => {
    const untagged = FILES.flatMap((f) => elements(read(f)).filter((e) => !/data-(decision|optional|nav)\b/.test(e.tag)).map((e) => name(f, e)));
    assert.deepEqual(untagged, [], `inputs with no declared decision:\n${untagged.join("\n")}`);
  });

  test("at most three required decisions exist anywhere in the launch UI: what, name, launch", () => {
    const kinds = new Set(FILES.flatMap((f) => elements(read(f)).map((e) => decisionOf(e.tag)).filter((x): x is string => !!x)));
    assert.ok(kinds.size <= 3, `decisions: ${[...kinds].join(", ")}`);
    for (const k of kinds) assert.ok(["what", "name", "launch"].includes(k), `an unexpected required decision "${k}"`);
    const optional = new Set(FILES.flatMap((f) => elements(read(f)).map((e) => /data-optional="([a-z]+)"/.exec(e.tag)?.[1]).filter((x): x is string => !!x)));
    assert.deepEqual([...optional].sort(), ["note", "preset", "profile"], "the only optional controls: the preset row, the note link and the creator's image, description and links (website-15 item 13)");
  });

  test("the review card's happy state shows no field: name and ticker open on 'edit', the note on 'add a note'; Launch is the last decision", () => {
    const src = read(REVIEW);
    const inputs = elements(src).filter((e) => /^<(input|textarea|select)/.test(e.tag));
    const editBlock = src.slice(src.indexOf("{mode === \"full\" && editing ? ("), src.indexOf(") : null}"));
    const noteBlock = src.slice(src.indexOf("const noteField = p.note && (noteOpen ||"), src.indexOf("add a note</button>);"));
    // website-20 (audit 6 item 12): step 4 "Name and look" is the one screen whose job is the fields
    const nameStep = src.slice(src.indexOf('if (mode === "name") return ('), src.indexOf("data-review-card data-mode={mode}"));
    for (const e of inputs) { const at = src.indexOf(e.tag); assert.ok(editBlock.includes(e.tag) || noteBlock.includes(e.tag) || nameStep.includes(e.tag), `a field visible before anything is clicked: ${name(REVIEW, e)} @${at}`); }
    assert.match(src, /useState\(false\), \[noteOpen/, "the name editor starts closed");
    const required = elements(src).filter((e) => decisionOf(e.tag)).map((e) => decisionOf(e.tag));
    assert.deepEqual([...new Set(required)], ["name", "launch"], "the review card asks only for the name (optional edit) and Launch");
    // website-15 item 12: the reading matter is collapsed below the button, but no dial or field hides in a disclosure
    // website-20 (the owner's mobile rule: everything else behind a tap): the raise, already chosen, is the one preset row in a disclosure
    for (const d of src.match(/<details[\s\S]*?<\/details>/g) ?? []) if (!/data-raise>/.test(d)) assert.doesNotMatch(d, /role="radio"|<input|<textarea|data-decision|data-optional/, "no disclosure of dials on the review card");
    assert.ok(src.indexOf("data-review-more") > src.indexOf('data-decision="launch"'), "the collapsed blocks sit below the launch button");
  });

  test("every path is pick → review → launch: the sentence, Team coin, Matchup, Any result, Elections, Any market and Coin vs Coin", () => {
    const src = read(PAGE);
    const order = /const ORDER: Record<Flow, Step\[\]> = (\{[^\n]+\});/.exec(src)![1];
    for (const f of ["team", "pair", "single", "feed", "browse"]) assert.match(order, new RegExp(`${f}: \\["[a-z]+", "review", "launch"\\]`), `${f} has one pick step, then the review card`);
    assert.match(src, /applyRule = [\s\S]*?setStep\("review"\)/, "a search card, an election candidate and an outcome land on the review card");
    assert.match(src, /chooseGame = [\s\S]*?setStep\("review"\)/, "a game lands on the review card");
    // website-20: the guided path's step 4 renders the same card in its "name" mode; the review itself is still one card
    assert.equal((src.match(/<ReviewCard\b/g) ?? []).length, 2, "one review card for every page path, plus its name step");
    assert.equal((src.match(/<ReviewCard mode="name"/g) ?? []).length, 1);
    // website-22 (QA 9 item 38): Coin vs Coin and the record close each walk the name step and the review (two cards each, one in "name" mode)
    assert.equal((read(TILE).match(/<ReviewCard\b/g) ?? []).length, 4, "Coin vs Coin: two coins → the same review card; website-21: a coin's record close → its own one-coin card");
    assert.equal((read(TILE).match(/<ReviewCard mode="name"/g) ?? []).length, 2);
  });

  test("the controls the owner cut are gone from the web UI (each is API-only; ui-conventions.md lists the endpoint)", () => {
    const all = FILES.map(read).join("\n");
    const rendered = all.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");   // comments out: only what renders
    const cut = ["side", "yesno", "share-recurring", "share-oneshot", "share-binary", "window", "card-window", "next-games", "league-mode", "league-forward", "derby-window", "derby-season", "derby-share", "derby-measure", "poly-filter", "kalshi-filter", "wallet-paste", "ack-locked", "ack-no-returns", "first-buy", "socials", "image", "own-image-toggle", "own-image-link", "pair-window", "pair-name", "pair-ticker", "pair-image", "also-burn-other", "read-as", "burn-from", "vault-share", "unit-size", "baseline", "direction", "per-unit", "race-outcome", "kalshi-series-search", "kalshi-market-paste"];
    for (const id of cut) assert.ok(!all.includes(`data-help="${id}"`) && !all.includes(`id="${id}"`), `${id} is still rendered`);
    for (const phrase of ["Season (days)", "one-shot flippening", "League mode", "Adjust", "launch venue", "graduate", "dialPanel", "Optional first buy", "Add social links"]) assert.ok(!rendered.includes(phrase), `"${phrase}" is still on the launch UI`);
  });

  test("the review card's own sentences pass the copy lint (the acknowledgement line, the receipts line, the LP line)", () => {
    const src = read(REVIEW), cfg = loadCopyLintConfig();
    for (const k of ["ACK_LINE", "ACK_LINE_PAIR", "RECEIPTS_LINE"]) { const t = new RegExp(`export const ${k} = "([^"]+)"`).exec(src)![1]; const r = lintCopy(t, cfg); assert.ok(r.ok, `${k}: ${r.hits.map((h) => h.phrase).join(", ")}`); }
    // the LP lines are built from the fee constants (feeShareLine.ts): lint them as rendered
    for (const t of [`The pool's liquidity is locked forever. ${OPERATOR_SHARE_LINE} The operator's part of the liquidity fees is fixed in code.`, `The pool's liquidity is locked forever. ${PAIR_OPERATOR_SHARE_LINE} The operator's part of the liquidity fees is fixed in code.`]) { const r = lintCopy(t, cfg); assert.ok(r.ok, `LP line: ${r.hits.map((h) => h.phrase).join(", ")}`); }
  });

  test("Coin vs Coin: 'Runs for' days, never 'season'; the preview is the generated art without live rows", () => {
    const tile = read(TILE), card = read("src/app/burnticker/_components/CoinCard.tsx");
    assert.ok(!/Season \(days\)/.test(tile)); assert.match(tile, /\[seasonDays, setSeasonDays\] = useState<number>\(30\)/, "website-26: 7, 14 or 30 days, 30 by default");
    assert.match(tile, /preview\.svg\?r=/, "the generated receipt art, never NO IMAGE");
    // since 2026-10-12 the prelaunch card returns early with only the art, name, $TICKER, badge and rule row: no curve, burns or receipt rows
    assert.match(card, /if \(prelaunch\) \{\s*return \(/);
    const pre = card.slice(card.indexOf("if (prelaunch) {"), card.indexOf("return <ViewCard"));
    assert.doesNotMatch(pre, /CurveBar|data-row="burned"|data-row="curve"|Check receipt/);
    assert.ok(!/>\?<\/button>/.test(read("src/app/burnticker/_components/FieldHelp.tsx")), "the help glyph is CSS, so a copied label never ends in '?'");
  });
});

describe("the API keeps every dial the web UI dropped", () => {
  test("a share that is not a preset, socials and a creator's note are still accepted by POST /v1/launch/bundle; a first buy is not (launch-10)", async () => {
    await makeWorld();
    const rule = { ...DENVER_HIGH, scalar: { ...DENVER_HIGH.scalar, perUnit: { fractionOfPool: 0.07 } } };
    const req = (firstBuySol: string, ticker: string) => callRoute(`${API}/launch/bundle`, { method: "POST", headers: POST_HEADERS, body: JSON.stringify({ creator: CREATOR, mint: Keypair.generate().publicKey.toBase58(), ticker, name: "Heat Seven", rule, note: "made for the Denver summer", links: [{ label: "website", url: "https://example.com" }], firstBuySol, acknowledgements: { ruleLocked: true, noReturns: true } }) });
    // launch-10 (2026-10-12): a create with an opening purchase does not fit one transaction, so hosted bundles carry none (hostedLaunch.ts)
    const buy = await req("0.5", "HEAT8");
    assert.equal(buy.status, 400); assert.equal((await buy.json() as { code: string }).code, "opening-purchase-off");
    const r = await req("0", "HEAT7");
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json() as { ok: boolean };
    assert.equal(j.ok, true);
    assert.match(JSON.stringify(j), /fractionOfPool\\?"?:\s*0\.07/, "the 7 % share is locked into the rule");
  });
});
