#!/usr/bin/env node
// THE POWERS REGISTER — every power anyone holds over a burn_receipts token, generated from the program's IDL so the site can render
// it and so it cannot silently drift from the code.
//
//   node programs/burn-receipts/scripts/powers-register.mjs           # writes docs/burn-receipts/powers-register.{json,md}
//   node programs/burn-receipts/scripts/powers-register.mjs --check   # exits 1 if the committed files are stale or the IDL
//                                                                     # has an instruction / signer this register does not describe
//
// Source of truth: src/lib/burnReceipts/idl.ts (the committed copy of `anchor build`'s IDL). The human statements below are keyed by
// instruction name and by signer account; the generator FAILS if the IDL has an instruction or a signer account that is not described
// here, or if this file describes one the IDL does not have. Output is deterministic (no timestamps).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "..", "..", "..");
const idlTs = path.join(repo, "src", "lib", "burnReceipts", "idl.ts");
const outDir = path.join(repo, "docs", "burn-receipts");
const idlText = fs.readFileSync(idlTs, "utf8");
const idl = JSON.parse(idlText.slice(idlText.indexOf("= {") + 2, idlText.lastIndexOf("};") + 1));

const ROLES = {
  anyone: "Anyone with a funded wallet. Pays only the transaction fee (and rent where noted); chooses no amounts.",
  mint_keypair: "The holder of the new mint's keypair — the launchpad, inside the token's create flow. Usable exactly once per mint.",
  creator: "The creator wallet recorded at init. Holds no power by itself; it is the initial config authority.",
  config_authority: "TokenConfig.admin — initially the creator; can be renounced forever (renounce_admin). Powers: attester set only.",
  attesters: "The quorum (N of M) of attester ed25519 keys named in the TokenConfig — kind-tagged operator / zktls-relayer / oracle (informational). Each signs (feed, period, value, sha256 of the source URL, zkTLS proof locator); the program verifies only signatures and the quorum.",
  upgrade_authority: "The program's upgrade authority (BPF Upgradeable Loader). At launch: the Squads 2-of-3 vault with a 48 h time lock; set to none after the audit.",
  platform_authority: "PlatformConfig.authority — intended: the Squads 2-of-3 vault. Power: RAISE the temporary burn-pool cap (48 h timelock). Renounceable; the cap sunsets by itself.",
  attester_key: "Any ONE key of the token's CURRENT attester set, signing a transaction by itself (no quorum). Power: veto (clear) a pending registration-policy proposal — nothing else (re-check R3-2).",
  platform_authority_or_listed_cranker: "PlatformConfig.authority (while not renounced) OR any key on the PlatformConfig's cranker allowlist (re-check R3-4). Power: clear the allowlist (back to permissionless) — never add a key.",
};

