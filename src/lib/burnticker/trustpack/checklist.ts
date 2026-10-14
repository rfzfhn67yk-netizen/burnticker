import fs from "node:fs";
import path from "node:path";
import { loadTransparency, TRANSPARENCY_FILE } from "@/lib/burnticker/trust";
import { DEPLOY_EVIDENCE, loadVerifiedBuild, VERIFIED_BUILD_FILE, type VerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { loadOperator, OPERATOR_FILE } from "@/lib/burnticker/trustpack/operator";

/**
 * "CHECK THIS YOURSELF" — THE SCEPTIC'S CHECKLIST AGAINST OURSELVES (trust pack, 2026-10-10). Built only from files anyone can read in
 * the public repository: the two Powers Registers (generated from the programs' IDLs), config/burnticker/transparency.json, the
 * verified-build table and the operator config. The page /burnticker/check, GET /api/burnticker/v1/check and
 * docs/burnticker/CHECK-THIS-YOURSELF.md (`scripts/burnticker-trustpack.mts check-doc --write`) are three renderings of this object;
 * the test holds the doc equal to it.
 *
 *   money     every instruction of both programs with its outflow class — derived from the register's own "Funds" text by name, and
 *             a new instruction without a class fails the test (so nothing new can slip in unclassified)
 *   powers    every privileged instruction with its holder; "over funds": none, asserted from the registers (every privileged
 *             instruction's Funds is "None.", and pair_curve's register says powers_over_funds = none)
 *   locked    what no key can change, each with the register line that says so
 *   notDone   the open gaps, from transparency.json (statuses not done / interim / devnet only) plus the standing ones
 *   build     the hash table
 */

export const REGISTER_FILES = { burn_receipts: path.join("docs", "burn-receipts", "powers-register.json"), pair_curve: path.join("docs", "burn-receipts", "pair-curve-powers-register.json") } as const;
export type ProgramName = keyof typeof REGISTER_FILES;

interface RegisterInstruction { name: string; class: string; signers: { account: string; role: string }[]; can: string; cannot: string; timelock: string | null; sunset: string | null; funds: string }
interface Register { schema: string; program: { name: string; address_in_idl: string; idl_sha256: string }; roles: Record<string, string>; instructions: RegisterInstruction[]; privileged_powers: string[]; non_powers: string[]; upgrade_authority: { power: string; holder_at_launch: string; sunset: string }; external_powers: { power: string; holder: string; can?: string; effect?: string }[]; powers_over_funds?: string }

/** The outflow classes, in the words the page prints. */
export const OUTFLOW = {
  none: "none",
  rent: "rent only, paid by the caller",
  intoPool: "fees go into the burn pool",
  swapBurn: "SOL from the burn pool is swapped for the coin, and every token received is burned",
  burn: "tokens from the vault are burned",
  trade: "the trader's own funds, priced by the formula, or pro rata after a void; the fees stay in the pair's vault",
  graduate: "the curve's SOL goes into the Raydium pool, and lock_lp then locks that pool's LP tokens forever; leftover tokens are burned; the side's held fees and leftovers go to its burn pool",
  close: "voided pairs only; leftovers go to the burn pools, and the account rent goes back to the creator who paid it",
  devClaim: "the 0.25% fee collected so far goes to the developer wallet set at setup",
  lockFees: "the locked LP's fees: 80% go to the burn pool and 20% to the operator treasury, both fixed in the code; the coin side is burned",
  lock: "the pool's LP tokens go into Raydium's lock forever; the burn program holds the Fee Key",
  forwardWinner: "a paired coin's fuel for a period it lost goes to the winner's burn pool, in the formula's amount, and the winner's own burns spend it",
  swapBurnOther: "SOL from the burn pool is swapped, on the one pool pinned before the coin existed, for the other token the coin burns, and every token received is burned",
  forwardEnd: "a coin whose rule ended with a result sends its remaining fuel, and any fees that arrive later, to its end sink's burn pool (the named coin while it is live, otherwise the flagship $DEFICIT), and that coin's own burns spend it",
  incinerateEnd: "a coin whose end sink is Solana's incinerator sends the SOL left after its rule ended with a result, and any fees that arrive later, to the incinerator, which nothing can spend from",
  lpBurnFallback: "fallback only: if lock_lp cannot run for 30 days, burn_lp destroys the side's LP tokens, and there are no LP fees after that",
} as const;
export type OutflowClass = keyof typeof OUTFLOW;

/** Every instruction's class. A new instruction must be added here (the test fails on any instruction missing from this table). */
export const OUTFLOW_BY_INSTRUCTION: Record<ProgramName, Record<string, OutflowClass>> = {
  burn_receipts: {
    apply_attester_change: "none", apply_paired_attester_change: "none", apply_cap_raise: "none", apply_registration_policy: "none", cancel_attester_change: "none", cancel_cap_raise: "none",
    cancel_registration_policy: "none", check_pool_health: "none", claim_launchlab_creator_fee: "intoPool", claim_lock_fees: "lockFees", clear_cranker_allowlist: "none",
    crank_buyback: "swapBurn", crank_no_units: "none", crank_vault: "burn", initialize_platform: "rent", initialize_token: "rent", propose_attesters: "none",
    propose_cap_raise: "none", register_fee_key: "rent", link_pair: "rent", submit_pair_result: "rent", forward_to_winner: "forwardWinner", unlink_pair: "rent", submit_rule_end: "rent", forward_on_end: "forwardEnd", register_pair_pool: "none", register_pool: "none", renounce_admin: "none", renounce_platform_authority: "none", replace_pool: "none",
    set_registration_policy: "none", submit_reading: "rent", veto_registration_policy: "none",
    pin_burn_target: "rent", crank_target_burn: "swapBurnOther", initialize_token_r5: "rent", burn_sol_on_end: "incinerateEnd", propose_target_pool: "none", cancel_target_pool: "none", veto_target_pool: "none", apply_target_pool: "none",
  },
  pair_curve: { buy: "trade", sell: "trade", graduate: "graduate", close_pair: "close", init_pair: "rent", void_pair: "none", claim_developer_fee: "devClaim", lock_lp: "lock", burn_lp: "lpBurnFallback" },
};

export interface MoneyRow { program: ProgramName; instruction: string; class: string; signers: string; outflow: string; outflowClass: OutflowClass; funds: string; /** private review 9: an instruction the published source adds in round 5, not on the deployed round-4 program yet */ sourceOnly: boolean }
export interface PowerRow { program: ProgramName; instruction: string; holder: string; can: string; timelock: string | null; funds: string; /** website-15 item 11: the register's label and internal review ids, for a title or footnote, never the cell */ note: string | null }

/**
 * INTERNAL REVIEW IDS OUT OF THE CELLS (website-15 item 11, Claude site audit 3 item 8). The registers are generated from the programs and
 * keep their reviewers' cross-references ("Re-check R3-4: …", "(re-check R3-2 — …)", "STRANDING RECOVERY: …"). A visitor reads the
 * sentence; the label and the ids move to `note`, which the page shows as a footnote column and a title. The register files are untouched.
 */
export function splitReviewRefs(text: string): { text: string; note: string | null } {
  const refs: string[] = [];
  let label: string | null = null;
  let t = text;
  t = t.replace(/\s*\((?:re-check|pair-forward r\d) ([A-Z]{1,2}\d?-\d+)(?:: | — )([^)]*)\)/g, (_m, id: string, rest: string) => { refs.push(id); return ` (${rest})`; });
  t = t.replace(/\s*\((?:re-check|pair-forward r\d) ([A-Z]{1,2}\d?-\d+)\)/g, (_m, id: string) => { refs.push(id); return ""; });
  t = t.replace(/\bRe-check ([A-Z]{1,2}\d?-\d+): (\S)/g, (_m, id: string, c: string) => { refs.push(id); return c.toUpperCase(); });
  t = t.replace(/^pair-forward blind review ([A-Z]-\d+) \/ r\d ((?:[A-Z]{1,2}-\d+)(?:, [A-Z]{1,2}-\d+)*): /, (_m, a: string, b: string) => { refs.push(a, ...b.split(", ")); return ""; });
  t = t.replace(/^LAUNCHPAD-PATH (§\d+): /, (_m, id: string) => { refs.push(`LAUNCHPAD-PATH ${id}`); return ""; });
  t = t.replace(/^([A-Z]{3,}(?: [A-Z]{3,})*): /, (_m, l: string) => { label = l.charAt(0) + l.slice(1).toLowerCase(); return ""; });
  t = t.replace(/^./, (c) => c.toUpperCase()).replace(/\s{2,}/g, " ");
  const note = [label ? `${label}.` : null, refs.length ? `Review references: ${refs.join(", ")}.` : null].filter(Boolean).join(" ") || null;
  return { text: t, note };
}
export interface CheckItem { id: string; title: string; text: string; where: string; status?: string }
export interface Checklist {
  schema: "burnticker.check/v1"; generatedFrom: string[];
  programs: { name: ProgramName; programId: string; idlSha256: string; register: string; privileged: number; overFunds: "none" }[];
  money: MoneyRow[];
  /** private review 9 (editorial): where the instruction list comes from, the published source, beside what is deployed (with the commit) */
  moneySource: string;
  nonPowers: { program: ProgramName; text: string }[];
  powers: PowerRow[]; upgradeAuthority: { program: ProgramName; holder: string; sunset: string }[]; external: { program: ProgramName; power: string; holder: string; effect: string }[];
  locked: CheckItem[]; notDone: CheckItem[];
  build: VerifiedBuild;
}

