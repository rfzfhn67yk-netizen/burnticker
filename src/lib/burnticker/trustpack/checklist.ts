import fs from "node:fs";
import path from "node:path";
import { loadTransparency, TRANSPARENCY_FILE } from "@/lib/burnticker/trust";
import { loadVerifiedBuild, VERIFIED_BUILD_FILE, type VerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
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
  rent: "rent only (the caller pays it)",
  intoPool: "fees into the burn pool",
  swapBurn: "burn pool SOL → swap → every token received is burned",
  burn: "vault tokens → burned",
  trade: "the trader's own funds, at the formula (pro rata after a void); fees stay in the pair's vault",
  graduate: "curve SOL → the Raydium pool (its LP then locked forever by lock_lp); leftover tokens burned; the side's escrowed fees and residue → its burn pool",
  close: "voided pairs only: residue → burn pools; account rent → the creator who paid it",
  devClaim: "the accrued 25 bps → the developer wallet fixed at init",
  lockFees: "the locked LP's fees → 80 % to the burn pool, 20 % to the operator treasury (compiled); the coin side burned",
  lock: "the pool's LP → Raydium's lock, forever (the Fee Key held by burn_receipts)",
  lpBurnFallback: "fallback only, if lock_lp cannot run for 30 days: burn_lp destroys the side's LP (no LP fees then)",
} as const;
export type OutflowClass = keyof typeof OUTFLOW;

/** Every instruction's class. A new instruction must be added here (the test fails on any instruction missing from this table). */
export const OUTFLOW_BY_INSTRUCTION: Record<ProgramName, Record<string, OutflowClass>> = {
  burn_receipts: {
    apply_attester_change: "none", apply_cap_raise: "none", apply_registration_policy: "none", cancel_attester_change: "none", cancel_cap_raise: "none",
    cancel_registration_policy: "none", check_pool_health: "none", claim_launchlab_creator_fee: "intoPool", claim_lock_fees: "lockFees", clear_cranker_allowlist: "none",
    crank_buyback: "swapBurn", crank_no_units: "none", crank_vault: "burn", initialize_platform: "rent", initialize_token: "rent", propose_attesters: "none",
    propose_cap_raise: "none", register_fee_key: "rent", register_pair_pool: "none", register_pool: "none", renounce_admin: "none", renounce_platform_authority: "none", replace_pool: "none",
    set_registration_policy: "none", submit_reading: "rent", veto_registration_policy: "none",
  },
  pair_curve: { buy: "trade", sell: "trade", graduate: "graduate", close_pair: "close", init_pair: "rent", void_pair: "none", claim_developer_fee: "devClaim", lock_lp: "lock", burn_lp: "lpBurnFallback" },
};

export interface MoneyRow { program: ProgramName; instruction: string; class: string; signers: string; outflow: string; outflowClass: OutflowClass; funds: string }
export interface PowerRow { program: ProgramName; instruction: string; holder: string; can: string; timelock: string | null; funds: string }
export interface CheckItem { id: string; title: string; text: string; where: string; status?: string }
export interface Checklist {
  schema: "burnticker.check/v1"; generatedFrom: string[];
  programs: { name: ProgramName; programId: string; idlSha256: string; register: string; privileged: number; overFunds: "none" }[];
  money: MoneyRow[]; nonPowers: { program: ProgramName; text: string }[];
  powers: PowerRow[]; upgradeAuthority: { program: ProgramName; holder: string; sunset: string }[]; external: { program: ProgramName; power: string; holder: string; effect: string }[];
  locked: CheckItem[]; notDone: CheckItem[];
  build: VerifiedBuild;
}

export function loadRegister(root: string, p: ProgramName): Register {
  return JSON.parse(fs.readFileSync(path.join(root, REGISTER_FILES[p]), "utf8")) as Register;
}