const POWERS = {
  initialize_token: {
    class: "creation",
    signers: { payer: "anyone", creator: "creator", mint: "mint_keypair" },
    can: "Create the ONE TokenConfig of a mint: the burn rule (immutable thereafter), the feed id, the memo text, the rules-file hash, the attester set and quorum; fund the fee PDA with the rule's reserve; for buyback policy 0, read and PIN the LaunchLab platform (its cpConfigId; platformCpCreator must be unset or the fee PDA; LP lock+burn scales ≥ 50 %).",
    cannot: "Run twice for a mint; be run by anyone without the mint keypair; change anything afterwards.",
    timelock: null, sunset: "Single use per mint.", funds: "Payer → fee PDA: the reserve only (rent for the PDA).",
  },
  register_pool: {
    class: "permissionless",
    signers: { registrar: "anyone" },
    can: "Record the Raydium CPMM pool the buyback trades on (pool policy 0) — only LaunchLab's migration pool: the token's LaunchLab pool records the fee PDA as creator, CPMM migration and the platform PINNED at init, the pool is the PDA of the PINNED cpConfigId and the two mints, its pool_creator is the fee PDA, and ≥ 50 % of its live LP is burned or held by Raydium's LP lock. Policy 1: verify the fixed pool (fee-PDA creator, ≥ 50 % LP burned/locked) before any buyback.",
    cannot: "Register any other pool (another AmmConfig, a random-keypair pool, a pool whose LP its creator can withdraw); register twice; change a registered pool.",
    timelock: null, sunset: "Once per token (then frozen).", funds: "None.",
  },
  register_pair_pool: {
    class: "permissionless",
    signers: { registrar: "anyone" },
    can: "Registration policy 2 (2026-10-10, rivalry pairs): record the CPMM pool that the pair_curve program's graduate created for this token — the Pair account is pair_curve's (hard-coded id, discriminator, PDA [\"pair\", mint_a, mint_b]), Graduated (or Graduating with this side done) and names this mint; the pool is the one the Pair records for that side AND the pair_curve PDA [\"pool\", pair, [side]] (only pair_curve can sign for it), on the cpConfigId pinned at initialize_token, with the pair's SOL vault PDA as pool_creator; ≥ 90 % of the LP that existed at creation was burned (Pair record, confirmed by CPMM lp_supply − LP mint supply).",
    cannot: "Register a pool for a policy-0/1 token, a pool from another pair or side, a pool at any other address, on another AmmConfig or with an unburned LP; register twice; change a registered pool. Later LP deposits cannot block it (the ratio is against the creation supply).",
    timelock: null, sunset: "Once per token (then frozen).", funds: "None.",
  },
  check_pool_health: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Record an observation of the registered pool being untradeable (swaps disabled, pool account gone, or < 0.01 SOL WSOL reserve) — a spell starts on the second of two observations ≥ 1 h apart and is continuous only while observations are ≤ 24 h apart — or clear the record when it is tradeable again.",
    cannot: "Change the pool; move funds; backdate the record; run inside another program's instruction (CPI — it must be top-level, stack height 1); run in a transaction with any other instruction touching the pool (a CPMM instruction, or one listing the pool, either vault or its observation account). Residual: a Jito bundle of separate transactions is invisible to it (README \"Pool health\").",
    timelock: null, sunset: "None.", funds: "None.",
  },
  replace_pool: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "After ≥ 7 days of CONTINUOUS recorded untradeability (observations ≤ 24 h apart; the old pool still untradeable), register a DIFFERENT tradeable pool that passes every register_pool check for the LaunchLab platform's current cpConfigId.",
    cannot: "Pick a pool that fails register_pool's provenance checks; act before 7 continuous days; replace a pool that has been shown tradeable since; act on a fixed-pool (policy 1) token; run under CPI or beside an instruction touching either pool, its vaults or its observation account.",
    timelock: "7 days of continuous recorded untradeability (POOL_REPLACEMENT_DELAY_SECS).", sunset: "None.", funds: "None.",
  },
  claim_launchlab_creator_fee: {
    class: "permissionless",
    signers: { payer: "anyone" },
    can: "CPI LaunchLab claim_creator_fee with the fee PDA (the LaunchLab creator) signing, the recipient pinned to the fee PDA's own WSOL account; adds the curve creator fee to the burn pool.",
    cannot: "Send the fee anywhere else; take lamports from the fee PDA, WSOL from its WSOL account or tokens from its token account; change the fee PDA's owner/data or its token accounts' owner, mint, delegate or close authority (all re-checked after the CPI, hard errors); pass any extra account; target any program but LaunchLab.",
    timelock: null, sunset: "None.", funds: "LaunchLab creator vault (fee PDA, WSOL) → the fee PDA's WSOL account.",
  },
  submit_reading: {
    class: "permissionless",
    signers: { payer: "anyone" },
    gated_by: "attesters",
    can: "Append a reading (record_date, value, source_url_hash, proof_hash) — valid only with a quorum (≤ 3) of attester signatures over cluster genesis ‖ program id ‖ mint ‖ feed ‖ previous date ‖ those fields; computes units with the carry rule; an out-of-bound reading is recorded as a 0-unit RESET (new baseline).",
    cannot: "Edit, delete or replace a written reading; insert a date at or before the last one; reuse a signature made for another cluster, token, deployment or previous reading; post a future date.",
    timelock: null, sunset: "None (the rule is a promise).", funds: "Payer pays the reading account's rent (kept forever; readings are never closed).",
  },
  crank_buyback: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "Process the next reading in line (buyback mode): target = pool × (1 − (1 − f)^units) + carried spend; spend at most 2 % of the pool's WSOL reserve (rest carried); swap on the registered, provenance-checked CPMM pool behind a mandatory TWAP guard (≤ 3 % over 600–1,200 s) with a minimum output of max(spot quote, TWAP quote) less ≤ 3 % slippage; burn EVERY token the fee PDA holds; write memo v2. After 30 days of continuous pool untradeability, process the reading below-floor with its target carried.",
    cannot: "Choose the amount, the pool, the price or the recipient; skip a reading; process one twice; send SOL or tokens anywhere except the pool (SOL→token) and the burn; let the CPMM call change the fee PDA's or its token accounts' owner, delegate or close authority (hard error); crank while the pre-audit cap is in force if a PlatformConfig cranker allowlist exists and the cranker is not on it.",
    timelock: null, sunset: "None.", funds: "Fee PDA SOL → its WSOL account → CPMM pool vault; tokens received → burned (supply reduced).",
  },
  crank_vault: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "Process the next reading in line (vault mode): burn units × tokens_per_unit (+ carried shortfall, capped by the allocation) from the program-owned vault; record the public shortfall; write memo v1.",
    cannot: "Choose the amount; transfer vault tokens anywhere; skip or repeat a reading.",
    timelock: null, sunset: "Ends when the vault allocation is used up.", funds: "Vault tokens → burned.",
  },
  crank_no_units: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "Mark the next-in-line reading with zero units as processed (keeps the queue moving).",
    cannot: "Touch a reading with units; move any funds.",
    timelock: null, sunset: "None.", funds: "None.",
  },
  propose_attesters: {
    class: "privileged",
    signers: { admin: "config_authority" },
    can: "Propose a new attester set and quorum (add, rotate or remove attesters; quorum ≤ 3).",
    cannot: "Lower the quorum; leave fewer attesters than the quorum; keep fewer than `quorum` current keys or add as many new keys as the new quorum (new keys alone can never sign); add keys unless ≥ `quorum` kept keys have been in the set ≥ 7 days; take effect before 48 hours; touch the rule, readings, fee PDA, vault or pool.",
    timelock: "48 hours (ATTESTER_TIMELOCK_SECS = 172,800), public: emits AttesterChangeProposed with the added and removed entries.",
    sunset: "Gone once renounce_admin runs.", funds: "None.",
  },
  cancel_attester_change: {
    class: "privileged",
    signers: { admin: "config_authority" },
    can: "Withdraw a pending attester proposal.",
    cannot: "Anything else.",
    timelock: null, sunset: "Gone once renounce_admin runs.", funds: "None.",
  },
  renounce_admin: {
    class: "privileged",
    signers: { admin: "config_authority" },
    can: "Give up the config authority forever (and cancel any pending proposal). Irreversible.",
    cannot: "Be undone.",
    timelock: null, sunset: "Single use.", funds: "None.",
  },
  initialize_platform: {
    class: "creation",
    signers: { payer: "anyone", upgrade_authority: "upgrade_authority" },
    can: "Create the ONE PlatformConfig: the platform authority, the burn-pool cap (exactly the 25 SOL default), the cap's sunset time (at most 365 days out and no later than the default sunset, 2027-10-01) and an optional cranker allowlist (≤ 3 keys, applies only while the cap is in force and for at most 90 days).",
    cannot: "Run twice; be run by anyone but the program's upgrade authority; set any cap but the default (it can only be raised afterwards); set a sunset in the past, beyond 365 days or after 2027-10-01; add crankers later.",
    timelock: null, sunset: "Single use.", funds: "Payer pays the PlatformConfig's rent.",
  },
  propose_cap_raise: {
    class: "privileged",
    signers: { authority: "platform_authority" },
    can: "Propose RAISING the burn-pool cap (the rule then spends on min(pool, new cap)).",
    cannot: "Lower the cap or keep it equal; take effect before 48 hours; extend the sunset; touch any token's rule, readings, fee PDA, vault or pool; move funds.",
    timelock: "48 hours (CAP_TIMELOCK_SECS = 172,800), public: emits CapRaiseProposed.",
    sunset: "Pointless after the cap's sunset (the cap no longer applies); gone once renounce_platform_authority runs.", funds: "None.",
    temporary: true,
  },
  cancel_cap_raise: {
    class: "privileged",
    signers: { authority: "platform_authority" },
    can: "Withdraw a pending cap raise.",
    cannot: "Anything else.",
    timelock: null, sunset: "Gone once renounce_platform_authority runs.", funds: "None.",
    temporary: true,
  },
  renounce_platform_authority: {
    class: "privileged",
    signers: { authority: "platform_authority" },
    can: "Give up the platform authority forever (cancels a pending raise). The cap stays as it is until its sunset.",
    cannot: "Be undone.",
    timelock: null, sunset: "Single use.", funds: "None.",
    temporary: true,
  },
  set_registration_policy: {
    class: "privileged",
    signers: { admin: "config_authority" },
    can: "STRANDING RECOVERY: propose switching the token's registration policy — to a fixed pool that must pass register_pool's creator + LP checks AND (re-check R3-2) have ≥ 90 % of its live LP burned/locked or be the pool PDA of a LaunchLab-known AmmConfig (the pinned cpConfigId or the pinned platform's current one) when applied, or back to LaunchLab's migration pool (policy 0, needs the pinned platform).",
    cannot: "Act while a pool works (only with no verified pool, or the registered one continuously untradeable ≥ 7 days); act after the pre-audit cap's sunset; pick a pool whose pool_creator is not the fee PDA, whose LP is < 50 % burned/locked, or (< 90 % locked) that sits on an AmmConfig LaunchLab does not name; take effect before 48 hours or after 14 days (the proposal expires); survive a veto by any one current attester; touch the rule, readings, fee PDA or vault.",
    timelock: "48 hours (ATTESTER_TIMELOCK_SECS), public: emits RegistrationPolicyProposed (eta, expires_at = proposal + 14 days); any current attester can veto it (veto_registration_policy).",
    sunset: "The pre-audit cap's sunset (PlatformConfig.cap_sunset_ts, or 2027-10-01 without one); gone once renounce_admin runs.", funds: "None.",
    temporary: true,
  },
  cancel_registration_policy: {
    class: "privileged",
    signers: { admin: "config_authority" },
    can: "Withdraw a pending registration-policy switch.",
    cannot: "Anything else.",
    timelock: null, sunset: "Gone once renounce_admin runs.", funds: "None.",
    temporary: true,
  },
  apply_registration_policy: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Apply a pending registration-policy switch after its 48-hour timelock and before it expires (14 days after the proposal), re-checking the window and (fixed pool) the creator + LP checks and the 90 %-or-LaunchLab-config rule.",
    cannot: "Apply early, after expiry, after the cap sunset, while a pool works, or a pool that fails the checks.",
    timelock: "Executable only after the proposal's ETA.", sunset: "The pre-audit cap's sunset.", funds: "None.",
  },
  veto_registration_policy: {
    class: "privileged",
    signers: { attester: "attester_key" },
    can: "VETO: clear a pending registration-policy proposal (re-check R3-2 — the cheap veto by the parties a pool switch would bypass).",
    cannot: "Propose, apply or change any policy; touch the attester set, readings, rule or funds; act without a pending proposal. (The admin can propose again at once — a fresh, public 48 h.)",
    timelock: null, sunset: "Pointless once the switch window closes (cap sunset) or renounce_admin runs.", funds: "None.",
    temporary: true,
  },
  clear_cranker_allowlist: {
    class: "privileged",
    signers: { caller: "platform_authority_or_listed_cranker" },
    can: "Return crank_buyback to permissionless (clear the PlatformConfig's cranker allowlist). Re-check R3-4: the platform authority OR any allowlisted key may do it, so lost keys plus a renounced authority never pin cranking to the list.",
    cannot: "Add or change crankers; touch the cap, any token or any funds; be done by a key that is neither the authority nor on the list.",
    timelock: null, sunset: "Pointless once the allowlist stops applying (cap sunset or 90 days after initialize_platform, whichever is first).", funds: "None.",
    temporary: true,
  },
  apply_cap_raise: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Apply a pending cap raise after its 48-hour timelock.",
    cannot: "Apply early; apply anything but a raise (re-checked).",
    timelock: "Executable only after the proposal's ETA.", sunset: "None.", funds: "None.",
  },
  apply_attester_change: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Apply a pending attester proposal after its 48-hour timelock.",
    cannot: "Apply early; apply a proposal that lowers the quorum (re-checked).",
    timelock: "Executable only after the proposal's ETA.", sunset: "None.", funds: "None.",
  },
};

