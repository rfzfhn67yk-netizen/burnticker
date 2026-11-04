# Devnet rehearsal run log — 2026-10-10 (Saturday)

Run by Claude (agent) on the Mac, worktree `mct-wt-DEVNET`, branch `agent/DEVNET-2026-10-10` (base `0290964`), following
`docs/burnticker/REHEARSAL-RUNSHEET.md` §A with the D-table defaults (D-6: `initialize_platform` skipped; D-7: one program id).
Devnet only: every command carries `--url https://api.devnet.solana.com` / `--cluster devnet`. Keys are throwaway devnet keys in
`~/.config/meme-coin-trader/devnet/`. Times are America/Denver. Explorer: `https://explorer.solana.com/<tx|address>/<x>?cluster=devnet`.

Toolchain: Solana CLI 4.3.0, Anchor 1.2.1, `squads-multisig-cli` 0.1.7 (installed for this run with
`cargo install squads-multisig-cli --version 0.1.7 --locked`, ~3 min), Docker absent (no verifiable build — not needed on devnet).

## Starting balances (09:52)

| key | pubkey | SOL |
|---|---|---|
| deployer | `ED2FxCzefc1pi2M2JxAAgYNAce2LcNVh1QPQ3aJzCBGR` | 6.99998 |
| payer | `Bfy67FZExj33ihNN9HDEH9KwLAPR6kW9tWAzvdXqssvx` | 2.4 |
| keeper | `D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn` | 1 |
| mint | `4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F` | 0 |
| squads-a | `HUWbm4CnrTfe4MLwpFhstTJFVyrj4FNuTidMzEBoiHfb` | 0.5 |
| squads-b | `58w9pN56qGxuNcnhUrTXgte2mbRNNf4QSAun3ASaLwxd` | 0.1 |
| squads-c | `Bymx5VmL5Fi1A1EBJWXrcoeNUKARUvYjxKkHAqJ3H4wQ` | 0 |
| devfee | `3s97xfWwH5qwPjqrmjHwPobZ3Z6oxWMQm2CDVQoA5pZp` | 0 |

## A3 — program id + devnet build (09:52–10:05)

- Program id keypair created at `~/.config/meme-coin-trader/mainnet-keys/burn_receipts-program.json` (mode 600, dir 700; secret never
  printed). **Program id `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM`** (the one id for devnet and mainnet, D-7).
- Copied to `programs/burn-receipts/target/deploy/burn_receipts-keypair.json` (gitignored), `anchor keys sync`.
  - Deviation: `anchor keys sync` rewrote `Anchor.toml` (dropped every comment, reordered sections, and updated only
    `[programs.localnet]`, leaving `[programs.devnet]` on the old id). Restored the file and replaced the id in both sections by hand;
    the header comment now says the id is the real one.
- `anchor build -- --features devnet` → exit 0 in 2 min; `target/deploy/burn_receipts.so` = **700,496 B** (the sheet's "≈ 617 KB" is
  out of date; rent ≈ 3.559 SOL), sha1 `9443bcec…`.
- IDL: the `--features devnet` build writes the devnet LaunchLab id (`DRay6f…`) into the IDL as a PDA program constant. The committed
  `src/lib/burnReceipts/idl.ts` was cluster-neutral (mainnet `LanMV9…`) before, so it was regenerated from a default-feature
  `anchor idl build` (the .so was untouched, same sha1) — the only IDL change committed is the address. The TS client passes the
  LaunchLab accounts per cluster explicitly (`LAUNCHLAB_PROGRAM_ID[cluster]`), so it does not depend on the IDL constant.
- `node scripts/sync-idl.mjs && node scripts/powers-register.mjs`; `npm test` → 5,099 pass, 0 fail, 5 skipped (no test pins the old id).

## A4 — deploy (10:00)

