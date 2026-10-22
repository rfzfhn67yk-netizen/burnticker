// I-1 (audit 2026-10-19, second pass): false or stale statements on the trust surfaces. Each statement is checked against the code or
// config it describes, and every new sentence passes the copy lint. Fee numbers are untouched.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { auditHeadline } from "@/lib/burnticker/auditBadge";
import { buildCurrentStatus, mainnetDeployment } from "@/lib/burnticker/currentStatus";
import { upgradeAuthorityText } from "@/lib/burnticker/currentStatusText";
import { buildWellKnown } from "@/lib/burnticker/trustpack/wellKnown";
import { GUARDRAILS, GUARDRAIL_DETAIL } from "@/lib/burnticker/safeguards";
import { RULE_BOUNDS } from "@/lib/burnticker/rules";
import { VERIFY_YOURSELF_COPY } from "@/lib/burnticker/historyCopy";
import { lintCopy } from "@/lib/launch/copyLint";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const T = JSON.parse(read("config/burnticker/transparency.json")) as Record<string, unknown>;
const all = JSON.stringify(T);
const textOf = (id: string): string => {
  const hit = JSON.stringify(T).match(new RegExp(`"id":"${id}","status":"[^"]*","text":"((?:[^"\\\\]|\\\\.)*)"`));
  assert.ok(hit, `transparency.json has ${id}`);
  return JSON.parse(`"${hit![1]}"`) as string;
};
const clean = (s: string) => assert.equal(lintCopy(s).hits.length, 0, JSON.stringify(lintCopy(s).hits));

describe("I-1 transparency.json statements match the program", () => {
  test("the pool cap: the program enforces its 25 SOL default without a platform account, not only the keeper", () => {
    const t = textOf("cap-25");
    assert.doesNotMatch(t, /only the keeper enforces/);
    assert.match(t, /the program still enforces its built-in default of 25 SOL until 2027-10-01/);
    assert.match(read("programs/burn-receipts/programs/burn_receipts/src/state.rs"), /pub fn default_active_cap/);
    clean(t);
  });
  test("the Squads vault's config authority is listed with every power the program gives it", () => {
    const d = (T.wallets as { role: string; description: string }[] | undefined)?.find((w) => w.role === "squads-vault")?.description ?? all.match(/"role": ?"squads-vault"[^}]*"description": ?"([^"]*)"/)?.[1] ?? "";
    assert.doesNotMatch(d, /can only change the attester set/);
    for (const re of [/change the attester set/, /propose a new pool for a coin's pinned token/, /switch a coin's registration policy/, /renounce/]) assert.match(d, re);
    const admin = read("programs/burn-receipts/programs/burn_receipts/src/instructions/admin.rs") + read("programs/burn-receipts/programs/burn_receipts/src/instructions/burn_target.rs");
    for (const fn of ["handle_propose_attesters", "handle_set_registration_policy", "handle_renounce_admin", "handle_propose_target_pool"]) assert.match(admin, new RegExp(`pub fn ${fn}`));
    clean(d);
  });
  test("a resolved end forwards to the end sink; only a void (or a coin with no end sink) winds down over 28 days", () => {
    const t = textOf("one-shot");
    assert.doesNotMatch(t, /Any other ending winds the pool down/);
    assert.match(t, /A resolved ending on a coin with an end sink sends what is left in the pool to that end sink/);
    assert.match(t, /A void ending, or a coin without an end sink, winds the pool down on the coin itself over 28 days/);
    clean(t);
  });
  test("the platform's buy policy names the disclosed test buy", () => {
    assert.doesNotMatch(all, /The platform never buys any coin/);
    assert.match(all, /with two disclosed exceptions: the operator bought 0\.1 SOL of \$REHEARSAL, a test coin, when it was created on 2026-10-11, and the operator's own wallet bought 0\.10 SOL of \$SEAWIN/);
    assert.ok(!GUARDRAILS.some((g) => g === ("the platform never buys any coin" as string)));
    const g = GUARDRAILS.find((x) => x.startsWith("the platform buys no coin"))!;
    assert.match(GUARDRAIL_DETAIL[g].text, /\$REHEARSAL/);
    clean(g);
  });
  test("the 25 SOL cap number is unchanged", () => {
    assert.match(textOf("cap-25"), /at most 25 SOL per burn day/);
  });
});

