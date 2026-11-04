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
  upgrade_authority: "The program's upgrade authority (BPF Upgradeable Loader). At launch: the Squads 2-of-3 vault; its time lock is 0 during launch week (owner decision 2026-10-11) and 48 h is planned from around 2026-10-23 — the live value is read from chain on /burnticker/trust; set to none after the audit.",
  platform_authority: "PlatformConfig.authority — intended: the Squads 2-of-3 vault. The platform authority no longer holds a cap-raise power. The program refuses every cap raise (CapRemoved; owner decision 2026-10-25: the burn-pool cap is removed). It can still renounce, and clear the unused cranker list.",
  attester_key: "Any ONE key of the token's CURRENT attester set, signing a transaction by itself (no quorum). Power: veto (clear) a pending registration-policy proposal — nothing else (re-check R3-2).",
  platform_authority_or_listed_cranker: "PlatformConfig.authority (while not renounced) OR any key on the PlatformConfig's (unused) cranker list (re-check R3-4). Since the owner decision of 2026-10-25 the cranker allowlist is removed and every crank is permissionless; this role can only clear the unused stored list — never add a key.",
};

const POWERS = {
  initialize_token: {
    class: "creation",
    signers: { payer: "anyone", creator: "creator", mint: "mint_keypair" },
    can: "RETIRED (round-5 review R5-5): every deployable build refuses it with InitializeTokenRetired (the discriminator is kept so an old client gets that error); coins are created with initialize_token_r5. What it did for the coins round 4 created: create the ONE TokenConfig of a mint: the burn rule (immutable thereafter), the feed id, the memo text, the rules-file hash, the attester set and quorum; fund the fee PDA with the rule's reserve; for buyback policies 0 and 2, read and PIN the LaunchLab platform — only the operator's compiled BURNTICKER_PLATFORM (per cluster; the mainnet placeholder refuses: lp-lock blind review RL-3) — (its cpConfigId; platformCpCreator must be unset or the fee PDA) and, for policy 0, require it to lock 100 % of the migrated LP with the Fee Key to the program's FEE_KEYS PDA (platformLockNftWallet = FEE_KEYS, platformScale 1,000,000, creator and burn scale 0 — LAUNCHPAD-PATH §35). Optionally (LAUNCHPAD-PATH §40, policies 0/1) name the partner mint of a winner-takes-the-burn pair: the coin's PairLink is written provisional, and both coins become paired only if the partner's initialize_token names this mint back within 7 days (an unanswered coin stays a plain coin for good). Optionally (LAUNCHPAD-PATH §45, buyback) pin the coin's END SINK — the platform flagship ($DEFICIT, compiled per cluster as BURNTICKER_FLAGSHIP: mainnet AJJ4XxCU…), a named coin, or the pair partner — and the minimum a forward on end moves; written once in an EndSink account [\"end_sink\", mint].",
    cannot: "Run at all on a deployable round-5 build (InitializeTokenRetired); run twice for a mint; be run by anyone without the mint keypair; change anything afterwards (the end sink included); pin a league-set sink (not supported yet) or an end sink on the flagship itself.",
    timelock: null, sunset: "Single use per mint.", funds: "Payer → fee PDA: the reserve only (rent for the PDA).",
  },
  initialize_token_r5: {
    class: "creation",
    signers: { payer: "anyone", creator: "creator", mint: "mint_keypair" },
    can: "Round 5's create: exactly initialize_token (the same accounts, arguments and checks), plus the owner's rule of 2026-10-13 that a coin never burns itself on its losing path: a buyback coin must pin an end sink (the flagship, a named coin, the pair winner or Solana's incinerator), so a RESOLVED end never winds down on the coin itself. The flagship and vault-mode coins are exempt.",
    cannot: "Create a buyback coin without an end sink (LostPathBurnsSelf); do anything initialize_token cannot.",
    timelock: null, sunset: "Single use per mint (one TokenConfig per mint, whichever create made it).", funds: "Payer → fee PDA: the reserve only (rent for the PDA).",
  },
  register_pool: {
    class: "permissionless",
    signers: { registrar: "anyone" },
    can: "Record the Raydium CPMM pool the buyback trades on (pool policy 0) — only LaunchLab's migration pool: the token's LaunchLab pool records the fee PDA as creator, CPMM migration and the platform PINNED at init, the pool is the PDA of the PINNED cpConfigId and the two mints, its pool_creator is the fee PDA, ≥ 50 % of its live LP is burned or held by Raydium's LP lock, and (lp-lock blind review RL-3) the mint's FeeKeyRecord exists for this pool — so the pool is verified only when its LP fees reach the burn. Policy 1: verify the fixed pool (fee-PDA creator, ≥ 50 % LP burned/locked) before any buyback.",
    cannot: "Register any other pool (another AmmConfig, a random-keypair pool, a pool whose LP its creator can withdraw); register a policy-0 pool whose migration Fee Key FEE_KEYS does not hold (no FeeKeyRecord); register twice; change a registered pool.",
    timelock: null, sunset: "Once per token (then frozen).", funds: "None.",
  },
  register_pair_pool: {
    class: "permissionless",
    signers: { registrar: "anyone" },
    can: "Registration policy 2 (2026-10-10, rivalry pairs): record the CPMM pool that the pair_curve program's graduate created for this token — the Pair account is pair_curve's (hard-coded id, discriminator, PDA [\"pair\", mint_a, mint_b]), Graduated (or Graduating with this side done) and names this mint; the pool is the one the Pair records for that side AND the pair_curve PDA [\"pool\", pair, [side]] (only pair_curve can sign for it), on the cpConfigId pinned at initialize_token, with the pair's SOL vault PDA as pool_creator; ≥ 90 % of the LP that existed at creation was LOCKED by pair_curve's lock_lp (or burned, for pairs graduated before LAUNCHPAD-PATH §35) — Pair record, confirmed on chain by the LP in Raydium's lock account plus CPMM lp_supply − LP mint supply.",
    cannot: "Register a pool for a policy-0/1 token, a pool from another pair or side, a pool at any other address, on another AmmConfig or with its LP neither locked nor burned; register a coin not yet paired by link_pair (LAUNCHPAD-PATH §40: every pair is winner-takes-the-burn) — a coin unlinked by unlink_pair on terminal evidence (pair-forward r3) still registers; register twice; change a registered pool. Later LP deposits cannot block it (the ratio is against the creation supply).",
    timelock: null, sunset: "Once per token (then frozen).", funds: "None.",
  },
  register_fee_key: {
    class: "permissionless",
    signers: { payer: "anyone" },
    can: "LAUNCHPAD-PATH §35: once per mint, record the coin's permanent LP lock — the Raydium CPMM lock program's LockedCpLiquidityState (owner, discriminator, PDA [\"locked_liquidity\", nft]) whose Fee Key NFT (supply 1, no mint or freeze authority) the program's FEE_KEYS PDA holds, identified by its LOCKER (state @128; lp-lock blind review RL-2): policy 0 — the token's LaunchLab migration pool (PDA of the pinned cpConfigId, fee-PDA creator) locked by LaunchLab's vault authority, BEFORE register_pool; policy 2 — the verified pair pool locked by the pair's vault; policy 1 — the verified pool. The position must hold a strict majority of the LP in Raydium's lock account for the LP mint. Recorded in a FeeKeyRecord [\"fee_key\", mint]; the payer pays its rent.",
    cannot: "Register a position of another pool, a position locked by anyone but the pool's own locker, a minority of the lock account (so a dust or squatter lock cannot take the slot — and a deposit cannot dilute the coin's own position), a position whose Fee Key FEE_KEYS does not hold, or a second position; change the record; move any funds or the Fee Key.",
    timelock: null, sunset: "Once per token (then frozen).", funds: "Payer → the record's rent.",
  },
  claim_lock_fees: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "LAUNCHPAD-PATH §35: collect ALL the recorded position's accrued fees (no caller-chosen amount: lp-lock blind review L-3; against the FeeKeyRecord's pool, so a pool replacement cannot strand them: L-1) from Raydium's CPMM lock program (collect_cp_fees, signed by the FEE_KEYS PDA, into FEE_KEYS's own WSOL and token accounts) and split them by compiled constants: the SOL side 80 % (LOCK_FEE_BURN_BPS) to the coin's fee PDA (its burn pool) and 20 % (LOCK_FEE_OPERATOR_BPS) to the compiled OPERATOR_TREASURY; burn the coin side in the same instruction; write a receipt memo (v2: with the operator share delivered and still pending) when SOL was claimed or delivered; FEE_KEYS's transient accounts are closed with their rent back to the cranker who created them (a pre-existing account's rent goes to the fee PDA).",
    cannot: "Choose the split, the treasury or any recipient (the treasury is compiled per cluster; the mainnet placeholder refuses every claim); claim another coin's position or pool; touch the LP principal (the lock program pays only accrued fees) or the Fee Key (re-checked after the CPI, hard error); let the lock program change FEE_KEYS's owner, data or lamports or its accounts' owner, mint, delegate or close authority.",
    timelock: null, sunset: "None.", funds: "Raydium lock (accrued LP fees) → FEE_KEYS → fee PDA (80 % of the SOL) and OPERATOR_TREASURY (20 %); the coin side is burned.",
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
    can: "Process the next reading in line (buyback mode): target = pool × (1 − (1 − f)^units) + carried spend; spend it all in this one crank (owner decision 2026-10-25: no burn-pool cap and no per-crank bound; spend is carried only under the floor, past a 30-day untradeable pool, or when the minimum output is 0); swap on the registered, provenance-checked CPMM pool behind a mandatory TWAP guard (≤ 3 % over 600–1,200 s) with a minimum output of max(spot quote, TWAP quote) less ≤ 3 % slippage; burn EVERY token the fee PDA holds; write memo v2. After 30 days of continuous pool untradeability, process the reading below-floor with its target carried. A PAIRED coin (LAUNCHPAD-PATH §40) cranks only with the period's pair result: won or draw → as above; no result, or lost with no forward landed (pair-forward blind review H-1) → only 72 h after the reading, then as an unpaired coin.",
    cannot: "Choose the amount, the pool, the price or the recipient; skip a reading; process one twice; send SOL or tokens anywhere except the pool (SOL→token) and the burn; let the CPMM call change the fee PDA's or its token accounts' owner, delegate or close authority (hard error); burn for a paired coin that LOST the period within 72 h of its reading (its fuel goes to the winner through forward_to_winner).",
    timelock: null, sunset: "None.", funds: "Fee PDA SOL → its WSOL account → CPMM pool vault; tokens received → burned (supply reduced).",
  },
  crank_carried: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "Round 5 (burn dispersal, owner decision 2026-10-13; deployed on devnet and mainnet on 2026-10-15): spend a PIECE of the spend earlier cranks carried (TokenConfig.carried_spend_lamports), without a new reading: spend = min(carried, the caller's max_spend_lamports, the spendable pool), so one call may spend the whole carried amount (owner decision 2026-10-25: no per-crank bound and no carried budget); also after the rule ended (round-5 review R5-3 / R5-4: after a VOID end it drains what the wind-down carried; after a RESOLVED end it drains the spend owed by readings inside the window, which forward_on_end / burn_sol_on_end leave in place for 30 days); the piece must be at least the rule's floor unless it is the whole remainder; swap on the registered, provenance-checked CPMM pool behind the same mandatory TWAP guard and minimum output as crank_buyback; burn EVERY token the fee PDA holds; write the `carried` memo naming the last processed reading (through=) and the coin's piece count (piece=). One piece per coin per second. The coin's CarriedPace account (created by its first piece; the cranker pays that account's rent) counts the pieces; its budget field is unused since 2026-10-25 (the carried budget and CARRIED_BUDGET_WINDOW_SECS were removed with the per-crank bound); TokenConfig.burns counts reading cranks only.",
    cannot: "Run while any submitted reading waits for its own crank (crank_cursor must equal last_record_date), so a reading's crank always runs first with the whole carried amount in its target; touch a Reading or move the crank cursor; spend more than is carried; run a second piece for the same coin in the same second or transaction (CarriedTooSoon); pass another account as the coin's CarriedPace, or one of an unknown version (InvalidCarriedPace); run for a coin that burns another token or on an untradeable pool; send SOL or tokens anywhere except the pool (SOL→token) and the burn.",
    timelock: null, sunset: "None.", funds: "Fee PDA SOL → its WSOL account → CPMM pool vault; tokens received → burned (supply reduced).",
  },
  link_pair: {
    class: "permissionless",
    signers: { payer: "anyone" },
    can: "LAUNCHPAD-PATH §40: pair the two coins of a pair_curve Pair (the Pair account — pair_curve's, not Voided, no side refunding — names both mints; both TokenConfigs are policy 2 with the SAME attester set and quorum, pair-forward r3 M-1): write or complete both coins' PairLink [\"pair_link\", mint] and set both configs paired. Periods either coin has already read stay unpaired (pair_after_date: no result may name them, the crank treats them as unpaired — r3; r2 refused such coins outright, freezing them). Idempotent; the payer pays the PairLink rent.",
    cannot: "Pair coins the Pair does not name, a voided pair or one with a refunding side, a coin already linked to another partner, non-policy-2 coins, or coins with different attester sets / quorums; re-interpret a period read before the link; change a partner.",
    timelock: null, sunset: "Once per pair (then frozen).", funds: "Payer → the PairLinks' rent.",
  },
  submit_pair_result: {
    class: "permissionless",
    signers: { payer: "anyone" },
    gated_by: "attesters",
    can: "LAUNCHPAD-PATH §40: append one period's result of a pair — the winning mint or a draw — over BURNRECEIPTS-PAIR-v1 ‖ cluster genesis ‖ program ‖ both mints ‖ date ‖ winner ‖ source hash ‖ proof locator. Every result — win or draw — needs BOTH coins' attester quorums (pair-forward r3 M-1); pairing requires one common attester set and quorum and a paired coin changes its set only with the partner's quorum co-signing, so this is one set of signatures and neither side's attesters can sign its wins while withholding its losses (on Burnticker that common quorum is the operator keeper alone, quorum 1). A win is recorded only if both coins read the date and the loser's reading is still unprocessed (H-1), so forward_to_winner can always serve it (a side without a verified pool then forwards 0 lamports).",
    cannot: "Change or replace a recorded result; post a result for coins that are not paired to each other, a future date, a date before the pairing (L-2) or on/before pair_after_date (r3), a winner outside the pair, or a win the forward could not serve; reuse a signature made for another cluster, pair or date; be re-submitted without valid signatures (I-2).",
    timelock: null, sunset: "None.", funds: "Payer pays the PairResult account's rent (kept forever).",
  },
  unlink_pair: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "pair-forward blind review M-2 / r3 RN-1, RN-2: undo a pairing on TERMINAL on-chain evidence only — the pair_curve Pair holding both mints is Voided or one of its sides is refunding (required evidence when either coin is policy 2), or, for a LaunchLab pair, its locked voidBy day (TokenConfig.pair_void_by, set at initialize_token, the same on both coins) has ended (UTC) with a coin still lacking a verified pool; both coins become UNLINKED plain coins (pair_unlinked_at; a policy-2 coin still registers its pool) and both PairLinks close, their rent to each coin's own fee PDA.",
    cannot: "Unlink a pair_curve pair while its Pair is Open (or Graduating with no refunding side), however long the curve runs (r2's 'no verified pool 30 days after pairing' is gone); unlink a LaunchLab pair before its voidBy has ended or once both pools are verified; move any other funds.",
    timelock: "A LaunchLab pair: after its locked voidBy day.", sunset: "Once per pair.", funds: "PairLink rent → each coin's fee PDA.",
  },
  forward_to_winner: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "LAUNCHPAD-PATH §40: for a period whose result names a winner, within 72 h of the loser's reading (pair-forward r3 RI-1), process the LOSER's reading by moving exactly what its own rule would have spent had it won — pool × (1 − (1 − f)^units) on min(spendable incl. synced WSOL − the spend it still owes earlier periods (r3 RI-4)) (no burn-pool cap since 2026-10-25), nothing under its floor, nothing when either coin is not live (pair-forward blind review H-1: the reading is still processed, lamports=0; live = its own pool verified, or (round-5 review R5-9) a coin that burns another token whose BurnTarget is pinned and not stalled (no 30-day unblock since its last target burn), read from the BurnTarget account itself) — from the loser's fee PDA to the winner's fee PDA (SOL above the reserve first, then WSOL into the winner fee PDA's WSOL account); mark the reading forwarded, record the forward on the result, write memo `<PREFIX>|forward|…|v1` (always, lamports=0 included). A second call is a no-op.",
    cannot: "Choose the amount or the recipient (only the winner's fee PDA, which spends only through crank_buyback); forward on a draw, to the losing coin, out of the loser's reading order, after the 72 h time-out, or below the loser's reserve; take lamports the loser owes its earlier periods; leave out the BurnTarget account of a target coin without its own pool to make it look dead (BurnTargetAccountMissing); touch either coin's supply.",
    timelock: null, sunset: "None.", funds: "Loser fee PDA SOL / WSOL → winner fee PDA SOL / WSOL account (then burned by the winner's cranks).",
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
    can: "Create the ONE PlatformConfig: the platform authority and the platform sunset (at most 365 days out and no later than 2027-10-01), which now only closes the stranding-recovery registration-policy switch. Owner decision 2026-10-25: the cap and cranker arguments are accepted for a stable interface and ignored (never stored); there is no burn-pool cap and no cranker allowlist.",
    cannot: "Run twice; be run by anyone but the program's upgrade authority; set a cap or a cranker allowlist (both removed); set a sunset in the past, beyond 365 days or after 2027-10-01.",
    timelock: null, sunset: "Single use.", funds: "Payer pays the PlatformConfig's rent.",
  },
  propose_cap_raise: {
    class: "privileged",
    signers: { authority: "platform_authority" },
    can: "Nothing: refused (CapRemoved). Owner decision 2026-10-25: there is no burn-pool cap, so the platform authority no longer holds a cap-raise power. The entry point stays so the IDL is stable.",
    cannot: "Propose any cap raise (always refused with CapRemoved); touch any token's rule, readings, fee PDA, vault or pool; move funds.",
    timelock: null,
    sunset: "Removed (owner decision 2026-10-25): always refused.", funds: "None.",
    temporary: true,
  },
  cancel_cap_raise: {
    class: "privileged",
    signers: { authority: "platform_authority" },
    can: "Nothing: refused (CapRemoved). Owner decision 2026-10-25: there is no cap raise to cancel.",
    cannot: "Anything (always refused with CapRemoved).",
    timelock: null, sunset: "Removed (owner decision 2026-10-25): always refused.", funds: "None.",
    temporary: true,
  },
  renounce_platform_authority: {
    class: "privileged",
    signers: { authority: "platform_authority" },
    can: "Give up the platform authority forever. Since 2026-10-25 the authority holds no cap power, so this only gives up clearing the unused cranker list.",
    cannot: "Be undone.",
    timelock: null, sunset: "Single use.", funds: "None.",
    temporary: true,
  },
  set_registration_policy: {
    class: "privileged",
    signers: { admin: "config_authority" },
    can: "STRANDING RECOVERY: propose switching the token's registration policy — to a fixed pool that must pass register_pool's creator + LP checks AND (re-check R3-2) have ≥ 90 % of its live LP burned/locked or be the pool PDA of a LaunchLab-known AmmConfig (the pinned cpConfigId or the pinned platform's current one) when applied, or back to LaunchLab's migration pool (policy 0, needs the pinned platform).",
    cannot: "Act while a pool works (only with no verified pool, or the registered one continuously untradeable ≥ 7 days); act after the platform sunset; pick a pool whose pool_creator is not the fee PDA, whose LP is < 50 % burned/locked, or (< 90 % locked) that sits on an AmmConfig LaunchLab does not name; take effect before 48 hours or after 14 days (the proposal expires); survive a veto by any one current attester; touch the rule, readings, fee PDA or vault.",
    timelock: "48 hours (ATTESTER_TIMELOCK_SECS), public: emits RegistrationPolicyProposed (eta, expires_at = proposal + 14 days); any current attester can veto it (veto_registration_policy).",
    sunset: "Until the platform sunset (PlatformConfig.cap_sunset_ts, or 2027-10-01 without one; the same window as before the cap was removed); gone once renounce_admin runs.", funds: "None.",
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
    cannot: "Apply early, after expiry, after the platform sunset, while a pool works, or a pool that fails the checks.",
    timelock: "Executable only after the proposal's ETA.", sunset: "Until the platform sunset.", funds: "None.",
  },
  veto_registration_policy: {
    class: "privileged",
    signers: { attester: "attester_key" },
    can: "VETO: clear a pending registration-policy proposal (re-check R3-2 — the cheap veto by the parties a pool switch would bypass).",
    cannot: "Propose, apply or change any policy; touch the attester set, readings, rule or funds; act without a pending proposal. (The admin can propose again at once — a fresh, public 48 h.)",
    timelock: null, sunset: "Pointless once the switch window closes (the platform sunset) or renounce_admin runs.", funds: "None.",
    temporary: true,
  },
  clear_cranker_allowlist: {
    class: "privileged",
    signers: { caller: "platform_authority_or_listed_cranker" },
    can: "Clear the PlatformConfig's stored cranker list. Owner decision 2026-10-25: the cranker allowlist is removed and has no effect on cranking (every crank is permissionless), so this only tidies the unused bytes. Re-check R3-4: the platform authority OR any listed key may do it.",
    cannot: "Add or change crankers; restrict who may crank; touch any token or any funds; be done by a key that is neither the authority nor on the list.",
    timelock: null, sunset: "Removed in effect (owner decision 2026-10-25): the list no longer applies.", funds: "None.",
    temporary: true,
  },
  apply_cap_raise: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Nothing: refused (CapRemoved). Owner decision 2026-10-25: there is no cap raise to apply.",
    cannot: "Anything (always refused with CapRemoved).",
    timelock: null, sunset: "Removed (owner decision 2026-10-25): always refused.", funds: "None.",
  },
  apply_attester_change: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Apply a pending attester proposal after its 48-hour timelock (a coin that is not paired).",
    cannot: "Apply early; apply a proposal that lowers the quorum (re-checked); apply to a PAIRED coin (pair-forward r3 M-1: use apply_paired_attester_change).",
    timelock: "Executable only after the proposal's ETA.", sunset: "None.", funds: "None.",
  },
  submit_rule_end: {
    class: "permissionless",
    signers: { payer: "anyone" },
    gated_by: "attesters",
    can: "LAUNCHPAD-PATH §45: end a coin's rule once — date and outcome RESOLVED or VOID — over BURNRECEIPTS-END-v1 ‖ cluster genesis ‖ program ‖ mint ‖ date ‖ outcome ‖ source hash ‖ proof locator, signed by the coin's attester quorum; only for a coin with an end sink. After a RESOLVED end no reading dated later can be submitted or cranked (the coin's remaining fuel goes to its sink through forward_on_end); a VOID end keeps the coin's hashed wind-down. The payer pays the RuleEnd account's rent.",
    cannot: "End a coin twice, a coin without an end sink, with a date in the future or before the coin's last reading, or with another outcome; reuse a signature made for another cluster, coin, date or outcome; move any funds.",
    timelock: null, sunset: "Once per coin.", funds: "Payer pays the RuleEnd account's rent (kept forever).",
  },
  forward_on_end: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "LAUNCHPAD-PATH §45: after a RESOLVED end, once the coin's readings inside its window are processed (or it burns itself and never registered a pool: round-5 review R5-1), move min(the fee PDA's SOL above the reserve + its WSOL, less a self coin's carried spend for 30 days after the end (round-5 review R5-4: crank_carried burns it on the coin first)) to the destination's fee PDA — SOL first, then WSOL into the destination fee PDA's WSOL account — if at least the end sink's minimum; write memo `<PREFIX>|endfwd|to=…|lamports=N|v1`. The program chooses the destination: the flagship; a named coin while it is live (a verified pool, or (round-5 review R5-9) a pinned, not stalled BurnTarget for a coin that burns another token; its own rule not ended), else the flagship; the pair partner only if the end date's pair result names it winner and it is live and still paired, else the flagship. Callable again for later fee income.",
    cannot: "Choose the amount or the destination (only a burn_receipts fee PDA, which spends only through crank_buyback); run before a resolved end, under the minimum, below the reserve, or while the coin's window readings are unprocessed; send to a sink that is not live, or to a flagship without a verified pool (then nothing moves); leave out the BurnTarget account of a named target coin to divert the fuel to the flagship (BurnTargetAccountMissing).",
    timelock: null, sunset: "None.", funds: "Resolved coin's fee PDA SOL / WSOL → the end sink's (or the flagship's) fee PDA SOL / WSOL account (then burned by that coin's cranks).",
  },
  burn_sol_on_end: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "Round 5, the incinerator end sink (EndSink kind INCINERATOR, pinned at creation): after a RESOLVED end, once the coin's readings inside its window are processed (or it burns itself and never registered a pool: round-5 review R5-1), unwrap the fee PDA's WSOL into the fee PDA (its WSOL account closed and created again, the cranker's rent refunded from it) and send min(the fee PDA's SOL above the reserve, less a self coin's carried spend for 30 days after the end (R5-4)) to Solana's incinerator (1nc1nerator11111111111111111111111111111111, address-checked; nobody holds its key and the runtime burns what it receives). Memo endburn, event SolBurnedOnEnd. Callable again for the later trickle above the end sink's minimum.",
    cannot: "Send to any address but the incinerator; run for a coin whose end sink is another kind (forward_on_end refuses the incinerator kind, so the two never overlap); choose the amount; run before a resolved end, below the reserve, under the minimum after the first send, under an empty account's rent-exempt minimum, or while the coin's window readings are unprocessed.",
    timelock: null, sunset: "None.", funds: "Resolved coin's fee PDA SOL (and its WSOL, unwrapped) → Solana's incinerator, where it is destroyed.",
  },
  apply_paired_attester_change: {
    class: "permissionless",
    signers: { caller: "anyone" },
    gated_by: "attesters",
    can: "Pair-forward r3 M-1: apply a PAIRED coin's pending attester proposal after its 48-hour timelock, only with a quorum of the PARTNER's current attesters signing BURNRECEIPTS-PAIR-ATTESTER-CHANGE-v1 ‖ cluster genesis ‖ program ‖ mint ‖ partner ‖ sha256 of the pending set ‖ ETA (Ed25519SigVerify in the same transaction). The coin's PairLink then records the new set.",
    cannot: "Apply early, without the partner's quorum, a proposal that lowers the quorum, or to a coin that is not paired to that partner; let either side's attesters alone change who signs the pair's results.",
    timelock: "Executable only after the proposal's ETA.", sunset: "None.", funds: "None.",
  },
  pin_burn_target: {
    class: "creation",
    signers: { payer: "anyone", mint: "mint_keypair" },
    can: "Round 5 (a coin that burns another token): once, and only while the coin's mint account does not exist yet (before LaunchLab or pair_curve creates it), name the other token this coin burns instead of itself, its Pyth price feed, and ONE pool its SOL is swapped on (Raydium CPMM, or Raydium AMM v4 in swap-only status), in a BurnTarget account [\"burn_target\", mint]. Checks: the other token is a plain SPL Token mint (Token-2022 refused), not the coin and not WSOL, with no mint authority and no freeze authority; the pool's mints are exactly {that token, WSOL} on SPL Token, its fee at most 1 %, its SOL reserve (net of owed fees or PnL) at least 50 SOL (devnet build: 2 SOL); both Pyth prices (SOL/USD and the token's feed) fully verified, at most 60 s old, confidence at most 1 %, and the pool's price within the rule's deviation of the Pyth ratio. The pool's LP need not be locked: it is not ours. Requires the coin's EndSink (round-5 review R5-5: its lost path goes to its sink, never a self wind-down). Sets TokenConfig.burn_target_kind = EXTERNAL.",
    cannot: "Run for a coin without an end sink (LostPathBurnsSelf); run after the coin's mint exists, twice, on a vault-mode coin, or on a coin with readings, burns or a verified pool; be run without the mint keypair; pin a feed the pool's market disagrees with; change the token it burns or its feed ever after.",
    timelock: null, sunset: "Closed for good once the coin's mint exists.", funds: "Payer pays the BurnTarget account's rent (kept forever).",
  },
  crank_target_burn: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "Round 5: for a coin that burns another token, the next reading in line: crank_buyback's spend (the rule on the whole spendable pool, carried spend, floor; no platform cap since 2026-10-25) and guards on the PINNED pool only (address-checked; its program, mints, config or vault authority, fee and vaults re-read every time): the Pyth guard (both prices fully verified, at most 60 s old, confidence at most 1 %, the pool's price within the rule's deviation of the Pyth ratio both ways), for a CPMM pool its TWAP as well, min-out = the larger of the spot, Pyth and TWAP quotes less fee and slippage, the whole spend in one crank (no per-crank bound since 2026-10-25), the post-CPI integrity checks; swap SOL (CPMM swap_base_input or AMM v4 swap_base_in_v2) for the other token into the fee PDA's own account for it and burn everything in that account, burn any of the coin's own tokens the fee PDA holds, write memo v3 naming the burned mint. A pool that is gone, switched off, changed, above the 1 % fee or under the SOL floor, a stale or wide Pyth price, SOL/USD and target updates published more than 60 s apart, a pool away from Pyth or under the Pyth minimum output, or a CPMM TWAP that is unavailable or away from spot refuses (the SOL is held); 30 days after the reading it is processed below-floor with its spend carried. A Pyth update older than the last one the coin accepted is refused (round-5 review R5-7). The two price accounts must be the feeds' sponsored push-oracle accounts (address-checked), never a caller-chosen snapshot.",
    cannot: "Use any other pool or token; choose an amount; send SOL or tokens anywhere but the pinned pool (for the other token, then burned); run for a coin that burns itself (crank_buyback is refused for a coin that burns another token).",
    timelock: null, sunset: "None.", funds: "Fee PDA SOL / WSOL → the pinned pool's WSOL vault, in exchange for the other token, burned in the same instruction.",
  },
  release_target: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "Round-5 review R5-6, the liveness escape for a coin that burns another token: when its target is stalled (its last target event is a 30-day unblock, no target burn since, and 30 days since its last burn or its pin) and no reading waits for its crank, move its CARRIED spend, and only that, min(carried, the fee PDA's SOL above the reserve + its WSOL), to the flagship's fee PDA (BURNTICKER_FLAGSHIP, compiled; it must be live), SOL first, then WSOL; memo `<PREFIX>|release|to=…|lamports=N|left=N|v1`, event TargetReleased. No admin or attester takes part, so none can block it.",
    cannot: "Choose the amount or the destination; move more than the carried spend; run for a coin that burns itself, for a target that burned since its last unblock, before 30 days without a burn, while a reading waits, to a flagship without a verified pool, below the reserve.",
    timelock: null, sunset: "None.", funds: "Stalled target coin's fee PDA SOL / WSOL (its carried spend) → the flagship's fee PDA SOL / WSOL account (then burned by the flagship's cranks).",
  },
  propose_target_pool: {
    class: "privileged",
    signers: { admin: "config_authority" },
    can: "Round 5: propose a different CPMM pool for the SAME burned token (applicable 48 h later, for 14 days after the proposal; a new proposal replaces a pending one).",
    cannot: "Change the burned token; apply the proposal itself; skip the checks (apply re-runs them); act after renounce_admin.",
    timelock: "48 h before apply_target_pool can run.", sunset: "Gone at renounce_admin.", funds: "None.",
  },
  cancel_target_pool: {
    class: "privileged",
    signers: { admin: "config_authority" },
    can: "Round 5: withdraw a pending pool proposal.",
    cannot: "Change anything else.",
    timelock: null, sunset: "Gone at renounce_admin.", funds: "None.",
  },
  veto_target_pool: {
    class: "privileged",
    signers: { attester: "attester_key" },
    can: "VETO: clear a pending pool proposal for a coin that burns another token (round 5; any one current attester).",
    cannot: "Propose, apply or change a pool; touch the burned token, readings, rule or funds; act without a pending proposal.",
    timelock: null, sunset: "None.", funds: "None.",
  },
  apply_target_pool: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Round 5: apply a pending pool proposal after its 48-hour timelock and within 14 days of the proposal, only if the proposed pool (CPMM or AMM v4) passes the same checks as pin_burn_target, Pyth included, for the same burned token and feed.",
    cannot: "Apply early or late, a pool other than the proposed one, a pool that fails the checks, or a different token.",
    timelock: "Executable only after the proposal's ETA, until 14 days after the proposal.", sunset: "None.", funds: "None.",
  },
};