```
solana program deploy programs/burn-receipts/target/deploy/burn_receipts.so --program-id programs/burn-receipts/target/deploy/burn_receipts-keypair.json \
  --upgrade-authority $D/deployer.json --keypair $D/deployer.json --url https://api.devnet.solana.com --with-compute-unit-price 10000
```

- Signature (DeployWithMaxDataLen) `5nRYafJtNRMWAr6o1YS4zsVfremBaBYejYdMtj7uPPacrTdS3HGsL6JAenuTog8w16bdDh76tjjqZMxmvNd1vZqS` (10:00:44).
- `solana program show`: ProgramData `CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn`, Authority = deployer `ED2Fx…CBGR`, Data Length 700,496,
  balance 3.5594 SOL. Deployer spent ≈ 3.564 SOL (6.99998 → 3.43606).
- Sheet nit: `solana program show <id> --url devnet` (A4b/A7b) fails on this Mac with "No default signer found" (there is no
  `~/.config/solana/id.json`); add `--keypair $D/deployer.json`.

## A5 — Squads 2-of-3, 60 s time lock (10:01–10:02)

`squads-multisig-cli` 0.1.7 asks "Do you want to proceed?" through dialoguer, which needs a TTY: each call was run as
`(sleep 3; printf 'y\n') | script -q /dev/null squads-multisig-cli …`. Squads v4 on devnet (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`),
program-config creation fee 0.

- Sheet bug (A5 and B3): `--members A,7 B,7 C,7` is refused ("unexpected argument"); the CLI takes **one `--members` per member**:
  `--members A,7 --members B,7 --members C,7`.
- multisig-create: **multisig `GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w`**, sig `5MHGH5RvrUKmz7umctABpZRCSZi845rywnEcRvv2a7ThLTp5tJKZawx7aM4nBRA1LUNEkNJCkUYXEQfr6pfQDJ2S`.
- config tx 1 `SetTimeLock 60`: create `33oWp4bpLZQSHk8hDSSRFN54W6s25Xq9aRxx4MgjrdYxj7pa11PPwU6meqUm3reDZFpGHJEpkxz8BXZqYDMv5CM5`,
  approve A `3XcAJ9hfLguBFvZShRXbnJ5nAVnKuxKpfu9JdcS8AfXGBykZQ8nzxintc68W6jyQBRTqxgyPYuTQuo6JnkmDVwMD`,
  approve B `2Ri5xA4GdaSv31f3ayeDw5ipR3VPm2FmG1At7VGHzLd7X2x8S9ZxoNQ2VJ8puWS8xeQQxDzH7u4dgULj6zx7EZ9m`,
  execute `xrU1qHFmhQAyiPf9hzhbTv6xtNuLdpxKuxi61JLN8GmjhZbmcJkWhoGfojzs616SCw5XYLkaAdAu1oLyoaw3RXF`.
  Read back from the account: threshold 2, time_lock 60, config_authority none (autonomous), transaction_index 1.
- `display-vault --vault-index 0` (no RPC needed): **vault `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD`**.
- A6 (`initialize_platform`) skipped per D-6.

## A7 — upgrade authority → the vault (10:02)

`solana program set-upgrade-authority … --new-upgrade-authority A8VV…MffD --skip-new-upgrade-authority-signer-check` →
sig `2WXsrxWqzz1bCnp2a1sJCHw6HexyeGTh6Rn21UUUvHAE1Hz1pGDa7LBpE78TnHjSGju3Se2nXqsTLawHJmBATeeG` (the CLI printed no signature; read
from the ProgramData account's history). `solana program show` → `Authority: A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD`.

## A8/A9 — devnet rules copy + sha (10:03)

- `config/burnkeeper/deficit.devnet.rules.json` = the committed file with `"mint": "4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F"`
  (jq; only `mint` differs). The mainnet file is untouched (sha256 still `0b4d09946e226bdb…`).
- `BURNKEEPER_RULES=config/burnkeeper/deficit.devnet.rules.json … burn-keeper.mts --print-rules` →
  **sha256 `b9ad29b48ef13548e18674dca770a554b0f96e1924fcf70fdd378225689d8884`** (= `shasum -a 256`).

## A10 — our devnet LaunchLab platform (10:03–10:04)

`burnkeeper-launch.mts platform --cluster devnet --admin $D/payer.json --fee-wallet 3s97…5pZp (devfee) --web https://burnticker.com
--img https://burnticker.com/brand/avatar.png` (dry run, then `--send`):

- dry run: dials fee 2,500 ppm (25 bps to devfee), creator 5,000 ppm (50 bps burn pool), platformScale 0 / creatorScale 0 /
  burnScale 1,000,000 (all LP burned), cpConfigId `5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy` (devnet AmmConfig index 0: trade 25 bps,
  creator 25 bps, share 0), `problems: []`, simulation ok 26,520 CU.
- send: **platformId `GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf`**, sig
  `5sAHZSKmid2sJ4nv4jBNszEqoTsvhRr3GRE4uW1y6MYuCDTxq7jex1G7a4QudGjZZXUxue9g4cnb6SN2CqvWgdwt`.

## A11 — initialize_token (10:04–10:08)

`burnreceipts-admin.mts initialize-token --cluster devnet --program AuQj…zhMM --payer $D/payer.json --mint $D/mint.json --creator
$D/payer.json --admin A8VV…MffD --attester D8se…ktbn (keeper) --quorum 1 --launchlab-platform GvSK…v3tf --floor-lamports 1000000
--twap-window 1200 --twap-deviation-bps 300 --rules config/burnkeeper/deficit.devnet.rules.json` (dry run, then `--send`).

- Tool bug found and fixed (commit 92c5a1e): after `anchor keys sync` the IDL's address IS the real id, and the "localnet
  placeholder" check compared against the IDL's address — the admin CLI warned "using the IDL's LOCALNET test id" while using the
  real id, and `burnkeeper-launch.mts launch --send` would have **refused** the real program id (`programIdIsLocalnetPlaceholder`).
  The placeholder is now the retired test key `GV9CMj…SuF8`; the launch CLI still refuses `--send` when no program id is given.
- dry run: simulation ok 31,586 CU. send: sig `2qV3SuXeYJaxCxZ3fb8rVaobrGH7cJECToCjWKFcxC5frZzfy4tqKLUWY27Ngqkmer3TNZxu2Zce7czPFz1cgFGe`.
- Read-back: **TokenConfig `FqfwxFKaiLRaK1HAsBsRRkXAq3nzbEt92fX9qWQTZYPh`**, **fee PDA `3J2B6wquyN35esxJuWyT6xMmxv52yMrmfBmBozqJTF9a`**
  (0.02 SOL reserve), rules_sha256 = A9, attesters = [keeper D8se…ktbn], quorum 1, admin = vault A8VV…MffD, cluster_genesis
  `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (devnet), rule twap 300 bps / 1,200 s, slippage 300, floor 1,000,000, reserve
  20,000,000, fraction 100 bps/unit; pins ll_platform GvSK…v3tf, ll_cp_config 5MxL…s7wy, ll_lock_scale_ppm 1,000,000.

## A12 — verify-platform-pins, LaunchLab create (10:08–10:09)

- `burnreceipts-admin.mts verify-platform-pins --cluster devnet --program AuQj…zhMM --mint 4Qnw…AM4F` → exit 0, `ok: true`,
  `mismatches: []`: owner = devnet LaunchLab `DRay6f…`, cpConfig as pinned, platformCpCreator = default (allowed: default or the
  fee PDA), scales [0, 0, 1,000,000], lock/burn scale 1,000,000. **LaunchLab's devnet platform semantics matched the pins.** Run again
  immediately before the send (exit 0).
- Devnet LaunchLab GlobalConfig `7ZR4zD7PYfY2XxoG1Gxcy2EgEeGYrpxrwzPuwdUBssEt`: `minFundRaisingB` = **1 lamport** (mainnet: 24 SOL),
  tradeFeeRate 2,500, migrateFee 0. The sheet's `--raise-sol 1` was kept.
- `burnkeeper-launch.mts launch --cluster devnet --payer $D/payer.json --mint-keypair $D/mint.json --rules
  config/burnkeeper/deficit.devnet.rules.json --name DEFICIT --symbol DEFICIT --uri https://burnticker.com/deficit-devnet.json
  --raise-sol 1 --first-buy-sol 0.1` with `BURNTICKER_PROGRAM_ID`/`BURNTICKER_PLATFORM_ID` exported. (The `--uri` does not resolve;
  devnet only.)
  - dry run: creator = fee PDA 3J2B…TF9a, `creatorIsFeePda: true`, `placeholder: false`, platformId GvSK…v3tf, rules sha = A9,
    warnings/problems `[]`, simulation ok 193,681 CU.
  - send: sig `4EJwd2yrKfKBh6V8rD2LFFaq7q8NhTaeCGpLJDsZUfu25M6sgJpdrGWQjR9zcHU7YoeWhJvoN5z3Z1J2YxvGCM6D` (10:09:35).
  - **LaunchLab pool `8etFJShXbrpNmQm16z7ctCQXzyffiB5rJc2yUb8PssR5`**, creator-fee vault `EgDQu9RWYJNK5yxZhk9c1M7jVAZodUUbc7FpUTggQfnQ`,
    platform-fee vault `AzXYBNjojqRJfPnwASTTrikTWYWcuBW2UYszXFW1QptE`, predicted CPMM pool `5RoGVSCTBmcTSXdUgoktteBAi5sXTrax7QiJ6rh8hNyR`.

## K1 (sheet A13) — mint / freeze authority (10:09)

Probe (block P): `mintAuthority: null`, `freezeAuthority: null`, supply 1,000,000,000.000000, decimals 6. **PASS** (re-read null/null at K4).

## Seed (sheet A14) — 0.5 SOL into the fee PDA (10:10)

`solana transfer 3J2B…TF9a 0.5 --allow-unfunded-recipient --keypair $D/payer.json --url https://api.devnet.solana.com` →
sig `4PNghxJUc5iwz7GEh8GPkd9WbV9miR2YbxqQnAQBWhAnnzoJX9GWkUoofqzD2xPCZjK1UBqnuTxSCWrKoGUgQUtA`; fee PDA 0.52 SOL.

## K2 (sheet A16) — claim_launchlab_creator_fee against the REAL devnet LaunchLab (10:10)

Before: creator-fee vault 0.0005 WSOL (the first buy's 50 bps), fee WSOL ATA `4VcsuCXw3sQqWm4Sv36X7hwkup9owSXcjThwSibtCTzk` absent.
`burnreceipts-admin.mts claim-launchlab-creator-fee --cluster devnet --program AuQj…zhMM --payer $D/keeper.json --mint 4Qnw…AM4F`:
dry run simulation ok 60,309 CU (CPI `DRay6f… ClaimCreatorFee` success); send sig
`5aqJratWm9sqDAGojkBr4A9GhHAptx9C4NZov9gBTfiC7r6pV5XUoCABQisPhDm9XwZeTunW3C2qPbAFMrnweYcu`. After: vault 0, fee WSOL 0.0005.
**PASS.** (The keeper's own cycle later sent the same claim: `33vVy1QY1x5pSzRR5YhpjxAsSwhakjXgTPiy2mFDpjutZB7C8FkRQAxvWT33CamTebVXJDfSS5GEpKhjFyrwRjs7`.)

## Buy to graduate (sheet A17 / task A13) (10:13)

No browser wallet in an agent session: new devnet-only tool `scripts/burnticker-devnet-trader.mts` (refuses any non-devnet genesis;
dry run by default; SDK builders `buyExactInInstruction` / `sellExactInInstruction` / `makeSwapCpmmBaseInInstruction`), payer = $D/payer.json.

| time | action | signature |
|---|---|---|
| 10:13:16 | curve buy 0.3 SOL | `2Fy3MYib9D2GVLbzvFHgARzJHi9do1a1wij5iwP7XVLNCvoQm56pp3xdbJaN93oPAV9uj7KBoN1YDBmYZd1HBXFE` |
| 10:13:26 | curve sell 5% of holdings | `4xtPyhwnnm2Y5zF1QmsMc5qWi3336uVhSu1cWVB18qsAUaE92NwqRTioaeYyKKywNSCF84jByN3yhp4JpwLXx8Cw` |
| 10:13:3x | curve buy 0.3 SOL | `4oyhYHzjwB3kev312iuP19pLPRBqA1akVhf2MyqiDD6AUY4Nhtk5QD1rtzcmm8kVLbC98SSJYZ5JMfUudyxMxXxY` |
| 10:13:50 | curve buy 0.4 SOL (SDK capped it at 0.350286 SOL; realB 1,000,000,001 → status 1) | `Wkz9NFZoYoL3US7SVq1A4JEWrkANQQDT8B8YAkkoHcrq7pjG19BKyYNe7HC2WmXmr6ZPPAZpwPo2i2rxBfdwxgC` |

Fee routing (gate-3 rehearsal): after buy 1 the creator-fee vault held 0.0015 SOL (+50 bps of the 0.3 SOL buy; the first buy's
0.0005 had already been claimed) and the platform-fee vault 0.001 SOL (25 bps of 0.1 + 0.3 SOL). Total curve buys ≈ 1.05 SOL.

## K3 (sheet A18) — devnet migration (10:14)

Raydium's devnet migration wallet `DRayP1Yav394wpS47WQJ5Qm6d95WTQFtGGh54cVQFmhF` ran `MigrateToCpswap` + CPMM `InitializeWithPermission`
**11 s after the graduating buy**: sig `3kbaWR8dQHMUHtAiPKzTZALvBXw7nttmRLb2epLf8xsfoWkfsuVhohgPCNVKg9VagEN3tahbAugSzRdJM5krt34i` (10:14:01).
LaunchLab status 2; candidate `5RoGVSCTBmcTSXdUgoktteBAi5sXTrax7QiJ6rh8hNyR` exists (the other order `8V2A…Ffnfd` does not). **PASS.**

## K4 (sheet A19) — pool provenance (10:14)

Probe with `POOL`: `poolCreator = 3J2B…TF9a = fee PDA` (**creatorIsFeePda: true**), ammConfig = pinned 5MxL…s7wy, `enableCreatorFee: true`,
status 0, **lpBurnedPct 100, lpLockedPct 0** (our platform burns all LP — as designed; mainnet's Raydium platform locks instead), the pool
is the derived candidate PDA, K1 still null/null. Reserves at migration: 1.000000001 SOL / 206,900,000 $DEFICIT. **PASS.**

## register_pool (sheet A20 / task A14) (10:14)

`burnreceipts-admin.mts register-pool --cluster devnet --program AuQj…zhMM --payer $D/keeper.json --mint 4Qnw…AM4F --pool 5RoG…hNyR`:
dry run ok 24,681 CU (accounts include lp_lock_vault `GEWm…ZYE3` and launchlab_pool 8etF…ssR5); send sig
`2yR8kymeZ6tvy2WjM4cffXr6KquCJ6qVTif7m6k7LSHwxzDk2Rm4eJE72r7tz4J5vRAoTqQBrjzBfxgvH58Zc3Sz`; TokenConfig.cpmm_pool = 5RoG…hNyR.

## Keeper once, before the TWAP filled (sheet A15) (10:16)

```
BURNKEEPER_EXECUTION=program BURNTICKER_PROGRAM_ID=AuQj…zhMM BURNKEEPER_SIGNER_PATH=$D/keeper.json BURNKEEPER_MINT=4Qnw…AM4F \
BURNKEEPER_RULES=config/burnkeeper/deficit.devnet.rules.json BURNKEEPER_RULES_SHA=b9ad29b4…8884 BURNKEEPER_DB=data/burnkeeper-devnet.db \
BURNKEEPER_PUBLISH_DIR=data/burnkeeper-devnet-site BURNKEEPER_BASELINE_DATE=2026-10-05 BURNKEEPER_RPC_URL=https://api.devnet.solana.com \
R scripts/burn-keeper.mts --devnet --once
```

The ledger was fresh (no `data/burnkeeper-devnet.db` before). Log, in order: banner `execution program · devnet`; config line
`cluster devnet · EXECUTION program AuQj…zhMM · mode buyback · … · attesters 1 (quorum 1) · pool 5RoG…hNyR` (already registered);
the real Treasury feed (latest record_date 2026-10-08):

| record_date | value | units | submit_reading |
|---|---|---|---|
| 2026-10-05 | $40,249,104,431,078.48 | baseline | `2MoVGRc3UfZQGPKr6EeP25iL81LkJPcWChYkxD7jTFcN5GQTaYySxap89HawK9fothbNHQFXqzfmhWFaGYaV6N3y` |
| 2026-10-06 | $40,273,024,579,219.17 | 23 | `48z66Ct4FSRHN9i9ixohaqGTBjAY6TAdA2kd3sYCFLRX1u9ybDkz21PZGnV12mypy8RvnkQN1D6SfVUiacBkUnry` |
| 2026-10-07 | $40,284,036,147,367.19 | 11 | `63v24yDMcGHh7LT4HD8j3xHk6uZhSJsZuZ1co9jo99rmc4ruCwX2vCZJRRjW7yfi29dSt37CoeHQZ1zZUhngdKSe` |
| 2026-10-08 | $40,305,316,210,829.72 | 22 | `64SV55oiFpAyxhZsh3dqNniH3RxyBCBMhMBAjad3CzubJjEP9cVUEJtJwudJcbjEKr9gZUw3dcgZssjoKr1EECLW` |

Then `[fees]`: program `claim_launchlab_creator_fee` `33vVy1QY1x5pSzRR5YhpjxAsSwhakjXgTPiy2mFDpjutZB7C8FkRQAxvWT33CamTebVXJDfSS5GEpKhjFyrwRjs7`
and CPMM `collect_creator_fee_permissionless` `RHTuiM8b3oRfiooqE3iA5KkmEchgz2N4yy4sLCDimUnv7xXiPyaUFjcz4U8Y9ESZMFA2y3C8Mw4MLN5mya5dtwZ`
(both keeper-paid, into the fee PDA's WSOL); `[pool] check_pool_health: pool tradeable`
`3aKTy5YuQ3CQzYJorxDAbx33rVBKzir9CqjNiz3AzbKFT4UUNsmzX5SCDEHtqhJhweaKHheF2ubypyPrdrsdZZ4W`; `[program] 2026-10-06: crank_buyback deferred by the
program (TwapUnavailable)`. The public devnet RPC answered a few `429`s; web3.js retried them.

## TWAP trades (sheet A21 / task A15–A17) (10:15–10:46)

`burnticker-devnet-trader.mts cpmm-swap` from the payer, alternating a 0.006 SOL buy and a 1,200,000 $DEFICIT sell (≈ 0.0058 SOL)
every 2.5 min, 14 trades, all landed (signatures in `evidence/devnet-2026-10-10/twap-trades.log`). First trade
`4h1afBVG8Mjp4GJfhbxWcNbeugRiBsYD9d2PuXVDUUs8NUdSTNTPC1MxmSEGDgsnv5NfteuWFKtvaoLBJw5BHM3g` at **10:15:28**. (Sizes were kept under the
sheet's 0.01–0.02 because a 0.01 SOL buy moves a 1 SOL pool's price ≈ 2 %, close to the 3 % guard.)

## Keeper loop, program mode (sheet A22 / task A18) (10:17–10:57)

Same environment without `--once`, in the background on the Mac. Cycles:

- 10:16:35 and 10:26:39 — `crank_buyback deferred by the program (TwapUnavailable)` for 2026-10-06 (recorded as a wait).
- **10:36:44 — first burn.** `[program] 2026-10-06: CRANKED · burned · spent 20132384 lamports, got 4010874.872446, burned
  4010874.872446 · PARTIAL — SpendCapBound: spent 20132384 of a 104345230 lamport target, 84212846 carried` — sig
  **`3gBYyBbz5U1MA2Ut71vfzevMCWaBgAX4NjGymghbnhrnBxB94ADeenr3hvKVHrmfJmBy1JHxgY3k2SJNWiDkziVU`** (208,379 CU; one transaction:
  `CrankBuyback` → CPMM `SwapBaseInput` → burn → memo). 21 min after the first CPMM trade.
- 10:36:52, 10:46:56 — 2026-10-07 `deferred (TwapDeviation)`.
- **10:57:02 — second burn.** 2026-10-07: 11 units, spent 20,409,545 of a 135,034,181 target (carry included), burned 3,956,814.908585
  — `WrU2qsjH2c6s2chHDXbip6ZXPCkw8Uka19rQPTJdmCAU33idaZF7UkcbYanhv2bhC58te8nzQW4pTqt1ZzcQbyj`.
- 10:57:10 — 2026-10-08 `deferred (TwapDeviation)`; keeper stopped with SIGINT at 10:57:53 after finishing the cycle. 10-08 (22 units)
  and 114,624,636 lamports of carried spend stay queued on chain for whenever the keeper runs again.
- CPMM creator fees collected on every cycle: `2Tvrwo9oac3YrnKF3Fvg2HvDvTksX4QfN5BH1yc3nJzLFr7YSfQtvLZ9eGiGju8MGLLqywuBtD6ey2Km5EKt2Me2`,
  `2rQtxBHsrapJ1fzMLsxkVydmBAF5xjj1KLPMrN7VDZu34t4ZSh9uF4Mso22MtQ1WZzRhHXwGtZdJsTqo1JeVma2j`.

## Receipt recomputes (sheet A23) (10:40)

- `burns.json`, 2026-10-06: `execution: "program"`, `verified: true`, no failed checks; `status.json .health`: `unverified 0`,
  `lastError null`; `.program.attestation.lastReading` = 2026-10-08 (confirmed); partial noted "0.084212846 SOL carried (2% reserve cap)".
- On-chain memo (from the transaction's logs) is byte-identical to the row's memo:
  `DEBT|2026-10-06|src=fiscaldata.treasury.gov debt_to_penny|prev=40249104431078.48|now=40273024579219.17|delta=23920148140.69|units=23|pool=505583582|spent=20132384|got=4010874.872446|burn=4010874.872446|swap=5RoGVSCTBmcT|rules=sha256:b9ad29b48ef1|v2`.
- Recomputed independently: floor(23,920,148,140.69 / 1e9) = 23; 505,583,582 × (1 − 0.99²³) = 104,345,230 lamports (the row's target);
  2 % of the 1.0066 SOL reserve ≈ 20.13 M lamports (the spend).
- Supply: 1,000,000,000 → 995,989,125.127554 after the first burn → 992,032,310.218969 after the second (−7,967,689.781031 = the probe's
  `totalBurnedRaw`). Final probe: `readings 4`, `burns 2`, `totalSpentLamports 40,541,929`, fee PDA 0.4852 SOL.

## Checkpoints

Sheet numbering (REHEARSAL-RUNSHEET §A):

| | checkpoint | verdict | evidence |
|---|---|---|---|
| K1 | mint + freeze authority null | **PASS** | null/null at create and at K4 |
| K2 | `claim_launchlab_creator_fee` against the real devnet LaunchLab | **PASS** | `5aqJra…`: vault 0.0005 → 0, fee WSOL +0.0005; keeper repeat `33vVy1…` |
| K3 | Raydium's devnet migration runs | **PASS** | `MigrateToCpswap` by `DRayP1Ya…` 11 s after graduation (`3kbaWR…`) |
| K4 | pool provenance: pool_creator = fee PDA, candidate PDA, LP ≥ 90 % burned/locked | **PASS** | pool_creator = `3J2B…TF9a`, pool = `["pool", 5MxL…, WSOL, mint]` PDA, LP 100 % burned (0 % locked — our platform burns), `register_pool` accepted |
| K5 | TWAP history → first burn within 40 min of the first CPMM trade | **PASS** | first trade 10:15:28, first burn 10:36:44 (21 min) |

## Findings

1. **Tool bug, fixed (92c5a1e):** the "localnet placeholder" program-id check compared against the IDL's address, which becomes the
   real id after the mandated `anchor keys sync`; the launch CLI would have refused `--send` for the real program. Fixed in
   `src/lib/burnReceipts/constants.ts`, `src/lib/burnKeeper/burnPool.ts`, `scripts/burnkeeper-launch.mts`, `scripts/burnreceipts-admin.mts`.
2. **Crank self-throttling (by design, worth knowing).** Each crank spends up to 2 % of the pool's SOL reserve; on a constant-product
   pool that moves the token price ≈ 4 %, more than the 3 % TWAP deviation guard, so the next crank defers (`TwapDeviation`) until the
   1,200 s TWAP catches up: one crank per ≈ 20 min (two cycles of the keeper's 10-min retry). A multi-day backfill or a large carry
   drains in 2 %-of-reserve steps at ≈ 3 per hour. Not a bug; the keeper and the status page report it as a wait.
3. **Sheet corrections:** `squads-multisig-cli multisig-create` needs one `--members` per member (A5, B3); the CLI's confirmation
   prompt needs a TTY (`script -q /dev/null …`); `solana program show` needs `--keypair` on this Mac (no default signer);
   the program is **700,496 B → 3.559 SOL rent** (not 617 KB / 3.135 SOL; the 7 SOL deployer budget still covers it); `anchor keys sync`
   rewrites `Anchor.toml` (comments dropped, `[programs.devnet]` left on the old id) — edit by hand; the devnet build writes devnet ids
   into the IDL, so the committed IDL must come from a default-feature `anchor idl build`.
4. Devnet LaunchLab `minFundRaisingB` is 1 lamport (mainnet 24 SOL); graduation needed ≈ 1.05 SOL of buys at `--raise-sol 1`.
5. Cosmetic: after graduation the keeper still tries the curve claim each cycle and logs `claim_launchlab_creator_fee not sent
   (RequireGtViolated)` (the empty vault; a simulation refusal, nothing sent).
6. Not done: A25 (finalisation through Squads — needs a serialized vault message / the Squads app); A6 skipped (D-6).

## SOL spent (devnet)

Start 10.99998 SOL across deployer/payer/keeper/squads-a/squads-b; end 5.85083 → **5.149 SOL spent**: 3.5594 program rent (in
ProgramData; recoverable only by a Squads-approved `close`), ≈ 0.005 deploy fees, 0.5 seed + 0.02 reserve (fee PDA now 0.4852 after two
cranks), ≈ 1.05 curve buys (the payer still holds ≈ 793 M $DEFICIT), ≈ 0.01 net on the TWAP trades, keeper 0.0117 (4 reading accounts
≈ 0.0084 rent + fees), Squads multisig rent 0.0054, platform/TokenConfig rent and fees ≈ 0.01.