/** A pointer into a file, in words: "<file>, under <key>". */
const at = (file: string, key: string) => `${file}, under ${key}`;

export function loadRegister(root: string, p: ProgramName): Register {
  return JSON.parse(fs.readFileSync(path.join(root, REGISTER_FILES[p]), "utf8")) as Register;
}

/**
 * Private review 9 (editorial): the checker said "48 instructions" as if all were deployed. The list is the published source's (the
 * programs' registers, round 5); the deployed programs are the round-4 build of the commit verified-build.json records.
 */
export function moneySourceLine(money: readonly Pick<MoneyRow, "sourceOnly">[], build: Pick<VerifiedBuild, "sourceCommit">): string {
  const n5 = money.filter((m) => m.sourceOnly).length, commit = String(build.sourceCommit ?? "").slice(0, 10);
  return `These ${money.length} instructions are the published source's (the programs' registers, round 5).${n5 ? ` ${n5} of them are new in round 5 and are not on the deployed programs yet.` : ""} The deployed programs are the round-4 build of commit ${commit || "(not recorded)"}, checked in section 5.`;
}

export function buildChecklist(root = process.cwd()): Checklist {
  const regs = { burn_receipts: loadRegister(root, "burn_receipts"), pair_curve: loadRegister(root, "pair_curve") };
  const t = loadTransparency(root);
  const op = loadOperator(root);
  const vb = loadVerifiedBuild(root);
  // audit R05: each deployed record names its own evidence (mainnet deploy file / devnet verified-build doc)
  const build: VerifiedBuild = { ...vb, programs: vb.programs.map((p) => ({ ...p, deployed: { devnet: p.deployed.devnet ? { ...p.deployed.devnet, evidence: DEPLOY_EVIDENCE.devnet } : null, mainnet: p.deployed.mainnet ? { ...p.deployed.mainnet, evidence: DEPLOY_EVIDENCE.mainnet } : null } })) };
  const money: MoneyRow[] = [], powers: PowerRow[] = [];
  for (const name of ["burn_receipts", "pair_curve"] as ProgramName[]) {
    for (const ix of regs[name].instructions) {
      const cls = OUTFLOW_BY_INSTRUCTION[name][ix.name];
      if (!cls) throw new Error(`${REGISTER_FILES[name]}: instruction ${ix.name} has no outflow class in checklist.ts OUTFLOW_BY_INSTRUCTION`);
      money.push({ program: name, instruction: ix.name, class: ix.class, signers: ix.signers.map((s) => s.role).join(" + "), outflow: OUTFLOW[cls], outflowClass: cls, funds: splitReviewRefs(ix.funds ?? "None.").text, sourceOnly: /^Round 5\b/.test(ix.can) });
      if (ix.class === "privileged") { const c = splitReviewRefs(ix.can); powers.push({ program: name, instruction: ix.name, holder: ix.signers.map((s) => s.role).join(" + "), can: c.text, timelock: ix.timelock, funds: ix.funds, note: c.note }); }
    }
  }
  const overFunds = powers.filter((p) => !/^None\.?$/.test(p.funds.trim()));
  if (overFunds.length) throw new Error(`a privileged instruction moves funds: ${overFunds.map((p) => p.instruction).join(", ")} — the page cannot say "none over funds"`);
  if (regs.pair_curve.powers_over_funds !== "none") throw new Error("pair_curve register no longer says powers_over_funds = none");

  const dev = op.clusters.devnet;
  const locked: CheckItem[] = [
    { id: "rule", title: "Each coin's rule", text: "The burn rule, the data feed, the memo text and the hash of the rules file are written once, when the coin is set up (initialize_token). No instruction can change them. A different rule means a different coin. The rules file's sha256 hash is stored on chain (TokenConfig.rules_sha256) and appears in every memo.", where: at(REGISTER_FILES.burn_receipts, "non_powers") },
    { id: "readings", title: "Readings and receipts", text: "Readings can only be added. The program checks the signers on chain before it stores one, and no instruction edits or deletes a reading. Off chain, the registry database uses SQL triggers to refuse edits and deletes.", where: at(REGISTER_FILES.burn_receipts, "submit_reading") },
    { id: "pools", title: "Where a burn pool can trade", text: "Each coin's pool is registered once, after its origin is checked, and then it is frozen. A dead pool can be replaced only after 7 days in a row on record in which it could not trade, and the new pool must pass the same checks.", where: at(REGISTER_FILES.burn_receipts, "register_pool and replace_pool") },
    { id: "mint", title: "Supply", text: "Neither program keeps the power to mint after a coin is created. Pair coins lose their mint authority inside init_pair, and they never have a freeze authority. The only token instruction either program runs on a coin is Burn.", where: `${REGISTER_FILES.burn_receipts} and ${REGISTER_FILES.pair_curve}, under non_powers` },
    { id: "lp", title: "Liquidity", text: "The liquidity pool tokens (LP) are locked forever at graduation. LaunchLab coins lock 100% when they move to their pool, under the platform config. Pair coins lock 100% through the pair program's lock_lp. Both use Raydium's LP lock, which can never be withdrawn. The Fee Key is held by an account that the burn program controls. Anyone can call claim_lock_fees. It pays 80% of the SOL-side fees to the coin's burn pool and 20% to the operator treasury, and those shares are fixed in the code. The coin side of the fees is burned.", where: `${at(REGISTER_FILES.burn_receipts, "claim_lock_fees")}; ${at(REGISTER_FILES.pair_curve, "lock_lp")}; src/lib/burnticker/lockFees.ts` },
    { id: "pair-params", title: "A pair's terms", text: "The curve settings, the combined raise that graduates the pair, the minimum share, the deadline, the fee and who receives the fee are all fixed when the pair is created (init_pair). The pair program has no admin at all.", where: at(REGISTER_FILES.pair_curve, "non_powers") },
    { id: "metadata", title: "Coin metadata", text: t.trustPack?.metadataUri?.text ?? "The metadata is hosted on our server for now.", where: at(TRANSPARENCY_FILE, "trustPack.metadataUri"), status: t.trustPack?.metadataUri?.status ?? "server-hosted" },
  ];

  const notDone: CheckItem[] = [
    { id: "one-attester", title: "One signer for readings at launch", text: "The operator's keeper key is the only signer, so one signature is enough. The program checks the signatures and the quorum. It does not check whether the reading is true. Adding a second, independent signer is still an open decision for the owner, both who and when.", where: at(TRANSPARENCY_FILE, "limitations.quorum-1"), status: "not done" },
    { id: "upgrade-authority", title: "The programs can still be upgraded", text: `A Squads vault that needs 2 of 3 signers can still upgrade both programs. On devnet the vault is ${dev.squads.vault}, with a 60-second time lock. On mainnet the time lock is 0 during launch week, and 48 hours is planned from a week or more after the soft launch. The trust page (/burnticker/trust) shows the live value. Removing the upgrade authority for good is the planned last step, and it is not done.`, where: at(REGISTER_FILES.burn_receipts, "upgrade_authority"), status: "not done" },
    { id: "no-firm-review", title: "No professional security firm has reviewed the code", text: t.howBuilt.firmAuditStatement, where: at(TRANSPARENCY_FILE, "howBuilt"), status: "not done" },
    { id: "third-signer", title: "The third key adds no independent approval yet", text: "Member C is a person outside the operator who holds the third key and is not named publicly. The owner holds members A and B, two of the three keys. So today the owner alone meets the 2-of-3 threshold.", where: at(OPERATOR_FILE, "clusters.mainnet.wallets[squads-member-3]"), status: "not done" },
    { id: "bounty-wallet", title: "Bounty wallet", text: "The bounty wallet was funded with 5 SOL on 2026-10-11. It is HATDNP3MsmsxGcbKKjnoXXPBb46aLaMTdzLG3TfHJv2u, a mainnet wallet held by the operator, separate from the Squads vault. The owner's statement matches the chain, and the funding transaction is recorded in docs/burnkeeper/evidence/bounty-2026-10-11/funding.json. Top-ups come from the developer fee. The trust page reads the live balance from a mainnet RPC. The exact severity tiers in SECURITY.md are still open.", where: "config/public-repo/overlay/SECURITY.md", status: "funded 2026-10-11, tiers open" },
    { id: "entity", title: "Legal entity", text: op.operator.entityPending, where: at(OPERATOR_FILE, "operator.entity"), status: "not done" },
    { id: "verified-build", title: "Docker verified build", text: build.kindNote, where: VERIFIED_BUILD_FILE, status: build.kind === "docker" ? "done" : "interim" },
  ];
  const seen = new Set(notDone.map((n) => n.id));
  for (const l of t.limitations) {
    if (!/^(not|interim|devnet only)/i.test(l.status) || ["third-signer", "bounty-wallet", "entity", "verified-build-interim", "quorum-1"].includes(l.id) || seen.has(l.id)) continue;
    notDone.push({ id: l.id, title: l.id.replace(/-/g, " ").replace(/^./, (x) => x.toUpperCase()), text: l.text, where: at(TRANSPARENCY_FILE, `limitations.${l.id}`), status: l.status });
  }
  for (const r of t.rehearsals) if (/^not/i.test(r.status)) notDone.push({ id: `rehearsal-${r.symbol.toLowerCase()}`, title: `Mainnet rehearsal coin $${r.symbol}`, text: r.text, where: at(TRANSPARENCY_FILE, "rehearsals"), status: r.status });

  return {
    schema: "burnticker.check/v1",
    generatedFrom: [REGISTER_FILES.burn_receipts, REGISTER_FILES.pair_curve, TRANSPARENCY_FILE, VERIFIED_BUILD_FILE, OPERATOR_FILE],
    programs: (["burn_receipts", "pair_curve"] as ProgramName[]).map((n) => ({ name: n, programId: regs[n].program.address_in_idl, idlSha256: regs[n].program.idl_sha256, register: REGISTER_FILES[n], privileged: regs[n].privileged_powers.length, overFunds: "none" as const })),
    money, moneySource: moneySourceLine(money, build), nonPowers: (["burn_receipts", "pair_curve"] as ProgramName[]).flatMap((n) => regs[n].non_powers.map((text) => ({ program: n, text }))),
    powers, upgradeAuthority: (["burn_receipts", "pair_curve"] as ProgramName[]).map((n) => ({ program: n, holder: regs[n].upgrade_authority.holder_at_launch, sunset: regs[n].upgrade_authority.sunset })),
    external: (["burn_receipts", "pair_curve"] as ProgramName[]).flatMap((n) => regs[n].external_powers.map((e) => ({ program: n, power: e.power, holder: e.holder, effect: splitReviewRefs(e.effect ?? e.can ?? "").text }))),
    locked, notDone, build,
  };
}

