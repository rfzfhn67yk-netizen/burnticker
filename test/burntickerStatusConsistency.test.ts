// Review 8 F2 / audit 7 #1 (2026-10-12): the current-status object contradicted itself — the phase line said both programs were
// upgraded to round 4 while the program entries still said "pair-forward round 3 build", the burn program's note said "The
// end-of-rule sink (round 4) is not built" and a design line said "designed but not built". This test holds the human-maintained
// file to the verified-build table (the deployment facts) so the two cannot drift apart again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Status = {
  phase: { line: string };
  programs: { name: string; version: string; note: string; mainnetDeploy: { date: string; slot: number; onChainExecutableHash: string; buildFileSha256: string } }[];
  design: string[];
  releaseRequirements: { id: string; text: string; status: "open" | "done" }[];
};
type VerifiedBuild = { programs: { library: string; round?: number; builds: { mainnet: { status: string; sha256: string } }; deployed: { mainnet: { slot: number; hash: string; readAt: string; pendingUpgrade?: string } } }[] };

const st = JSON.parse(readFileSync("config/burnticker/current-status.json", "utf8")) as Status;
const vb = JSON.parse(readFileSync("config/burnticker/verified-build.json", "utf8")) as VerifiedBuild;
const roundOf = (s: string) => Number(/round (\d)/.exec(s)?.[1] ?? NaN);

// Third prelaunch audit (2026-10-16): the programs no longer share one round — burn_receipts runs round 5 on mainnet since 2026-10-15,
// pair_curve stays on round 4 — so each program's round is held to the verified-build table's own `round`, and the phase line must name
// every program's current round.
test("the phase line, the program entries and the verified-build table name the same program round, per program", () => {
  for (const p of st.programs) {
    const v = vb.programs.find((x) => x.library === p.name);
    assert.ok(v, `${p.name} is in verified-build.json`);
    assert.ok(Number.isInteger(v!.round), `${p.name}: verified-build.json records its round`);
    assert.equal(roundOf(p.version), v!.round, `${p.name}: version says round ${roundOf(p.version)}, verified-build says round ${v!.round}`);
    assert.equal(roundOf(v!.builds.mainnet.status), v!.round, `${p.name}: the mainnet build's status says round ${roundOf(v!.builds.mainnet.status)}`);
    assert.ok(st.phase.line.includes(`round ${v!.round}`), `${p.name}: the phase line names round ${v!.round}`);
    assert.equal(p.mainnetDeploy.slot, v!.deployed.mainnet.slot, `${p.name}: mainnet slot`);
    // review of the release identity: the on-chain hash is the read-back executable hash; the .so file's sha256 is named as a build fact
    assert.equal(p.mainnetDeploy.onChainExecutableHash, v!.deployed.mainnet.hash, `${p.name}: the on-chain executable hash is the read-back's`);
    // B-17 (2026-10-21): while an upgrade is pending the table's build is the newer one; the deployed bytes are round 5's build file
    if (v!.deployed.mainnet.pendingUpgrade) assert.equal(p.mainnetDeploy.buildFileSha256, "cd0146726962ce586cce2004a5141309f921dba2908dea7146f7872e6bfed290", `${p.name}: the deployed round-5 build file's sha256`);
    else assert.equal(p.mainnetDeploy.buildFileSha256, v!.builds.mainnet.sha256, `${p.name}: the build file's sha256`);
    assert.ok(!("onChainSha256" in p.mainnetDeploy), `${p.name}: no field calls a file hash an on-chain hash`);
    assert.ok(p.mainnetDeploy.date <= v!.deployed.mainnet.readAt, `${p.name}: deployed (${p.mainnetDeploy.date}) on or before the verified-build read-back (${v!.deployed.mainnet.readAt})`);
  }
  assert.match(st.phase.line, /burn_receipts\) was upgraded again, to round 5/);
  assert.match(st.phase.line, /pair_curve\) stays on round 4/);
  assert.match(st.phase.line, /On 2026-10-21 the burn program was upgraded through the vault once more, still round 5/);
});