const NON_POWERS = [
  "No withdraw, sweep, transfer, close or set-recipient instruction exists for the fee PDA, its token accounts, the vault or any program account. SOL leaves the fee PDA only inside crank_buyback (into its own WSOL account, then into the CPMM pool for tokens that are burned); tokens leave only by burn.",
  "No account is ever closed, so no rent is ever refunded to anyone; it stays where it is.",
  "No pause or freeze exists. Nothing can stop cranks except the rule's own guards (a stale TWAP or a closed pool defers a burn day; it is never lost). The burn-pool cap limits how much of a pool one burn day may spend on; it never stops a burn.",
  "No instruction mints tokens, and none holds a mint authority: the program's only token instructions are Burn (and SyncNative on its own WSOL account). There is no team allocation in the program.",
  "No fee is charged by the program, so there is no fee to change.",
  "No instruction updates the burn rule (RuleParams), the feed id, the memo text, the rules hash, the mint, the creator record or the registered pool.",
  "No instruction edits or deletes a reading; readings are append-only and quorum-checked.",
  "The quorum can never be lowered (nor exceed 3), the attester set can never be smaller than the quorum, and one proposal must keep at least `quorum` of the current keys and add fewer new keys than the new quorum; keys are added only on the strength of kept keys ≥ 7 days old.",
  "No instruction changes the pinned LaunchLab platform / cpConfigId; the registration policy changes only through set_registration_policy (48 h, stranding only, until the cap sunset), which can never select policy 2 (pair curve) — that policy is chosen at initialize_token or not at all.",
  "No PlatformConfig is required: without one, the hard-coded default cap (25 SOL until 2027-10-01) applies, so a lost or finalised upgrade authority cannot wedge buybacks.",
];