export function buildChecklist(root = process.cwd()): Checklist {
  const regs = { burn_receipts: loadRegister(root, "burn_receipts"), pair_curve: loadRegister(root, "pair_curve") };
  const t = loadTransparency(root);
  const op = loadOperator(root);
  const build = loadVerifiedBuild(root);
  const money: MoneyRow[] = [], powers: PowerRow[] = [];
  for (const name of ["burn_receipts", "pair_curve"] as ProgramName[]) {
    for (const ix of regs[name].instructions) {
      const cls = OUTFLOW_BY_INSTRUCTION[name][ix.name];
      if (!cls) throw new Error(`${REGISTER_FILES[name]}: instruction ${ix.name} has no outflow class in checklist.ts OUTFLOW_BY_INSTRUCTION`);
      money.push({ program: name, instruction: ix.name, class: ix.class, signers: ix.signers.map((s) => s.role).join(" + "), outflow: OUTFLOW[cls], outflowClass: cls, funds: ix.funds ?? "None." });
      if (ix.class === "privileged") powers.push({ program: name, instruction: ix.name, holder: ix.signers.map((s) => s.role).join(" + "), can: ix.can, timelock: ix.timelock, funds: ix.funds });
    }
  }
  const overFunds = powers.filter((p) => !/^None\.?$/.test(p.funds.trim()));
  if (overFunds.length) throw new Error(`a privileged instruction moves funds: ${overFunds.map((p) => p.instruction).join(", ")} — the page cannot say "none over funds"`);
  if (regs.pair_curve.powers_over_funds !== "none") throw new Error("pair_curve register no longer says powers_over_funds = none");

  const dev = op.clusters.devnet;
  const locked: CheckItem[] = [
    { id: "rule", title: "Each coin's rule", text: "The burn rule, the feed, the memo text and the rules-file hash are written once at initialize_token; no instruction updates them. A different rule is a different coin. The rules file's sha256 is on chain (TokenConfig.rules_sha256) and in every memo.", where: `${REGISTER_FILES.burn_receipts} → non_powers` },
    { id: "readings", title: "Readings and receipts", text: "Readings are append-only and quorum-checked on chain; no instruction edits or deletes one. Off chain, the registry refuses updates and deletes with SQL triggers.", where: `${REGISTER_FILES.burn_receipts} → submit_reading` },
    { id: "pools", title: "Where a burn pool can trade", text: "The pool is registered once (provenance-checked) and frozen; replacing a dead pool needs 7 days of continuous recorded untradeability and the same checks.", where: `${REGISTER_FILES.burn_receipts} → register_pool, replace_pool` },
    { id: "mint", title: "Supply", text: "Neither program holds a mint authority after creation; pair coins have their mint authority revoked inside init_pair and no freeze authority ever. The only token instruction either program runs on a coin is Burn.", where: `${REGISTER_FILES.burn_receipts}, ${REGISTER_FILES.pair_curve} → non_powers` },
    { id: "lp", title: "Liquidity", text: "LP is locked forever at graduation: 100% on LaunchLab migrations under the platform config and 100% through pair_curve's lock_lp, with Raydium's LP lock (never withdrawable). The Fee Key is owned by the burn_receipts fee-keys PDA; the permissionless claim_lock_fees pays 80% of the SOL-side fees to the coin's burn pool and 20% to the operator treasury, compiled constants; the coin side is burned.", where: `${REGISTER_FILES.burn_receipts} → claim_lock_fees; ${REGISTER_FILES.pair_curve} → lock_lp; src/lib/burnticker/lockFees.ts` },
    { id: "pair-params", title: "A pair's terms", text: "Curve parameters, the combined raise that graduates the pair, the minimum share, the deadline, the fee and the fee recipients are fixed at init_pair; pair_curve has no admin field at all.", where: `${REGISTER_FILES.pair_curve} → non_powers` },
    { id: "metadata", title: "Coin metadata", text: t.trustPack?.metadataUri?.text ?? "Server-hosted until then.", where: `${TRANSPARENCY_FILE} → trustPack.metadataUri`, status: t.trustPack?.metadataUri?.status ?? "server-hosted" },
  ];

  const notDone: CheckItem[] = [
    { id: "one-attester", title: "One attester at launch", text: "Quorum 1: the operator's keeper key is the only attester. The program checks signatures and the quorum, not the reading; a second, independent attester is an open owner decision (who and when).", where: `${TRANSPARENCY_FILE} → limitations.quorum-1`, status: "not done" },
    { id: "upgrade-authority", title: "Upgrade authority held by Squads until finalisation", text: `Both programs can still be upgraded by the 2-of-3 Squads vault (devnet: ${dev.squads.vault}, 60 s time lock; mainnet: 48 h). Finalising (setting it to none) is the planned last step, not done.`, where: `${REGISTER_FILES.burn_receipts} → upgrade_authority`, status: "not done" },
    { id: "no-firm-review", title: "No professional security firm has reviewed the code", text: t.howBuilt.firmAuditStatement, where: `${TRANSPARENCY_FILE} → howBuilt`, status: "not done" },
    { id: "third-signer", title: "Third Squads signer", text: "The trusted third party who holds the third key is not named yet (name and address TODO).", where: `${OPERATOR_FILE} → clusters.mainnet.wallets[squads-member-3]`, status: "not done" },
    { id: "bounty-wallet", title: "Bounty wallet", text: "Not created yet (TODO_BOUNTY_WALLET): the mainnet Squads vault, funded with 5–10 SOL from the developer fee.", where: "config/public-repo/overlay/SECURITY.md", status: "not done" },
    { id: "entity", title: "Legal entity", text: op.operator.entityPending, where: `${OPERATOR_FILE} → operator.entity`, status: "not done" },
    { id: "verified-build", title: "Docker verified build", text: build.kindNote, where: VERIFIED_BUILD_FILE, status: build.kind === "docker" ? "done" : "interim" },
  ];
  const seen = new Set(notDone.map((n) => n.id));
  for (const l of t.limitations) {
    if (!/^(not|interim|devnet only)/i.test(l.status) || ["third-signer", "bounty-wallet", "entity", "verified-build-interim", "quorum-1"].includes(l.id) || seen.has(l.id)) continue;
    notDone.push({ id: l.id, title: l.id.replace(/-/g, " "), text: l.text, where: `${TRANSPARENCY_FILE} → limitations.${l.id}`, status: l.status });
  }
  for (const r of t.rehearsals) if (/^not/i.test(r.status)) notDone.push({ id: `rehearsal-${r.symbol.toLowerCase()}`, title: `Mainnet rehearsal coin $${r.symbol}`, text: r.text, where: `${TRANSPARENCY_FILE} → rehearsals`, status: r.status });

  return {
    schema: "burnticker.check/v1",
    generatedFrom: [REGISTER_FILES.burn_receipts, REGISTER_FILES.pair_curve, TRANSPARENCY_FILE, VERIFIED_BUILD_FILE, OPERATOR_FILE],
    programs: (["burn_receipts", "pair_curve"] as ProgramName[]).map((n) => ({ name: n, programId: regs[n].program.address_in_idl, idlSha256: regs[n].program.idl_sha256, register: REGISTER_FILES[n], privileged: regs[n].privileged_powers.length, overFunds: "none" as const })),
    money, nonPowers: (["burn_receipts", "pair_curve"] as ProgramName[]).flatMap((n) => regs[n].non_powers.map((text) => ({ program: n, text }))),
    powers, upgradeAuthority: (["burn_receipts", "pair_curve"] as ProgramName[]).map((n) => ({ program: n, holder: regs[n].upgrade_authority.holder_at_launch, sunset: regs[n].upgrade_authority.sunset })),
    external: (["burn_receipts", "pair_curve"] as ProgramName[]).flatMap((n) => regs[n].external_powers.map((e) => ({ program: n, power: e.power, holder: e.holder, effect: e.effect ?? e.can ?? "" }))),
    locked, notDone, build,
  };
}