test("the deployed bytes are the ones the mainnet evidence expects: B-17 now (execution sheet, read-back), round 5 before it (round-5 sheet, the Squads proposal check, the read-back)", () => {
  const br = (vb as unknown as { programs: { library: string; deployed: { mainnet: { hash: string } } }[] }).programs.find((x) => x.library === "burn_receipts")!;
  // B-17 (2026-10-21, vault transaction 4): the execution sheet names the hash the chain must show, and the read-back found it
  const sheet = readFileSync("docs/burnkeeper/evidence/mainnet-b17/README-execution.md", "utf8");
  const b17 = /executable hash \(what the chain shows[^\n]*\n\s*`([0-9a-f]{64})`/.exec(sheet)![1];
  assert.equal(br.deployed.mainnet.hash, b17);
  assert.match(readFileSync("docs/burnkeeper/evidence/mainnet-b17/onchain-verify-after.log", "utf8"), new RegExp(`MATCH  mainnet burn_receipts \\S+ ${b17}`));
  const cur = st.programs.find((p) => p.name === "burn_receipts")!.mainnetDeploy as unknown as { squadsExecuteSignature: string; previous: { onChainExecutableHash: string } };
  assert.ok(sheet.includes(cur.squadsExecuteSignature), "the execution sheet records the execute signature");
  // the round-5 bytes it replaced
  const expected = /executable_hash ([0-9a-f]{64})/.exec(readFileSync("docs/burnkeeper/evidence/mainnet-round5/burn_receipts.mainnet.expected-hash.txt", "utf8"))![1];
  const proposal = JSON.parse(readFileSync("docs/burnkeeper/evidence/mainnet-round5/br-proposal-verify.json", "utf8")) as { verdict: string; instructions: { bufferExecutableHash: string }[] };
  assert.equal(cur.previous.onChainExecutableHash, expected);
  assert.equal(proposal.verdict, "matches");
  assert.equal(proposal.instructions[0].bufferExecutableHash, expected);
  assert.match(readFileSync("docs/burnkeeper/evidence/mainnet-round5/onchain-verify-after.log", "utf8"), new RegExp(`MATCH  mainnet burn_receipts \\S+ ${expected}`));
});

test("nothing in the current object calls deployed round-4 functionality unbuilt or round 3", () => {
  const current = [st.phase.line, ...st.programs.flatMap((p) => [p.version, p.note]), ...st.design, ...st.releaseRequirements.map((r) => r.text)];
  for (const s of current) {
    assert.doesNotMatch(s, /not built|designed but not built|round 3 build/i, s);
  }
  // the end sink is the round-4 feature the contradiction was about: its requirement is done (owner 2026-10-22: no re-check item on the site)
  const sink = st.releaseRequirements.find((r) => r.id === "end-sink");
  assert.equal(sink?.status, "done");
  assert.ok(!st.releaseRequirements.some((r) => r.id === "r4-recheck"), "no review re-check item in the public status");
  assert.ok(st.design.some((l) => /sink/.test(l) && /devnet and mainnet/.test(l)), "the design line about the sink states where the program carries it");
});

test("the trust page's upgrade-authority source line says whether this host sets the key", async () => {
  const { loadPowersRegister } = await import("@/lib/burnticker/trust");
  // the env-built roster is what a host without the shipped register shows (an empty root here)
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const empty = mkdtempSync(join(tmpdir(), "bt-powers-"));
  const row = (env: Record<string, string>) => loadPowersRegister(env, empty, 0, 0).powers.find((p) => p.id === "program-upgrade-authority")!;
  assert.equal(row({}).source, "BURNTICKER_UPGRADE_AUTHORITY (not set on this host)");
  assert.equal(row({ BURNTICKER_UPGRADE_AUTHORITY: "8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV" }).source, "BURNTICKER_UPGRADE_AUTHORITY on this host");
});

test("no current doc still calls round 5 'built, not deployed' or the round-4 program 'today'", () => {
  for (const f of ["docs/burnticker/VERIFIED-BUILD.md", "docs/burn-receipts/powers-register.md", "docs/burn-receipts/powers-register.json", "docs/burnticker/WHITEPAPER.md", "site/burnticker/whitepaper.html", "docs/burnticker/END-SINK.md", "docs/burnticker/PAIR-CURVE.md", "docs/burnticker/PROGRAM-UPGRADE-QUEUE.md", "docs/burnticker/ATTESTERS.md"]) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /built, not deployed|staged, not deployed|round-4 program today|built on the round-5 branch, not deployed/, f);
  }
  assert.doesNotMatch(readFileSync("docs/burnticker/EXTERNAL-BURN.md", "utf8").split("\n").slice(0, 6).join("\n"), /nothing deployed/, "EXTERNAL-BURN's opening says it is deployed");
  // a .so file's sha256 is never called an on-chain hash on the live rows of the table (round-4 rows kept in HTML comments are history)
  const live = readFileSync("docs/burnticker/VERIFIED-BUILD.md", "utf8").split("\n").filter((l) => l.startsWith("| pair_curve") || l.startsWith("| burn_receipts"));
  for (const l of live) assert.doesNotMatch(l, /on-chain sha256/, l.slice(0, 80));
});