const TEMPORARY = [
  {
    power: "Platform burn-pool cap",
    holder: "platform_authority (the Squads 2-of-3 vault)",
    effect: "While in force, each token's buyback spend is computed on min(pool, cap); SOL above the cap stays in the fee PDA and a BurnPoolCapBound event is emitted every time the cap binds.",
    default: "25 SOL (25,000,000,000 lamports)",
    can_change: "Raise only, through propose_cap_raise → 48 h → apply_cap_raise.",
    sunset: "PlatformConfig.cap_sunset_ts — set once at initialize_platform (at most 365 days out and no later than 2027-10-01), never extendable; after it the program ignores the cap. Also ends early in effect if the authority raises it to u64::MAX.",
    why: "A pre-audit limit on how much SOL any single burn day can push through an unaudited program (owner decision, 2026-10-09).",
  },
  {
    power: "Cranker allowlist (review-3 L-4)",
    holder: "set once by the upgrade authority at initialize_platform; clearable (never extendable) by platform_authority or by any listed key",
    effect: "While the cap is in force and the list is non-empty, only listed keys (≤ 3) may crank_buyback — against an outside cranker timing a multi-block TWAP hold. Readings, vault cranks, claims and health checks stay permissionless.",
    default: "Empty (permissionless).",
    can_change: "clear_cranker_allowlist only (back to permissionless), by the platform authority or any listed key.",
    sunset: "PlatformConfig.cap_sunset_ts or PlatformConfig.created_at + 90 days, whichever is first (re-check R3-4); afterwards crank_buyback is permissionless whatever the list says.",
    why: "Against a multi-block TWAP hold timed by an outside cranker while the program is unaudited. If every listed key is lost and the authority renounced, buy-back cranks wait at most 90 days from initialize_platform (no funds move in the meantime).",
  },
  {
    power: "Registration-policy switch — stranding recovery (review-3 M-3)",
    holder: "config_authority (TokenConfig.admin, the Squads vault)",
    effect: "Switch a token whose LaunchLab migration cannot be registered (or whose pool died) to a fixed pool passing the creator + LP checks, or back to policy 0.",
    default: "Unused.",
    can_change: "set_registration_policy → 48 h → apply_registration_policy (anyone) within 14 days of the proposal; cancel_registration_policy (admin); veto_registration_policy (any one current attester). A fallback fixed pool needs ≥ 90 % LP burned/locked or a LaunchLab-known AmmConfig (re-check R3-2).",
    sunset: "The pre-audit cap's sunset (PlatformConfig.cap_sunset_ts, or 2027-10-01 without one); also gone at renounce_admin.",
    why: "LaunchLab is closed source; its platform admin can change cpConfigId / platformCpCreator / lock scales before migration. Real LaunchLab behaviour remains a devnet-rehearsal gate.",
  },
];