/** docs/burnticker/CHECK-THIS-YOURSELF.md, rendered from the checklist (scripts/burnticker-trustpack.mts check-doc --write). */
export function checklistMarkdown(c: Checklist): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const L: string[] = [];
  L.push("# Check this yourself — the sceptic's checklist against ourselves", "");
  L.push(`GENERATED by \`node --import ./test/alias-hook.mjs scripts/burnticker-trustpack.mts check-doc --write\` from ${c.generatedFrom.map((f) => `\`${f}\``).join(", ")} — do not edit by hand. The same object is the page \`/burnticker/check\` and \`GET /api/burnticker/v1/check\`.`, "");
  L.push("Nothing here asks you to take our word: every line names the file or the account that says it. The page adds a receipt verifier that runs in your browser (it fetches the transaction and the program's accounts from the public Solana RPC and the source values from the Treasury API, then recomputes units and spend).", "");
  L.push("## 1. Where money can go", "", "Every instruction of both programs and the only place it can move SOL or tokens. There is no withdraw, sweep or transfer-out instruction in either program.", "");
  L.push("| Program | Instruction | Who signs | Outflow | The register's words |", "|---|---|---|---|---|");
  for (const m of c.money) L.push(`| ${m.program} | \`${m.instruction}\` | ${esc(m.signers)} | **${esc(m.outflow)}** | ${esc(m.funds)} |`);
  L.push("", "What does not exist (the registers' own list):", "");
  for (const n of c.nonPowers) L.push(`- (${n.program}) ${n.text}`);
  L.push("", "## 2. Who can do what", "", `Powers over funds: **none** in either program (${c.programs.map((p) => `${p.name}: ${p.privileged} privileged instruction(s), every one with Funds "None."`).join("; ")}).`, "");
  L.push("| Program | Instruction | Holder | Can | Timelock |", "|---|---|---|---|---|");
  for (const p of c.powers) L.push(`| ${p.program} | \`${p.instruction}\` | ${esc(p.holder)} | ${esc(p.can)} | ${esc(p.timelock ?? "—")} |`);
  L.push("", "Upgrade authority (outside the programs' interfaces — the one power above everything else):", "");
  for (const u of c.upgradeAuthority) L.push(`- ${u.program}: ${u.holder} Sunset: ${u.sunset}`);
  L.push("", "Powers outside the programs that they depend on:", "");
  for (const e of c.external) L.push(`- (${e.program}) **${e.power}** — holder: ${e.holder}. ${e.effect}`);
  L.push("", "## 3. What is locked", "");
  for (const l of c.locked) L.push(`- **${l.title}**${l.status ? ` (${l.status})` : ""} — ${l.text} *Where:* ${l.where}`);
  L.push("", "## 4. What is not done yet", "");
  for (const n of c.notDone) L.push(`- **${n.title}** (${n.status ?? "not done"}) — ${n.text} *Where:* ${n.where}`);
  L.push("", "## 5. Is the deployed code this code?", "", `Kind: **${c.build.kind}**. ${c.build.kindNote}`, "");
  L.push("| Program | Build | Features | Executable hash | Deployed (devnet) |", "|---|---|---|---|---|");
  for (const p of c.build.programs) for (const v of ["mainnet", "devnet"] as const) L.push(`| ${p.library} | ${v} | ${p.builds[v].features.join(", ") || "default"} | \`${p.builds[v].hash}\` | ${v === "devnet" && p.deployed.devnet ? `\`${p.deployed.devnet.hash}\` ${p.deployed.devnet.matchesBuild ? "= build" : "≠ build"}` : "—"} |`);
  L.push("", "How to reproduce: docs/burnticker/VERIFIED-BUILD.md.", "");
  L.push("## 6. Verify a receipt", "", "On the page: paste a receipt's transaction signature (or pick a devnet receipt). The checks, each ✓ / ✗ / – (not checkable here, with the reason): the transaction exists and succeeded; it ran the pinned program's `crank_buyback`; the memo parses; the program-owned Reading account agrees with the memo; the TokenConfig is the Reading's own; the published rules file hashes to the on-chain rules hash; the Reading's `source_url_hash` is sha256 of the Treasury URL for that date and the Treasury API gives the same two values; the units recompute; the spend recomputes in the program's fixed point; the transaction's Burn instructions burned exactly what the swap bought.", "");
  L.push("Without the page: `curl -s https://burnticker.com/api/burnticker/v1/check/receipts` lists the devnet receipts; `curl -s https://burnticker.com/api/burnticker/v1/check/receipts/<signature>` runs the same checks on our server (the same code, src/lib/burnticker/trustpack/receiptCheck.ts).", "");
  return L.join("\n");
}
