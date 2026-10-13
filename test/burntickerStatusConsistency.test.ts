// Review 8 F2 / audit 7 #1 (2026-10-12): the current-status object contradicted itself — the phase line said both programs were
// upgraded to round 4 while the program entries still said "pair-forward round 3 build", the burn program's note said "The
// end-of-rule sink (round 4) is not built" and a design line said "designed but not built". This test holds the human-maintained
// file to the verified-build table (the deployment facts) so the two cannot drift apart again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Status = {
  phase: { line: string };
  programs: { name: string; version: string; note: string; mainnetDeploy: { date: string; slot: number; onChainSha256: string } }[];
  design: string[];
  releaseRequirements: { id: string; text: string; status: "open" | "done" }[];
};
type VerifiedBuild = { programs: { library: string; builds: { mainnet: { status: string } }; deployed: { mainnet: { slot: number; sha256: string; readAt: string } } }[] };

const st = JSON.parse(readFileSync("config/burnticker/current-status.json", "utf8")) as Status;
const vb = JSON.parse(readFileSync("config/burnticker/verified-build.json", "utf8")) as VerifiedBuild;
const roundOf = (s: string) => Number(/round (\d)/.exec(s)?.[1] ?? NaN);

test("the phase line, the program entries and the verified-build table name the same program round", () => {
  const phaseRound = roundOf(st.phase.line);
  assert.ok(Number.isFinite(phaseRound), "the phase line names a round");
  for (const p of st.programs) {
    const v = vb.programs.find((x) => x.library === p.name);
    assert.ok(v, `${p.name} is in verified-build.json`);
    assert.equal(roundOf(p.version), phaseRound, `${p.name}: version says round ${roundOf(p.version)}, the phase says round ${phaseRound}`);
    assert.equal(roundOf(v!.builds.mainnet.status), phaseRound, `${p.name}: verified-build says round ${roundOf(v!.builds.mainnet.status)}`);
    assert.equal(p.mainnetDeploy.slot, v!.deployed.mainnet.slot, `${p.name}: mainnet slot`);
    assert.equal(p.mainnetDeploy.onChainSha256, v!.deployed.mainnet.sha256, `${p.name}: on-chain sha256`);
    assert.equal(p.mainnetDeploy.date, v!.deployed.mainnet.readAt, `${p.name}: deploy date equals the verified-build read-back date`);
  }
});

test("nothing in the current object calls deployed round-4 functionality unbuilt or round 3", () => {
  const current = [st.phase.line, ...st.programs.flatMap((p) => [p.version, p.note]), ...st.design, ...st.releaseRequirements.map((r) => r.text)];
  for (const s of current) {
    assert.doesNotMatch(s, /not built|designed but not built|round 3 build/i, s);
  }
  // the end sink is the round-4 feature the contradiction was about: its requirement is done, its re-check is a separate open item
  const sink = st.releaseRequirements.find((r) => r.id === "end-sink");
  assert.equal(sink?.status, "done");
  assert.ok(st.releaseRequirements.some((r) => r.id === "r4-recheck" && r.status === "open"), "the independent re-check of round 4 stays open until there is evidence");
  assert.ok(st.design.some((l) => /sink/.test(l) && /devnet and mainnet/.test(l)), "the design line about the sink states where the program carries it");
});