describe("I-1 the whitepaper", () => {
  const md = read("docs/burnticker/WHITEPAPER.md"), html = read("site/burnticker/whitepaper.html");
  test("the recurring limit is the code's 25 %, not 10 %", () => {
    assert.equal(RULE_BOUNDS.fractionOfPool.max, 0.25);
    assert.doesNotMatch(md, /Recurring rules stay at 10 %/);
    assert.match(md, /Recurring rules stay at 25 % or less per unit/);
    assert.match(html, /Recurring rules stay at 25 % or less per unit/);
  });
  test("items that exist are no longer listed as not built; the second attester still is", () => {
    assert.doesNotMatch(md, /Mainnet program deployment, the second attester, the audit's chain leg, and the systemd units/);
    assert.match(md, /\*\*Not built\.\*\* The second, independent attester is not built\./);
    assert.doesNotMatch(md, /Its chain\nleg, which would compare each memo on chain, is not wired/);
  });
  test("the audit is described as a recomputation of recorded receipts, with no mainnet burn executed yet", () => {
    assert.match(md, /This is a recomputation of\nrecorded receipts\. It is not proof that a burn happened: no mainnet burn has executed yet/);
  });
});

describe("I-1 the audit headline and the verify page", () => {
  test("with zero executed it says recomputation and that no mainnet burn has executed", () => {
    const h = auditHeadline({ ok: true, receipts: 3, executed: 0, mismatches: 0 }, "mainnet");
    assert.match(h, /This is a recomputation of recorded receipts\./);
    assert.match(h, /no mainnet burn has executed yet/);
    assert.doesNotMatch(h, /^Every receipt recomputes\.$/);
    clean(h);
    assert.match(auditHeadline({ ok: true, receipts: 0, executed: 0, mismatches: 0 }, "mainnet"), /No mainnet burn has executed yet/);
    assert.doesNotMatch(auditHeadline({ ok: true, receipts: 3, executed: 2, mismatches: 0 }, "mainnet"), /not proof/);
    assert.equal(auditHeadline({ ok: false, receipts: 3, executed: 2, mismatches: 1 }, "mainnet"), "The audit found 1 mismatch.");
  });
  test("the trust page renders the headline, never the bare 'Every receipt recomputes.'", () => {
    const page = read("src/app/burnticker/trust/page.tsx");
    assert.doesNotMatch(page, /"Every receipt recomputes\."/);
    assert.match(page, /auditHeadline\(/);
  });
  test("the verify-yourself page says no mainnet burn has executed while it shows the devnet receipt", () => {
    assert.match(VERIFY_YOURSELF_COPY.devnet, /No mainnet burn has executed yet\./);
    clean(VERIFY_YOURSELF_COPY.devnet);
  });
});

describe("I-1 mainnet bytes and authority are stated, not only devnet's", () => {
  test("mainnetDeployment states the mainnet match and the mainnet vault", () => {
    const m = mainnetDeployment(true, undefined, "x", { matchesBuild: true, upgradeAuthority: "8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV", readAt: "2026-10-16" });
    assert.match(m.line, /Its bytes there match this repository's recorded build\./);
    assert.match(m.line, /Its mainnet upgrade authority is 8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV/);
    clean(m.line);
  });
  test("the summary line says both networks match, and the devnet authority is labelled devnet", () => {
    const s = buildCurrentStatus({ root: ROOT, env: {}, chain: {}, now: Date.parse("2026-10-19T12:00:00Z") });
    // B-17 (2026-10-21): pair_curve's round-4 bytes are its build; burn_receipts runs B-17 on both networks since 2026-10-21 (next test)
    const pair = s.lines.find((l) => l.startsWith("The program that runs pair launches (pair_curve)"))!;
    assert.match(pair, /On both networks its bytes match this repository's recorded build\./);
    const p = s.programs.find((x) => x.name === "burn_receipts")!;
    assert.match(p.mainnet.line, /8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV/);
    assert.match(upgradeAuthorityText(p.devnet, "devnet"), /^The devnet upgrade authority is A8VV/);
    assert.equal(s.checkedAt, "2026-10-19", "the checked-on date is current");
  });
  test("B-17 deployed on mainnet and devnet (2026-10-21): both networks say the bytes match, no pending sentence anywhere", () => {
    const s = buildCurrentStatus({ root: ROOT, env: {}, chain: {}, now: Date.parse("2026-10-22T01:00:00Z") });
    const burn = s.lines.find((l) => l.startsWith("The program that records burns (burn_receipts)"))!;
    assert.equal(burn, "The program that records burns (burn_receipts) is deployed on devnet and on mainnet. On both networks its bytes match this repository's recorded build.");
    assert.doesNotMatch(burn, /DO NOT match|has not been deployed/);
    const p = s.programs.find((x) => x.name === "burn_receipts")!;
    assert.equal(p.devnet.matchesBuild, true); assert.equal(p.devnet.upgradePending, undefined);
    assert.equal(p.mainnet.matchesBuild, true); assert.equal(p.mainnet.upgradePending, undefined);
    assert.match(p.mainnet.line, /^It is deployed on mainnet\. Its bytes there match this repository's recorded build\. Its mainnet upgrade authority is 8zsH/);
    clean(burn); clean(p.mainnet.line);
    // a difference that is not a recorded pending upgrade still says DO NOT match
    const m = mainnetDeployment(true, undefined, "x", { matchesBuild: false, upgradeAuthority: "8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV", readAt: "2026-10-16", hash: "11".repeat(32) }, "22".repeat(32));
    assert.match(m.line, /Its bytes there DO NOT match the recorded build\./); assert.equal(m.upgradePending, undefined);
    // the summary component shows the devnet sentence too
    assert.match(read("src/app/burnticker/_components/CurrentStatusSummary.tsx"), /p\.devnet\.upgradePending \? ` \$\{p\.devnet\.upgradePending\}` : ""/);
  });
  test("the trust page's chain facts name the mainnet match and its authority", () => {
    assert.match(read("src/lib/burnticker/trust.ts"), /mainnet: main \? `deployed \(\$\{when\(main\)\}\$\{bytes\(main\)\}; upgrade authority \$\{main\.upgradeAuthority\}\)`/);
  });
});

describe("I-1 the well-known file carries no raw placeholder markers", () => {
  test("unset entity and GitHub organisation are null with a reason", () => {
    const w = buildWellKnown(ROOT) as { operator: { entity: string | null; entityPending?: string }; links: { githubOrg: string | null } };
    assert.equal(w.operator.entity, null);
    assert.match(w.operator.entityPending ?? "", /LLC|entity/);
    assert.equal(w.links.githubOrg, null);
    for (const f of ["public/.well-known/burnticker.json", "site/burnticker/.well-known/burnticker.json"]) assert.doesNotMatch(read(f), /TODO_/);
  });
});