const UPGRADE = {
  power: "Program upgrade authority (BPF Upgradeable Loader) — outside the IDL, the one power that could change everything above.",
  holder_at_launch: "The Squads v4 2-of-3 multisig vault with a 48 h time lock (SetTimeLock 172800), so every upgrade is proposed publicly and waits 48 h before it can execute. The same vault holds the platform authority and, per token, the config authority.",
  sunset: "Set to none (`solana program set-upgrade-authority <PROGRAM_ID> --final`, executed through the multisig) after the audit — the program then can never change.",
  verify: "docs/burn-receipts/README.md § Deployment runbook: commands, `anchor verify` / `solana-verify` and the expected executable hash.",
};

/**
 * D-3 (2026-10-10): the LaunchLab PlatformConfig admin — OUTSIDE this program, but it decides what register_pool will be asked to
 * accept. Checked in @raydium-io/raydium-sdk-v2 0.2.74-alpha: updatePlatformConfig (src/raydium/launchpad/instrument.ts:837-) offers
 * claim-fee / lock-NFT / vesting wallets, fee rate, name/web/img, migrateCpLockNftScale, cpConfigId, platformCpCreator, vesting scale,
 * restrict flags and the curve-rule manager — and NO admin change; the PlatformConfig layout (layout.ts) has no admin field because
 * the platform account IS the PDA ["platform_config", admin] (pda.ts getPdaPlatformId). The admin can therefore never be moved to a
 * Squads vault after creation; it is an UNTIMELOCKED key for the life of the platform. (A new platform could be created with a Squads
 * vault PDA as admin through a vault transaction — a different platform id, and every token pins the platform it launched on.)
 */