const NON_POWERS = [
  "No withdraw, sweep, transfer, close or set-recipient instruction exists for the fee PDA, its token accounts, the vault or any program account. SOL leaves the fee PDA only inside crank_buyback and crank_carried (into its own WSOL account, then into the CPMM pool for tokens that are burned) inside forward_to_winner (LAUNCHPAD-PATH §40: only to the paired winner's fee PDA, only the formula amount for an attested lost period) and inside forward_on_end (LAUNCHPAD-PATH §45: only after a quorum-signed RESOLVED end, only to the fee PDA of the end sink the program picks — the pinned coin while it is live, else the compiled flagship — never an amount or a destination the caller chooses) and inside burn_sol_on_end (round 5: only for a coin whose pinned end sink is the incinerator, only after a quorum-signed RESOLVED end, only to Solana's incinerator, address-checked) and inside crank_target_burn (round 5: only into the PINNED pool's WSOL vault, for the other token, burned in the same instruction) and inside release_target (round-5 review R5-6: only a stalled target coin's carried spend, only to the compiled flagship's fee PDA); tokens leave only by burn.",
  "Round 5: no instruction changes the other token a coin burns; only the pool it is swapped on can be re-pinned (propose_target_pool → 48 h, any attester can veto → apply_target_pool, the same checks).",
  "No program account (TokenConfig, Reading, PlatformConfig, FeeKeyRecord, fee PDA) is ever closed. The only accounts the program closes are the FEE_KEYS PDA's own transient WSOL and token accounts inside claim_lock_fees, created and emptied in the same instruction, their rent back to the cranker who paid it (to the fee PDA if someone else created them); and, in burn_sol_on_end (round 5, the incinerator end sink), the fee PDA's own WSOL account, closed into the fee PDA to unwrap its WSOL and created again in the same instruction at the same address, the cranker's rent refunded from it.",
  "No pause or freeze exists. Nothing can stop cranks except the rule's own guards (a stale TWAP or a closed pool defers a burn day; it is never lost). There is no burn-pool cap and no per-crank bound (owner decision 2026-10-25): a burn spends the rule's full share in one run.",
  "No instruction mints tokens, and none holds a mint authority: the program's only token instructions are Burn (and SyncNative on its own WSOL account). There is no team allocation in the program.",
  "No fee is charged by the program, so there is no fee to change. The LP-fee split of claim_lock_fees (80 % burn pool / 20 % operator) and the operator treasury are compiled constants: no instruction, config field or key changes them (LAUNCHPAD-PATH §35).",
  "No instruction moves the locked LP principal or the Fee Key NFT: the lock is Raydium's permanent lock, and FEE_KEYS signs only collect_cp_fees inside claim_lock_fees.",
  "No instruction updates the burn rule (RuleParams), the feed id, the memo text, the rules hash, the mint, the creator record or the registered pool.",
  "No instruction edits or deletes a reading; readings are append-only and quorum-checked.",
  "The quorum can never be lowered (nor exceed 3), the attester set can never be smaller than the quorum, and one proposal must keep at least `quorum` of the current keys and add fewer new keys than the new quorum; keys are added only on the strength of kept keys ≥ 7 days old.",
  "No instruction changes the pinned LaunchLab platform / cpConfigId; the registration policy changes only through set_registration_policy (48 h, stranding only, until the platform sunset), which can never select policy 2 (pair curve) — that policy is chosen at initialize_token or not at all.",
  "No PlatformConfig is required: there is no burn-pool cap with or without one (owner decision 2026-10-25), so a lost or finalised upgrade authority cannot wedge buybacks. Without one, the stranding-recovery switch stays open until 2027-10-01.",
  "No cap raise exists: propose_cap_raise, cancel_cap_raise and apply_cap_raise always refuse (CapRemoved). The platform authority no longer holds a cap-raise power.",
];

