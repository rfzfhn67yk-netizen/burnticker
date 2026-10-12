// Audit R03 (2026-10-11): fee-recipient descriptions disagreed — fees.designed.postGraduation.legs called the operator treasury "the
// Squads vault" while lpLock.operatorTreasury was 8cwwy895… (the developer fee wallet) and the operator page said the vault holds no fee
// stream. One record (lockFees.ts operatorTreasuryRecord) now names the address, holder, link and sentence per cluster, from the address
// compiled into the program.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { operatorTreasuryRecord, lpLockPolicyJson } from "@/lib/burnticker/lockFees";
import { OPERATOR_TREASURY as PROGRAM_TREASURY } from "@/lib/burnReceipts/constants";
import { POST_GRADUATION_FEES, postGraduationFeesFor } from "@/lib/burnticker/fees";
import { lpFeeLine } from "@/lib/burnticker/trustpack/ledger";

const DEV_FEE_WALLET = "8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5";
const op = JSON.parse(fs.readFileSync("config/burnticker/operator.json", "utf8"));
const cs = JSON.parse(fs.readFileSync("config/burnticker/current-status.json", "utf8"));

test("mainnet: the compiled treasury is the developer fee wallet, and the record never calls it the Squads vault", () => {
  const r = operatorTreasuryRecord("mainnet");
  assert.equal(r.address, PROGRAM_TREASURY.mainnet.toBase58());
  assert.equal(r.address, DEV_FEE_WALLET);
  assert.equal(r.isSquadsVault, false);
  assert.match(r.who, /developer fee wallet/);
  assert.doesNotMatch(r.who.replace(/not the Squads vault/, ""), /Squads vault/);
  assert.equal(r.url, `https://solscan.io/account/${DEV_FEE_WALLET}`);
  // the operator config agrees: the dev-fee wallet row is the operator treasury; the vault row holds no fee stream
  const wallets = op.clusters.mainnet.wallets as { role: string; label: string; pubkey: string }[];
  assert.equal(wallets.find((w) => w.role === "dev-fee")!.pubkey, DEV_FEE_WALLET);
  assert.match(wallets.find((w) => w.role === "dev-fee")!.label, /operator treasury/);
  assert.notEqual(wallets.find((w) => w.role === "squads-vault")!.pubkey, DEV_FEE_WALLET);
  assert.match(JSON.stringify(cs), new RegExp(`"feeWallet": ?"${DEV_FEE_WALLET}"`));
});

test("devnet: the rehearsal build compiles the devnet Squads vault, and the record says so", () => {
  const r = operatorTreasuryRecord("devnet");
  assert.equal(r.address, PROGRAM_TREASURY.devnet.toBase58());
  assert.equal(r.address, op.clusters.devnet.squads.vault);
  assert.equal(r.isSquadsVault, true);
});

test("every fee table and statement takes the operator leg's recipient from the record", () => {
  const leg = (f: typeof POST_GRADUATION_FEES) => f.legs.find((l) => l.label === "Burnticker (operator, LP fees)")!;
  assert.equal(leg(POST_GRADUATION_FEES).recipient, operatorTreasuryRecord("mainnet").text);
  assert.equal(leg(postGraduationFeesFor("mainnet")).recipient, operatorTreasuryRecord("mainnet").text);
  assert.equal(leg(postGraduationFeesFor("devnet")).recipient, operatorTreasuryRecord("devnet").text);
  assert.doesNotMatch(leg(postGraduationFeesFor("mainnet")).recipient, /\(the Squads vault\)/);
  const m = lpLockPolicyJson("mainnet", null);
  assert.equal(m.operatorTreasury, DEV_FEE_WALLET);
  assert.equal(m.operatorTreasuryHolder, operatorTreasuryRecord("mainnet").holder);
  assert.match(lpFeeLine("mainnet", null).note, new RegExp(DEV_FEE_WALLET));
  // no source file says the operator's LP-fee share goes to "the Squads vault" in words of its own
  for (const f of ["src/lib/burnticker/fees.ts", "src/lib/burnticker/trust.ts", "src/lib/burnticker/trustpack/ledger.ts", "src/app/burnticker/trust/page.tsx"]) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /operator treasury \(the Squads vault\)|pins the Squads vault/, f);
  }
});

// Audit R04 (2026-10-11): the Powers Register's upgrade row said "a public, time-locked proposal" while the mainnet time lock read 0.
test("R04: the upgrade-authority summary is derived from the time lock read from chain", async () => {
  const { upgradeDelaySummary } = await import("@/lib/burnticker/currentStatusText");
  const { loadPowersRegister } = await import("@/lib/burnticker/trust");
  assert.match(upgradeDelaySummary(0), /time lock is 0 today, so an approved upgrade can execute at once, with no notice period/);
  assert.doesNotMatch(upgradeDelaySummary(0), /time-locked/);
  assert.match(upgradeDelaySummary(172800), /A 48 h time lock then runs before it can execute/);
  assert.match(upgradeDelaySummary(null), /could not be read/);
  const row = (secs: number | null) => loadPowersRegister({}, process.cwd(), 0, secs).powers.find((p) => p.id === "program-upgrade-authority")!;
  assert.deepEqual(row(0).canDo, [upgradeDelaySummary(0)]);
  assert.deepEqual(row(172800).canDo, [upgradeDelaySummary(172800)]);
  assert.deepEqual(row(null).canDo, [upgradeDelaySummary(null)]);
  assert.match(fs.readFileSync("src/app/api/burnticker/trust/route.ts", "utf8"), /currentStatusLive\(\)[\s\S]*timeLockSecs[\s\S]*buildTrustPage\(\{[^}]*upgradeTimeLockSecs/);
});

// Audit R05 (2026-10-11): the build table's last column was headed "Deployed on devnet" over mainnet rows.
test("R05: the build table has a Network column; each row's deployed bytes, read date and evidence are that network's own", async () => {
  const { buildChecklist, checklistMarkdown } = await import("@/lib/burnticker/trustpack/checklist");
  const { DEPLOY_EVIDENCE } = await import("@/lib/burnticker/trustpack/verifiedBuild");
  const c = buildChecklist();
  for (const p of c.build.programs) for (const v of ["mainnet", "devnet"] as const) {
    const d = p.deployed[v];
    if (d) { assert.equal(d.evidence, DEPLOY_EVIDENCE[v]); assert.ok(fs.existsSync(d.evidence!), d.evidence); assert.match(d.readAt, /^\d{4}-\d{2}-\d{2}/); }
  }
  assert.ok(c.build.programs.every((p) => p.deployed.mainnet), "both programs carry a mainnet deployed record");
  const md = checklistMarkdown(c);
  assert.match(md, /\| Program \| Network \| Features \| Executable hash \(this repository\) \| Deployed bytes on that network \| Read \| Evidence \|/);
  assert.doesNotMatch(md, /Deployed \(devnet\)/);
  assert.match(md, /\| burn_receipts \| mainnet \|[^\n]*same as the build \| 2026-10-11 \| docs\/burnkeeper\/evidence\/mainnet-deploy-2026-10-11\/deploy\.json \|/);
  const page = fs.readFileSync("src/app/burnticker/check/page.tsx", "utf8");
  assert.doesNotMatch(page, /Deployed on devnet/);
  assert.match(page, /<th className="p-2">Network<\/th>[\s\S]*<th className="p-2">Read<\/th><th className="p-2">Evidence<\/th>/);
  assert.match(page, /d\?\.evidence \? <RepoText text=\{d\.evidence\} \/>/);
});