const EXTERNAL = [
  {
    power: "LaunchLab platform admin (Raydium LaunchLab PlatformConfig, outside burn_receipts)",
    holder: "the key that created the LaunchLab platform — not transferable (no admin-change instruction; the platform PDA is seeded by the admin key)",
    timelock: "none (untimelocked key)",
    can: "updatePlatformConfig: fee rate and wallets, cpConfigId, platformCpCreator, LP lock/burn scales (migrateCpLockNftScale), vesting, curve rules — for launches that have not migrated yet.",
    effect_on_burn_receipts: "Pinned at initialize_token (review-3 M-3): a later cpConfigId change cannot redirect register_pool (only replace_pool uses the platform's current cpConfigId, after 7 continuous days of a dead pool); platformCpCreator / scales are checked at init. Changing them between a token's init and its migration can still strand the registration — recovered with set_registration_policy (48 h, until the cap sunset). LAUNCH GATE (re-check R3-3): immediately before LaunchLab's create the launcher re-reads platformCpCreator, the scales and cpConfigId and refuses on any difference (`burnreceipts-admin.mts verify-platform-pins --mint`).",
  },
];

// ---------- cross-check the IDL against the descriptions ----------
const problems = [];
const idlNames = idl.instructions.map((i) => i.name).sort();
const described = Object.keys(POWERS).sort();
for (const n of idlNames) if (!POWERS[n]) problems.push(`IDL instruction ${n} is not described in the register`);
for (const n of described) if (!idlNames.includes(n)) problems.push(`register describes ${n}, which the IDL does not have`);
for (const ix of idl.instructions) {
  const p = POWERS[ix.name];
  if (!p) continue;
  const signers = ix.accounts.filter((a) => a.signer).map((a) => a.name).sort();
  const listed = Object.keys(p.signers).sort();
  if (JSON.stringify(signers) !== JSON.stringify(listed)) problems.push(`${ix.name}: IDL signers [${signers}] ≠ register signers [${listed}]`);
  for (const role of Object.values(p.signers)) if (!ROLES[role]) problems.push(`${ix.name}: unknown role ${role}`);
}
if (problems.length) {
  console.error(`powers register out of date:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// ---------- outputs ----------
const register = {
  schema: "burn-receipts.powers-register/v1",
  program: { name: idl.metadata.name, version: idl.metadata.version, address_in_idl: idl.address, idl_sha256: crypto.createHash("sha256").update(JSON.stringify(idl)).digest("hex") },
  roles: ROLES,
  instructions: idl.instructions.map((ix) => {
    const p = POWERS[ix.name];
    return {
      name: ix.name,
      class: p.class,
      signers: ix.accounts.filter((a) => a.signer).map((a) => ({ account: a.name, role: p.signers[a.name] })),
      gated_by: p.gated_by ?? null,
      can: p.can,
      cannot: p.cannot,
      timelock: p.timelock,
      sunset: p.sunset,
      funds: p.funds,
      temporary: p.temporary ?? false,
    };
  }),
  privileged_powers: idl.instructions.filter((ix) => POWERS[ix.name].class === "privileged").map((ix) => ix.name),
  temporary_powers: TEMPORARY,
  non_powers: NON_POWERS,
  upgrade_authority: UPGRADE,
  external_powers: EXTERNAL,
};
const json = JSON.stringify(register, null, 2) + "\n";

const esc = (s) => String(s ?? "—").replace(/\|/g, "\\|");
let md = "# Powers Register — burn_receipts\n\n";
md += "GENERATED by `programs/burn-receipts/scripts/powers-register.mjs` from the program's IDL — do not edit by hand. Machine-readable twin: `powers-register.json`.\n\n";
md += `Program \`${idl.metadata.name}\` v${idl.metadata.version}; IDL address \`${idl.address}\` (the localnet test key until the owner deploys); IDL sha256 \`${register.program.idl_sha256.slice(0, 16)}…\`.\n\n`;
md += "## Privileged powers\n\n";
md += `Only **${register.privileged_powers.length}** instructions need a privileged signer: ${register.privileged_powers.map((n) => `\`${n}\``).join(", ")}. The config authority's are limited to a token's attester set and the stranding-recovery registration switch (until the cap sunset); the platform authority's to RAISING the temporary burn-pool cap and clearing the cranker allowlist (which any listed key may also clear, and which lapses 90 days after initialize_platform); any one current attester may veto a pending registration-policy proposal. Every proposal waits 48 hours in public; both authorities can renounce.\n\n`;
md += "## Temporary powers (with sunset)\n\n";
for (const t of TEMPORARY) {
  md += `- **${t.power}** — holder: ${t.holder}. ${t.effect} Default ${t.default}. ${t.can_change} **Sunset:** ${t.sunset} *Why:* ${t.why}\n`;
}
md += "\n";
md += "## Every instruction\n\n| Instruction | Class | Signers (role) | Can | Cannot | Timelock | Sunset | Funds |\n|---|---|---|---|---|---|---|---|\n";
for (const i of register.instructions) {
  md += `| \`${i.name}\` | ${i.class} | ${i.signers.map((s) => `${s.account} (${s.role})`).join(", ")}${i.gated_by ? ` + quorum of ${i.gated_by}` : ""} | ${esc(i.can)} | ${esc(i.cannot)} | ${esc(i.timelock)} | ${esc(i.sunset)} | ${esc(i.funds)} |\n`;
}
md += "\n## Roles\n\n";
for (const [k, v] of Object.entries(ROLES)) md += `- **${k}** — ${v}\n`;
md += "\n## What does not exist\n\n";
for (const n of NON_POWERS) md += `- ${n}\n`;
md += "\n## Program upgrade authority\n\n";
for (const [k, v] of Object.entries(UPGRADE)) md += `- **${k}** — ${v}\n`;
md += "\n## Powers outside the program that it depends on\n\n";
for (const e of EXTERNAL) md += `- **${e.power}** — holder: ${e.holder}. Timelock: ${e.timelock}. Can: ${e.can} Effect here: ${e.effect_on_burn_receipts}\n`;

const jsonPath = path.join(outDir, "powers-register.json");
const mdPath = path.join(outDir, "powers-register.md");
if (process.argv.includes("--check")) {
  const stale = [];
  if (!fs.existsSync(jsonPath) || fs.readFileSync(jsonPath, "utf8") !== json) stale.push(path.relative(repo, jsonPath));
  if (!fs.existsSync(mdPath) || fs.readFileSync(mdPath, "utf8") !== md) stale.push(path.relative(repo, mdPath));
  if (stale.length) {
    console.error(`stale: ${stale.join(", ")} — run node programs/burn-receipts/scripts/powers-register.mjs`);
    process.exit(1);
  }
  console.log("powers register up to date");
} else {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(mdPath, md);
  console.log(`wrote ${path.relative(repo, jsonPath)} and ${path.relative(repo, mdPath)}`);
}