const TEMPORARY = [
  {
    power: "Registration-policy switch — stranding recovery (review-3 M-3)",
    holder: "config_authority (TokenConfig.admin, the Squads vault)",
    effect: "Switch a token whose LaunchLab migration cannot be registered (or whose pool died) to a fixed pool passing the creator + LP checks, or back to policy 0.",
    default: "Unused.",
    can_change: "set_registration_policy → 48 h → apply_registration_policy (anyone) within 14 days of the proposal; cancel_registration_policy (admin); veto_registration_policy (any one current attester). A fallback fixed pool needs ≥ 90 % LP burned/locked or a LaunchLab-known AmmConfig (re-check R3-2).",
    sunset: "Until the platform sunset (PlatformConfig.cap_sunset_ts, or 2027-10-01 without one; the same window as before the cap was removed); also gone at renounce_admin.",
    why: "LaunchLab is closed source; its platform admin can change cpConfigId / platformCpCreator / lock scales before migration. Real LaunchLab behaviour remains a devnet-rehearsal gate.",
  },
];

const UPGRADE = {
  power: "Program upgrade authority (BPF Upgradeable Loader) — outside the IDL, the one power that could change everything above.",
  holder_at_launch: "The Squads v4 2-of-3 multisig vault. Mainnet time lock: 0 during launch week (owner decision 2026-10-11, so deploy and config fixes are not delayed), 48 h (SetTimeLock 172800) planned from around 2026-10-23; once set, every upgrade is proposed publicly and waits 48 h before it can execute. The live value is read from chain (GET /api/burnticker/v1/current-status). The same vault holds the platform authority and, per token, the config authority.",
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
    can: "updatePlatformConfig: fee rate and wallets — including platformLockNftWallet, which receives every migration's Fee Key (LAUNCHPAD-PATH §35: burn_receipts' FEE_KEYS PDA) — cpConfigId, platformCpCreator, LP lock/burn scales (migrateCpLockNftScale; Burnticker: 1,000,000 / 0 / 0, all LP locked), vesting, curve rules — for launches that have not migrated yet.",
    effect_on_burn_receipts: "Pinned at initialize_token (review-3 M-3): a later cpConfigId change cannot redirect register_pool (only replace_pool uses the platform's current cpConfigId, after 7 continuous days of a dead pool); platformCpCreator / scales and (LAUNCHPAD-PATH §35) platformLockNftWallet = FEE_KEYS with scales 1,000,000/0/0 are checked at init. Changing them between a token's init and its migration can still strand the registration (recovered with set_registration_policy, 48 h, until the platform sunset) or send that migration's Fee Key — and so its LP fees — to another wallet (the LP itself stays locked; the fees then never reach the burn pool). Since lp-lock blind review r2 (RL-3) such a coin fails closed: register_pool requires the FEE_KEYS-held migration position to be recorded, so its pool is never verified and no buyback runs on it; and initialize_token pins only the operator's compiled BURNTICKER_PLATFORM, whose admin key is the operator's (to move under the Squads vault). LAUNCH GATE (re-check R3-3): immediately before LaunchLab's create the launcher re-reads platformCpCreator, the scales, platformLockNftWallet and cpConfigId and refuses on any difference (`burnreceipts-admin.mts verify-platform-pins --mint`).",
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
md += `Only **${register.privileged_powers.length}** instructions need a privileged signer: ${register.privileged_powers.map((n) => `\`${n}\``).join(", ")}. The config authority's are limited to a token's attester set and the stranding-recovery registration switch (until the platform sunset). The platform authority no longer holds a cap-raise power. The program refuses every cap raise (propose_cap_raise, cancel_cap_raise and apply_cap_raise refuse with CapRemoved: owner decision 2026-10-25 removed the burn-pool cap and the cranker allowlist); it can still renounce and clear the unused cranker list; any one current attester may veto a pending registration-policy proposal. Every proposal waits 48 hours in public; both authorities can renounce.\n\n`;
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
