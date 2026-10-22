// EIGHTH PRE-LAUNCH AUDIT B-24 / HB-186 / HS-72 (owner decision 2026-10-21): the operator's own wallet, which created seven
// soft-launch coins, is listed in transparency.json and named on each of its coin pages (from data, so a later coin by it gets the line
// too); the trading-bot entry says the other bot wallets are not listed.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, loadCopyLintConfig, formatHits } from "@/lib/launch/copyLint";
import { loadTransparency, transparencyProblems, buildTransparency } from "@/lib/burnticker/trust";
import { OPERATOR_CREATOR_WALLETS, operatorCreatorLine } from "@/lib/burnticker/operatorCreators";
import { buildReceiptsJson, buildTokenStatus, renderTokenHtml } from "@/lib/burnticker/tokenPage";
import { tokenPageInput } from "@/lib/burnticker/server";
import { makeWorld } from "./burntickerApiHelpers.ts";

const cfg = loadCopyLintConfig();
const clean = (s: string) => { const r = lintCopy(s, cfg); assert.ok(r.ok, `${s}\n${formatHits(r)}`); };
const read = (p: string) => fs.readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-21T12:00:00Z");
// the address the owner confirmed on 2026-10-21 (the Solana trading bot's default owner, in the operator's private trading code)
const OPERATOR = "8sJfoY6Xx6o2zZqmX2Vt6NRwzNPr14Ef6qqRd5YLvGbs";
const SEVEN = ["PHINFLWIN", "CLARITY", "PITWIN", "BALWIN", "SEAWIN", "DENWIN", "TWOCUTS", "COLNHLWIN"]; // eight since $COLNHLWIN (2026-10-21 18:19 Denver), HB-225
const LINE = "Created by the operator's own wallet 8sJf…LvGbs during the soft launch. The operator holds none of it and has not traded it.";

describe("B-24 / HS-72: the operator's own wallet in transparency.json", () => {
  const t = loadTransparency();
  test("listed with its address, its role and the eight coins it created; it is the one operator creator wallet", () => {
    const w = t.wallets.find((x) => x.role === "operator-own")!;
    assert.equal(w.pubkey, OPERATOR);
    assert.match(w.description, /^The operator's own wallet \(also the default owner of its Solana trading bot\); it created eight soft-launch coins: /);
    for (const tk of SEVEN) assert.ok(w.description.includes(`$${tk}`), tk);
    assert.deepEqual(t.operatorCreatorWallets, [OPERATOR]);
    assert.ok(OPERATOR_CREATOR_WALLETS.has(OPERATOR));
    clean(`${w.label}. ${w.description}`);
    const row = buildTransparency(process.cwd(), {}).wallets.find((x) => x.role === "operator-own")!;
    assert.equal(row.resolved, OPERATOR);
  });
  test("the trading-bot entry names this wallet and says the other bot wallets are not listed", () => {
    const w = t.wallets.find((x) => x.role === "trading-wallets")!;
    assert.match(w.description, /The other bot wallets are not listed\.$/);
    assert.doesNotMatch(w.description, /The owner decides which addresses|They are listed so anyone can check/);
    clean(w.description);
  });
  test("an operator creator wallet must be a key listed among the wallets", () => {
    assert.deepEqual(transparencyProblems(t), []);
    assert.ok(transparencyProblems({ ...t, operatorCreatorWallets: ["ESyaRxd4UavQpd2KAhjZ3BvGLxeJEtLqR5jPVhpdwqFy"] }).some((p) => /must also be listed in wallets/.test(p)));
    assert.ok(transparencyProblems({ ...t, operatorCreatorWallets: ["nope"] }).some((p) => /not a base58 public key/.test(p)));
  });
  test("the trust page's first-coin sentence names the operator's wallet", () => {
    const st = JSON.parse(read("config/burnticker/current-status.json")) as { phase: { line: string } };
    assert.match(st.phase.line, /the first coin made through the site, \$PHINFLWIN, was created that night by the operator's own wallet\./);
    clean(st.phase.line);
  });
});

describe("B-24 / HS-72: the coin-page sentence comes from the coin's creator", () => {
  test("the operator's wallet gets the sentence; any other creator gets nothing", () => {
    // ninth pass B-26: with no coin named the sentence says only what is true of every such coin; a coin with no listed trade keeps LINE
    assert.equal(operatorCreatorLine(OPERATOR), "Created by the operator's own wallet 8sJf…LvGbs during the soft launch. The operator holds none of it.");
    assert.equal(operatorCreatorLine(OPERATOR, "J45hvg6FYGzDMj3iYS3BJPU2pwqfoZhA7B8isnW4fin8"), LINE);
    assert.equal(operatorCreatorLine("ESyaRxd4UavQpd2KAhjZ3BvGLxeJEtLqR5jPVhpdwqFy"), null);
    assert.equal(operatorCreatorLine(null), null);
    clean(LINE);
  });
  const statusFor = async (creator: string) => {
    const w = await makeWorld();
    const t = { ...w.registry.token(w.bronco.mint)!, creator };
    const input = await tokenPageInput(w.p, t, NOW, { live: false });
    return buildTokenStatus(input, buildReceiptsJson(input));
  };
  test("a coin created by the operator's wallet carries it in its status and on its page; another creator's coin does not", async () => {
    const mine = await statusFor(OPERATOR);
    assert.equal(mine.addresses.creatorNote, LINE);
    assert.ok(renderTokenHtml(mine, [], []).includes("Created by the operator&#39;s own wallet 8sJf…LvGbs") || renderTokenHtml(mine, [], []).includes("Created by the operator's own wallet 8sJf…LvGbs"));
    const theirs = await statusFor("ESyaRxd4UavQpd2KAhjZ3BvGLxeJEtLqR5jPVhpdwqFy");
    assert.equal(theirs.addresses.creatorNote, null);
    assert.doesNotMatch(renderTokenHtml(theirs, [], []), /operator's own wallet|operator&#39;s own wallet/);
    assert.match(read("src/app/burnticker/t/[ticker]/page.tsx"), /\{s\.addresses\.creatorNote && <p [^>]*data-operator-creator>\{s\.addresses\.creatorNote\}<\/p>\}/);
  });
});