/** docs/burnticker/CHECK-THIS-YOURSELF.md, rendered from the checklist (scripts/burnticker-trustpack.mts check-doc --write). */
export function checklistMarkdown(c: Checklist): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const L: string[] = [];
  L.push("# Check this yourself", "", "This is a skeptic's checklist, written against ourselves.", "");
  L.push(`This file is GENERATED by \`node --import ./test/alias-hook.mjs scripts/burnticker-trustpack.mts check-doc --write\` from ${c.generatedFrom.map((f) => `\`${f}\``).join(", ")}. Do not edit it by hand. The page \`/burnticker/check\` and \`GET /api/burnticker/v1/check\` show the same data.`, "");
  L.push("Nothing here asks you to take our word. Every line names the file or the account that says it. The page also has a receipt verifier that runs in your browser. It fetches the transaction and the program's accounts from the public Solana RPC, and the source values from the Treasury API. Then it works out the units and the spend again.", "");
  L.push("## 1. Where money can go", "", "This table lists every instruction of both programs and the only place each one can move SOL or tokens. Neither program has an instruction to withdraw, sweep or send funds out.", "", c.moneySource, "");
  L.push("| Program | Instruction | Who signs | Where money can go | The register's words |", "|---|---|---|---|---|");
  for (const m of c.money) L.push(`| ${m.program} | \`${m.instruction}\` | ${esc(m.signers)} | **${esc(m.outflow)}** | ${esc(m.funds)} |`);
  L.push("", "What does not exist, in the registers' own words:", "");
  for (const n of c.nonPowers) L.push(`- (${n.program}) ${n.text}`);
  const progName: Record<ProgramName, string> = { burn_receipts: "The burn program (`burn_receipts`)", pair_curve: "The pair program (`pair_curve`)" };
  L.push("", "## 2. Who can do what", "", `Neither program has **any** power over funds. ${c.programs.map((p) => p.privileged === 0 ? `${progName[p.name]} has no privileged instructions.` : `${progName[p.name]} has ${p.privileged} privileged instruction${p.privileged === 1 ? "" : "s"}, and its register says "None." for the funds of every one.`).join(" ")}`, "");
  L.push("| Program | Instruction | Holder | What it can do | Time lock | Note |", "|---|---|---|---|---|---|");
  for (const p of c.powers) L.push(`| ${p.program} | \`${p.instruction}\` | ${esc(p.holder)} | ${esc(p.can)} | ${esc(p.timelock ?? "—")} | ${esc(p.note ?? "")} |`);
  L.push("", "The upgrade authority sits outside the programs' instructions. It is the one power above everything else.", "");
  for (const u of c.upgradeAuthority) L.push(`- ${u.program}: ${u.holder} Sunset: ${u.sunset}`);
  L.push("", "Powers outside the programs that they depend on:", "");
  for (const e of c.external) L.push(`- (${e.program}) **${e.power}**. Holder: ${e.holder}. ${e.effect}`);
  L.push("", "## 3. What is locked", "");
  for (const l of c.locked) L.push(`- **${l.title}**${l.status ? ` (${l.status})` : ""}. ${l.text} *Where:* ${l.where}`);
  L.push("", "## 4. What is not done yet", "");
  for (const n of c.notDone) L.push(`- **${n.title}** (${n.status ?? "not done"}). ${n.text} *Where:* ${n.where}`);
  L.push("", "## 5. Is the deployed code this code?", "", `The build kind is **${c.build.kind}**. ${c.build.kindNote}`, "");
  // audit R05: one row per program and network; the deployed bytes, their read date and evidence are that network's own
  L.push("| Program | Network | Features | Executable hash (this repository) | Deployed bytes on that network | Read | Evidence |", "|---|---|---|---|---|---|---|");
  for (const p of c.build.programs) for (const v of ["mainnet", "devnet"] as const) { const d = p.deployed[v]; L.push(`| ${p.library} | ${v} | ${p.builds[v].features.join(", ") || "default"} | \`${p.builds[v].hash}\` | ${d ? `\`${d.hash}\` ${d.matchesBuild ? "same as the build" : "differs from the build"}` : "none recorded"} | ${d?.readAt ?? "—"} | ${d?.evidence ?? "—"} |`); }
  L.push("", "The steps to reproduce the build are in docs/burnticker/VERIFIED-BUILD.md.", "");
  L.push("## 6. Verify a receipt", "", "On the page, paste a receipt's transaction signature, or pick a devnet receipt. Each check shows ✓ when it passed, ✗ when it failed, or – when the page cannot run it, with the reason. These are the checks:", "",
    "- The transaction exists and succeeded.", "- It ran the pinned program's `crank_buyback`.", "- The memo can be read.", "- The Reading account, which the program owns, agrees with the memo.", "- The TokenConfig belongs to that Reading.",
    "- The published rules file hashes to the rules hash on chain.", "- The Reading's `source_url_hash` is the sha256 of the Treasury URL for that date, and the Treasury API gives the same two values.", "- The units come out the same when worked out again.",
    "- The spend comes out the same in the program's fixed-point arithmetic.", "- The transaction's Burn instructions burned exactly what the swap bought.", "");
  L.push("You can also check without the page. `curl -s https://burnticker.com/api/burnticker/v1/check/receipts` lists the devnet receipts. `curl -s https://burnticker.com/api/burnticker/v1/check/receipts/<signature>` runs the same checks on our server, with the same code (src/lib/burnticker/trustpack/receiptCheck.ts).", "");
  return L.join("\n");
}
