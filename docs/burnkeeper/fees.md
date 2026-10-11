# $DEFICIT on Raydium LaunchLab — who gets what, before and after graduation

Written 2026-10-09 for the owner's fee-routing decision. Every number below was read from the pinned SDK (`@raydium-io/raydium-sdk-v2`
0.2.74-alpha, byte-identical to the GitHub master for every file cited), Raydium's docs (docs.raydium.io, read 2026-10-09) and the
live config accounts on both clusters (decoded with the SDK layouts — `scripts/burnkeeper-launch.mts` prints the same table from the
chain each time it runs). Rates on chain are **parts per million of volume** (`FEE_RATE_DENOMINATOR = 1_000_000`); 100 ppm = 1 bp.

The one-line version: **the burn pool is funded by the "creator" slot, and the LaunchLab creator is the burn program's FEE PDA for the
mint (`["fee", mint]` under burn_receipts — `src/lib/burnReceipts/pda.ts`) on both sides of graduation; the developer (Burnticker) is
paid by the "platform" slot; Raydium takes its fixed cut; nothing is routed to a human by hand and no hot key ever holds the fees.**

> **Correction, later on 2026-10-09 (blind program review, finding H-2).** The first version of this page and of the launch CLI made the
> *keeper's hot key* the creator. That breaks the program: `register_pool` only accepts a CPMM pool whose `pool_creator` is the fee PDA
> (Raydium's migration copies the LaunchLab `creator` verbatim), so a keeper-creator token could never register its pool, no buyback
> crank would ever run, and SOL forwarded to the fee PDA would be stranded (the program has no withdraw path). With the fee PDA as
> creator the post-graduation leg flows on its own (`collect_creator_fee_permissionless`: any payer, destination pinned to the creator's
> ATAs, verified in raydium-cp-swap@b3187ae5), and the bonding-curve leg needs one program instruction — a permissionless
> `claim_launchlab_creator_fee` that CPIs LaunchLab's `claim_creator_fee` with the fee-PDA seeds and a destination constrained to the fee
> PDA's WSOL ATA — which the program builder is adding. Everything below reflects the corrected routing; `src/lib/burnKeeper/burnPool.ts`
> is the code.

## 1. The fee layers and their dials

### Phase 1 — the bonding curve (LaunchLab program)

Each buy or sell charges up to four **independent, additive** rates on the quote amount (SOL). The SDK sums them and splits the fee
pro rata (`src/raydium/launchpad/curve/curve.ts`, `Curve.totalFeeRate` and `Curve.splitFee`, lines 468–504); the docs state the same
formula (`platform-config` → "Fee mechanics": `trade_fee = amount_in × global_config.trade_fee_rate / 1e6`, `platform_fee = … ×
platform_config.fee_rate`, `creator_fee = … × platform_config.creator_fee_rate`).

| Layer | Dial | Who sets it | Range | Live value | Recipient | Claim |
|---|---|---|---|---|---|---|
| Raydium protocol | `GlobalConfig.tradeFeeRate` | Raydium | fixed | **2,500 = 25 bps** (mainnet SOL config `6s1xP3…`; devnet `7ZR4zD…` the same) | `GlobalConfig.protocolFeeOwner` (`rayvTL…`) | Raydium's `collect_fee` |
| Platform (developer) | `PlatformConfig.feeRate` | the platform admin, at `create_platform_config` / `update_platform_config` | **0 … 50,000 ppm (0 … 500 bps)**; cap enforced on create (`PlatformParams::check` → `InvalidInput`) and update (`InvalidPlatformInfo`) — docs `platform-config` → "Rate caps" | Raydium's own platform `4Bu96…`: 7,500 = 75 bps | the platform's fee vault PDA `[platform_config, quote_mint]`, claimed by `PlatformConfig.platformClaimFeeWallet` | `claim_platform_fee` (per pool) or `claim_platform_fee_from_vault` |
| Creator = **the burn pool** | `PlatformConfig.creatorFeeRate` | the platform admin — **per platform, not per launch** | **0 … 5,000 ppm (0 … 50 bps)**; `MAX_CREATOR_FEE_RATE = 5000` (docs `platform-config`, states/platform_config.rs) | Raydium's platform: 500 = 5 bps | the creator's vault PDA `[creator, quote_mint]` under the LaunchLab program, **creator = the burn program's fee PDA**; only the creator can claim (`claim_creator_fee`, `creator` is a signer — SDK `instrument.ts` 1028–1055) | the burn program's permissionless `claim_launchlab_creator_fee` (CPI with the fee-PDA seeds → the fee PDA's WSOL ATA; `burnPool.ts` builds it from the IDL once it lands, and refuses to send its placeholder before). The keeper's own key-signed `claimCreatorFeeIxs` remains in `launchlab.ts` only as the byte-verified reference |
| Referral | `shareFeeRate` argument of each swap | the trader's front end, per transaction | 0 … `GlobalConfig.maxShareFeeRate` (10,000 = 100 bps) | we pass 0 | `shareFeeReceiver`, paid in the trade | none needed |

Two clarifications the owner asked for:

- **The creator share is not a slice of the platform share.** They are two separate rates on volume, each with its own cap. The
  creator slot can be 0 and it can be its full 50 bps while the platform slot is anything from 0 to 500 bps. What it cannot be is
  "100% of the platform portion" — the program has no such routing; the most the creator slot can carry is 50 bps of volume.
- **The creator is recorded, not a signer.** `initialize_v2` account 2 is `creator` with no signer flag ("Recorded as
  pool_state.creator; not a signer" — docs `instructions`; SDK `instrument.ts` 135–240, `isSigner: false`). That is what makes a **PDA
  creator** possible: the owner's funded wallet pays, and the fee PDA's address is written in as creator (devnet simulation with a PDA
  creator: `InitializeV2` + `BuyExactIn` success, 188,143 CU, 2026-10-09).

### Migration

When the curve fills (`totalFundRaisingB` raised), LaunchLab's migration wallet (`GlobalConfig.migrateToCpmmWallet`, `RAYpQb…`)
moves the raise plus the reserve (`supply − totalSellA − totalLockedAmount`) into a Raydium CPMM pool created through the CPMM
program's permissioned path, with `enable_creator_fee = true` and `creator_fee_on` taken from the launch's `cpmmCreatorFeeOn`
(docs `cpmm/fees` → "Creator fee"; SDK `layout.ts` `LaunchpadPool.cpmmCreatorFeeOn`). The CPMM pool's `pool_creator` is **the launch
creator when `PlatformConfig.platformCpCreator` is the default pubkey**, otherwise that configured key (docs `launchlab/creator-fees`
→ "Post-migration"; `tips-and-gotchas/redistribute-creator-fees`). Raydium's own platform leaves it default on both clusters (read
2026-10-09); ours does too, so `pool_creator` = the launch creator = **the burn program's fee PDA** (review H-2; `register_pool` refuses any
other `pool_creator`).

The LP tokens minted at migration are split by the platform's `migrateCpLockNftScale`: `platformScale + creatorScale` of the LP is
locked into **one Fee Key NFT owned by `PlatformConfig.platformLockNftWallet`**, the `burnScale` share is burned. `creatorScale` must
be 0 on any config created or updated today (the program asserts it) — since the 2026-08-17 upgrade **no creator Fee Key exists**;
the creator's old LP-fee right became the platform's (docs `tips-and-gotchas/lp-fee-distribution`). Raydium's platform stores
`(0, 100,000, 900,000)` from before the change: 10% of the LP goes to Raydium's NFT wallet, 90% is burned.

### Phase 2 — the CPMM pool (Raydium CPMM program)

| Layer | Dial | Range | Live value (mainnet `AmmConfig` index 0 `D4FPEru…`, the tier Raydium's platform binds to) | Recipient | Claim |
|---|---|---|---|---|---|
| Trade fee | `AmmConfig.tradeFeeRate` | per tier; the platform chooses the tier with `cpConfigId` (`PlatformConfig.cpswap_config`) | 2,500 = 25 bps; other tiers 30 / 50 / 100 / 150 / 200 / 250 bps (`api-v3.raydium.io/main/cpmm-config`) | split below | — |
| → protocol | `AmmConfig.protocolFeeRate` (of the trade fee) | fixed per tier | 120,000 = 12% of the trade fee = 3 bps | Raydium | `collect_protocol_fee` |
| → fund | `AmmConfig.fundFeeRate` (of the trade fee) | fixed per tier | 40,000 = 4% = 1 bp | Raydium | `collect_fund_fee` |
| → LP holders | the remainder, stays in the vault (k grows) | 84% of the trade fee = **21 bps** | the Fee Key holder gets `(platformScale + creatorScale)/1e6` of it; the burned LP's share is unclaimable ("no wallet can claim the fees represented by the burned share" — docs `fee-reference`) | platform NFT wallet | LP-Lock "Burn & Earn" harvest (Raydium UI) |
| Creator fee = **the burn pool** | `AmmConfig.creatorFeeRate` × `PoolState.enable_creator_fee` | **fixed per tier; the platform cannot raise it** — every mainnet tier carries 500 = **5 bps**; devnet tier 0 carries 2,500 | 5 bps of volume, on the SOL side when `creator_fee_on = OnlyTokenB` (our default) | `PoolState.creator_fees_token_0/1` counters → `pool_creator` = the fee PDA | `collect_creator_fee_permissionless` (`src/lib/burnKeeper/creatorFees.ts`, the SDK's `collectCreatorFeePermissionlessInInstruction`, `cpmm/instruction.ts` 594–636): any payer, `creator` pinned to `pool_creator`, destinations = the creator's ATAs created by the program (`init_if_needed`) — the fee PDA's `fee_wsol` / `fee_tokens`, which `crank_buyback` spends and burns |
| → protocol share of the creator fee | `AmmConfig.creatorFeeShareRate` (or a `CreatorFeeShare` PDA for this creator) | per tier | 50,000 = **5% of the creator fee** on `D4FPEru…` (0 on devnet tier 0) | Raydium, taken at collection | — |

So after graduation the burn pool's take is **4.75 bps of CPMM volume** (5 bps × 95%) under Raydium's tier 0, and no platform dial
changes that. The platform's post-graduation take is the LP fee on its locked share: 21 bps × `platformScale/1e6` on the 25 bps
tier (up to 84 bps × share on the 100 bps tier), harvested through the Fee Key, not through our keeper.

## 2. The split per 1 SOL of volume (what `burnkeeper-launch.mts` prints as `feeSplitPer1SolVolume`)

### A. $DEFICIT launched under **Raydium's default platform** (`4Bu96…`), creator = the fee PDA

| Phase | Raydium | Raydium's platform | **Burn pool (fee PDA)** | Nobody |
|---|---|---|---|---|
| Curve, per 1 SOL | 25 bps (0.0025 SOL) | 75 bps (0.0075 SOL) | **5 bps (0.0005 SOL)** | — |
| CPMM, per 1 SOL | 4 bps trade-fee shares + 0.25 bp of the creator fee | 2.1 bps (10% of the 21 bps LP fee, via its Fee Key) | **4.75 bps (0.000475 SOL)** | 18.9 bps (burned LP's share of LP fees) |

Developer (Burnticker) take in this case: **0**. The owner can still launch this way with nothing to set up (no platform config), at
the cost of the burn pool getting 5 bps on the curve instead of 50 and Raydium's platform keeping 75.

### B. $DEFICIT launched under **our platform** (the CLI's defaults since 2026-10-10: dev 25 bps, burn pool 50 bps, LP 100% locked to the burn program's fee-keys PDA)

| Phase | Raydium | **Burnticker (platform wallet / operator treasury)** | **Burn pool (fee PDA)** | Nobody |
|---|---|---|---|---|
| Curve, per 1 SOL | 25 bps | **25 bps (0.0025 SOL)** | **50 bps (0.005 SOL)** | — |
| CPMM, per 1 SOL | 4 bps + 0.25 bp | **4.2 bps** (20 % of the locked LP's 21 bps, by `claim_lock_fees`, to the operator treasury) | **4.75 bps + 16.8 bps** (the creator fee + 80 % of the locked LP's fees) | — |

LP locked forever (owner decision 2026-10-10; the earlier design burned it all and sent 21 bps to nobody): `platformScale` 1,000,000 puts
the whole LP behind one Fee Key, the platform's lock-NFT wallet is the burn_receipts `["fee_keys"]` PDA, and the permissionless
`claim_lock_fees` splits what the Fee Key collects 80/20 by compiled constants (`src/lib/burnticker/lockFees.ts`).

Total curve fee: **100 bps**, the LaunchLab norm (Raydium's own is 105). The CLI prints exactly these legs from the live configs.

## 3. The option space (the dials, not a guess)

| Dial | Who | Allowed | Effect |
|---|---|---|---|
| `PlatformConfig.feeRate` — the developer slice on the curve | us | 0 … 500 bps, 1 bp steps (ppm) | **25 bps is exactly 2,500 ppm.** |
| `PlatformConfig.creatorFeeRate` — the burn-pool slot on the curve | us | 0 … 50 bps | 50 bps is the hard cap. |
| `cpConfigId` — the post-graduation fee tier | us | any CPMM `AmmConfig` (25/30/50/100/150/200/250 bps trade fee; all with a 5 bps creator fee) | sets the LP fee the Fee Key earns; the burn pool's 5 bps does not move. |
| `migrateCpLockNftScale.platformScale` | us | 0 … 1,000,000 (`creatorScale` must be 0; the rest is burned) | the share of post-graduation LP fees that reach the developer wallet; 0 = "no insiders", all LP burned. |
| `platformCpCreator` | us | default = launch creator, or any key | **leave default**: that is what makes the launch creator — the fee PDA — the CPMM creator-fee beneficiary. |
| `cpmmCreatorFeeOn` | per launch | `OnlyTokenB` (SOL side) or `BothToken` | keep `OnlyTokenB` so the burn pool receives SOL only (token-side fees would land in the fee PDA's token account and be burned by the next `crank_buyback` — correct but not cash). |
| `shareFeeRate` | per trade | 0 … 100 bps | front-end referral; we pass 0. |
| `platformVestingScale` | us | 0 … | a platform slice of any locked share; 0. |

**Recommendation to decide on:** `feeRate` 2,500 (25 bps, the owner's number), `creatorFeeRate` 5,000 (the 50 bps cap: the burn pool is
the largest curve slice — twice the developer's and Raydium's), `cpConfigId` tier 0 (25 bps; the curve crowd expects the cheap tier
after graduation), `platformScale` 1,000,000 with the lock-NFT wallet = the burn program's fee-keys PDA (owner decision 2026-10-10,
replacing `platformScale` 0: LP locked forever, its fees fund the burn — 80 % to the burn pool, 20 % to the operator, fixed in code).

## 4. What the keeper does with each slot (the keeper only PAYS; the fee PDA receives)

- **Curve creator vault** (phase 1, and any balance left after graduation): in **program execution** (`BURNKEEPER_EXECUTION=program`,
  the launch path; docs/burnkeeper/README-execution.md §2 step 4) the keeper calls the burn program's permissionless
  `claim_launchlab_creator_fee` best-effort whenever a burn day is pending — no flag needed (payer = the keeper; `fee_vault` = the PDA
  whose seeds sign the CPI; destination `fee_wsol` = the PDA's WSOL ATA; LaunchLab's `[fee PDA, WSOL]` vault and its authority;
  `burnPool.ts` `claimLaunchlabCreatorFeeIx`, built from the program's IDL, which carries the instruction since 2026-10-09).
  `BURNKEEPER_CLAIM_CREATOR_FEES=1` is a **legacy-execution flag only**, and the legacy leg refuses to run with it for a fee-PDA token.
- **CPMM creator counters** (phase 2): program execution, same cycle, builds the plan in `creatorFees.ts` (the legacy leg
  reached the same plan through `solanaChain.ts` `claimGraduatedCreatorFees()`): read the LaunchLab pool (its creator must be the fee PDA), its platform config (`platformCpCreator` default or the fee PDA), derive the CPMM
  pool from `(cpConfigId, token0, token1)` in byte order (both orders checked), decode it (`pool_creator` must be the fee PDA,
  `enable_creator_fee` true, counters > 0), then ONE instruction — `collect_creator_fee_permissionless` with the keeper as payer and the
  fee PDA as creator — simulated first. The SOL side lands as WSOL in the PDA's `fee_wsol` (counted by `crank_buyback` as pool and spent
  from there); a token side (only with `BothToken`) lands in `fee_tokens`, which the crank burns. Nothing is unwrapped; nothing touches
  the keeper's wallet.
- **Consequence for the old keeper buyback** (`cycle.ts` buyback mode, Jupiter swap from the keeper's wallet): its "fee pool" was the
  keeper's SOL balance, which under this routing receives no fees. The program's `crank_buyback` (`src/lib/burnReceipts/crank.ts`) is the
  successor for the swap-and-burn leg; since 2026-10-10 the keeper drives it (`BURNKEEPER_EXECUTION=program`) and the Jupiter leg is
  deprecated (README-execution.md §1).
- **Platform fee** (the developer's): claimed by `BURNTICKER_FEE_WALLET`'s owner through Raydium's UI or `claim_platform_fee_from_vault`;
  not the keeper's business. **Locked-LP fees** (since 2026-10-10): the Fee Key holder is the burn program's fee-keys PDA, so nobody harvests them in Raydium's UI;
  the keeper cranks the permissionless `register_fee_key` once and `claim_lock_fees` ahead of each buyback crank
  (`src/lib/burnticker/lockFeesKeeper.ts`): 80 % lands in the fee PDA (spent by the next crank), 20 % in the operator treasury.

## 5. Verified how

- **Byte-for-byte against the SDK's builders** (unit tests, `test/burnKeeperLaunch.test.ts`, `test/burnKeeperCreatorFees.test.ts`):
  `claim_creator_fee` and `claim_vested_token` as the keeper hand-encoded them equal the SDK's `claimCreatorFee` / `claimVestedToken`
  on both clusters (kept as the reference; the keeper no longer sends the key-signed claim — the creator is a PDA); the post-graduation
  claim is built directly from the SDK's `collectCreatorFeePermissionlessInInstruction` and checked against it; the program's
  `claim_launchlab_creator_fee` builder is tested in both states (no IDL entry → fake; IDL entry → the IDL's bytes and order).
- **Simulated against the live programs, nothing sent** (`solana simulateTransaction`, `sigVerify: false`, 2026-10-09):
  - devnet `initialize_v2` + first buy, Raydium's devnet platform: success, 195,643 CU; vault mode (25% locked, 365-day) `initialize_v2`:
    success, 109,829 CU;
  - devnet `create_platform_config` with `fee_rate 2500, creator_fee_rate 5000, (0, 0, 1_000_000)`: success, 28,243 CU (the program
    logged our `PlatformParams` back);
  - mainnet `initialize_v2` + 0.5 SOL first buy on the real 85 SOL curve, payer simulated as Raydium's migration wallet: success, 193,522 CU;
  - the claim paths against real mainnet launches: see §6.
- **Not run**: no transaction was sent on any cluster (the public devnet faucet returned 429 for every amount on 2026-10-09). The
  exact owner commands are in `docs/burnkeeper/devnet-run.md`.

## 6. Claim-path simulations on mainnet (read-only, 2026-10-09)

Both keeper claim paths were run through `simulateTransaction` (`sigVerify: false`) on mainnet **as other people's creators**, against
their live accounts — the program executes the instruction and reports; nothing was signed or sent and nothing moved.

| Path | Subject | Result |
|---|---|---|
| curve `claim_creator_fee` (`launchlab.ts` `claimCreatorFeeIxs`, the keeper's hand-encoded bytes) | Beeker's creator `BFfuhB…`, vault `71R3UQ…` holding 7,270,809 lamports | `ClaimCreatorFee` success, 26,745 CU |
| same | Vlkxftr's creator `4ifxBN…`, vault `6C97Ui…` holding 14,606,530 lamports | success, 29,819 CU |
| CPMM `collect_creator_fee` (`creatorFees.ts` `planGraduatedCreatorFeeClaim` → the SDK's `makeCollectCreatorFeeInstruction`) | graduated LaunchLab pool `CheJUxVQrmpeb4UFWHZ72afQPTKM7AEb8giyzNR7cPvH` (mint `D1YZZg…`, `pool_creator` `B5RNqY…`), 74,085,280,766 lamports (74.09 SOL) accrued on the SOL side | the plan's derived pool id equalled the live pool id (byte-order derivation confirmed); `CollectCreatorFee` success, 48,296 CU |
| CPMM, two pools whose platforms set `platformCpCreator` to the platform wallet (`5CEbue…`, `6hGmRw…`) | — | the plan **skipped** them ("the launch creator is …, not the burn pool's fee PDA") — the guard that keeps the keeper from building a claim the pool would not pay to the burn pool |
| **CPMM `collect_creator_fee_permissionless`** (the corrected path: `creatorFees.ts` plan with `burnPool` = that pool's `pool_creator`, **payer = Raydium's migration wallet, not the creator**) | the same graduated pool `CheJUx…`, 74,088,633,068 lamports accrued | one instruction, 16 accounts, destination = the creator's WSOL ATA; `CollectCreatorFeePermissionless` success, 46,356 CU |
| devnet `initialize_v2` + buy with the **fee PDA as creator** (the launch CLI's new default) | Raydium's devnet platform, 1 SOL raise | success, 188,143 CU — the program records a PDA creator without complaint |

Mainnet pools created by LaunchLab migration carry `creator_fee_on = 1` with WSOL as token 0, i.e. the fee on the SOL side — what
`cpmmCreatorFeeOn = OnlyTokenB` becomes after the CPMM program's byte-order sort.
