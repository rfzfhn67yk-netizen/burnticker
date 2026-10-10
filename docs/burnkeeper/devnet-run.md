# $DEFICIT end to end on devnet — the run book, and what was (not) run

> **Update 2026-10-10 (later): the end-to-end devnet run WAS performed** (program `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM`,
> mint `4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F`). Deploy → Squads → platform → `initialize_token` → create (creator = fee PDA)
> → curve claim on the real devnet LaunchLab → graduation → Raydium's devnet migration (11 s) → `register_pool` → TWAP trades →
> keeper attests, claims, defers on `TwapUnavailable`, then `crank_buyback` swapped and burned 4,010,874.87 $DEFICIT with the v2 memo,
> verified on the status page. §4 below has every signature; the command-by-command log is
> `docs/burnkeeper/devnet-run-log-2026-10-10.md`. The text from here to §4 is the original 10-09 run book, kept as written.

Written 2026-10-09. **The end-to-end devnet run was NOT performed.** The public devnet faucet (`requestAirdrop` on
api.devnet.solana.com) answered `429 — You've either reached your airdrop limit today or the airdrop faucet has run dry` for 2, 1 and
0.5 SOL on two fresh throwaway addresses, and at the time this machine had no Solana CLI / local validator. Nothing was sent on any cluster.

> **Update 2026-10-10:** the dev Mac now has the Solana CLI (Agave `solana-cli 4.3.0`, with `solana-test-validator`) and Anchor
> (`anchor-cli 1.2.1`): `export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"`. The ordered,
> owner-facing version of this run (with the program deploy, Squads and pass/fail checkpoints) is `docs/burnticker/REHEARSAL-RUNSHEET.md`
> §A. On the Mac (zsh) define `R` as a **function**, not a variable — zsh does not word-split `$R`:
> `R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }`.

What **was** done against the live clusters is simulation only (`simulateTransaction`, `sigVerify: false`, no signatures, no sends):

| Step | Cluster | Result |
|---|---|---|
| `initialize_v2` + 0.1 SOL first buy, Raydium's devnet platform, 1 SOL raise | devnet | success, 195,643 CU (`InitializeV2` and `BuyExactIn` both logged `success`) |
| `initialize_v2`, vault mode: 25% locked, 365-day linear, totalSellA lowered | devnet | success, 109,829 CU |
| `create_platform_config` (Burnticker: fee 2,500 ppm, creator 5,000 ppm, all LP burned) | devnet | success, 28,243 CU |
| `initialize_v2` + 0.5 SOL first buy on the REAL 85 SOL curve, payer simulated as Raydium's migration wallet | mainnet | success, 193,522 CU |
| LaunchLab `claim_creator_fee` as two real creators with accrued vaults (7.27M and 14.6M lamports) — the key-signed reference the program's CPI must reproduce | mainnet | success, 26,745 / 29,819 CU |
| the keeper's CPMM `collect_creator_fee_permissionless` plan on a graduated LaunchLab pool, creator = its `pool_creator`, payer = someone else | mainnet | success, 46,356 CU (`fees.md` §6) |
| `initialize_v2` + 0.1 SOL buy with the **fee PDA as creator** (the CLI's default after H-2) | devnet | success, 188,143 CU |

> **Creator = the burn program's fee PDA** (`["fee", mint]` under `BURNTICKER_PROGRAM_ID`; review finding H-2). The keeper key is NOT the
> creator and holds no fees; it only pays for the permissionless claims. `--creator` defaults to the PDA; passing anything else is warned
> loudly and refused for `--send` without `--allow-foreign-creator`.

Explorer links: **none — there are no transactions.** When the owner runs the commands below, paste each `explorer` URL from the JSON
output into the table at the end of this file.

## Keys (all devnet throwaways, outside the repository, mode 600)

```sh
mkdir -p ~/.config/meme-coin-trader/devnet && chmod 700 ~/.config/meme-coin-trader/devnet
solana-keygen new --no-bip39-passphrase -o ~/.config/meme-coin-trader/devnet/payer.json      # pays rent + the first buy
solana-keygen new --no-bip39-passphrase -o ~/.config/meme-coin-trader/devnet/mint.json       # THE MINT — pre-generated; never printed by our tools
solana-keygen new --no-bip39-passphrase -o ~/.config/meme-coin-trader/devnet/keeper.json     # the keeper: PAYS for permissionless claims (devnet stand-in for signer-burnkeeper.enc.json)
chmod 600 ~/.config/meme-coin-trader/devnet/*.json
solana airdrop 2 "$(solana-keygen pubkey ~/.config/meme-coin-trader/devnet/payer.json)" --url devnet   # or https://faucet.solana.com
solana airdrop 1 "$(solana-keygen pubkey ~/.config/meme-coin-trader/devnet/keeper.json)" --url devnet  # the keeper pays claim/burn fees
export BURNTICKER_PROGRAM_ID=<the devnet burn_receipts deploy id>   # the creator = its fee PDA for the mint; without it the CLI derives
                                                                    # under the IDL's LOCALNET placeholder id and refuses to --send
```

(No `solana` CLI? Any 64-byte JSON-array keypair file works; our loader also accepts a base58 secret. For the keeper on mainnet use
`scripts/burnkeeper-keygen.mjs --new` — encrypted.) The burn program must be deployed on the cluster first and the token's config
initialised (`initialize_token`, signed by the mint keypair — `src/lib/burnReceipts`) so the fee PDA is the program's; the LaunchLab
create itself only needs the PDA's address.

## 1. Create (dry run first, then send)

```sh
R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }   # a function: zsh does not word-split $R
D=~/.config/meme-coin-trader/devnet
# dry run: prints every instruction decoded + the devnet simulation; signs nothing. --creator is omitted: it defaults to the fee PDA.
R scripts/burnkeeper-launch.mts launch --cluster devnet --payer $D/payer.json --mint-keypair $D/mint.json \
   --name DEFICIT --symbol DEFICIT --uri https://<your-host>/deficit-devnet.json \
   --raise-sol 1 --first-buy-sol 0.1 > /tmp/deficit-devnet-dry.json
jq '{creator, burnPool, warnings, problems}' /tmp/deficit-devnet-dry.json     # creator == burnPool.feePda, creatorIsFeePda true
# send (devnet needs no mainnet two-key flags)
R scripts/burnkeeper-launch.mts launch --cluster devnet --payer $D/payer.json --mint-keypair $D/mint.json \
   --name DEFICIT --symbol DEFICIT --uri https://<your-host>/deficit-devnet.json \
   --raise-sol 1 --first-buy-sol 0.1 --send > /tmp/deficit-devnet.json
jq '{mint, poolId, creator, burnPool, creatorFeeVault, cpmmAfterGraduation, rules, sent}' /tmp/deficit-devnet.json
```

`--raise-sol 1` graduates the curve after 1 SOL of buys (devnet's config allows it; mainnet's minimum is 24 SOL and the standard is 85).

Vault-mode variant: **not launchable under the fee-PDA creator** — `create_vesting_account` must be signed by the creator and the burn
program has no vesting CPI; the CLI refuses `--vault-share` > 0 for that reason (it still builds the vesting transaction for a key creator
with `--allow-foreign-creator --vesting-signer <key>`, which is a different product).

## 2. Buy, so creator fees accrue

Buys through Raydium's devnet UI (`https://raydium.io/launchpad/?cluster=devnet` — the token page is `…/launchpad/token/?mint=<mint>`),
or a second `--first-buy-sol` run is not possible (the mint exists). The creator-fee vault printed as `creatorFeeVault.address` fills by
`creatorFeeRate` of every trade (Raydium's devnet platform: 2,500 ppm = 25 bps). Check it:

```sh
solana balance <creatorFeeVault.address> --url devnet            # a WSOL token account: use spl-token instead
spl-token balance --address <creatorFeeVault.address> --url devnet
```

To exercise the **post-graduation** path, buy past the raise (≥ 1 SOL total with `--raise-sol 1`); Raydium's devnet migration wallet
(`DRayP1Yav394wpS47WQJ5Qm6d95WTQFtGGh54cVQFmhF`, funded) must then run the migration. Whether that crank runs on devnet is **not
confirmed** (see `launchlab-devnet.md`); if it does, the CPMM pool appears at `cpmmAfterGraduation.expectedPoolId`.

## 3. The keeper attests, claims and cranks — program execution (2026-10-10)

The keeper drives the burn_receipts program (`docs/burnkeeper/README-execution.md`): it attests each Treasury reading with its key,
claims creator fees into the fee PDA best-effort, cranks, and records what the program did. Prerequisites: the program deployed on devnet
(`anchor build -- --features devnet`, docs/burn-receipts/README.md §5.1) and `initialize_token` for the mint with **the keeper's devnet
key as the only attester (quorum 1)** and `rules_sha256` = `R scripts/burn-keeper.mts --print-rules` (the keeper refuses a config whose
hash, mode, memo prefix or value decimals do not match the rule file). Every one-off program instruction goes through the admin CLI —
dry run by default, decoded instruction + simulation + resulting accounts as JSON, `--send` with key files:

```sh
R scripts/burnreceipts-admin.mts initialize-token --cluster devnet --program <burn program> --payer $D/payer.json --mint $D/mint.json \
  --creator $D/payer.json --admin <Squads vault or your devnet admin> --attester $(solana-keygen pubkey $D/keeper.json) \
  --launchlab-platform <devnet LaunchLab platform> --rules config/burnkeeper/deficit.rules.json            # then again with --send
R scripts/burnreceipts-admin.mts register-pool --cluster devnet --program <burn program> --payer $D/keeper.json --mint <mint> --pool <pool>
R scripts/burnreceipts-admin.mts check-pool-health | claim-launchlab-creator-fee --cluster devnet --program <burn program> --payer $D/keeper.json --mint <mint>
R scripts/burnreceipts-admin.mts initialize-platform --cluster devnet --program <burn program> --upgrade-authority $D/deployer.json --authority <vault> --sunset 2027-09-30
```

```sh
BURNKEEPER_EXECUTION=program BURNTICKER_PROGRAM_ID=<burn program> BURNKEEPER_SIGNER_PATH=$D/keeper.json BURNKEEPER_MINT=<mint> \
BURNKEEPER_DB=data/burnkeeper-devnet.db BURNKEEPER_PUBLISH_DIR=data/burnkeeper-devnet-site \
R scripts/burn-keeper.mts --devnet --once
```

What the log shows, in order: `execution program` in the banner and the config line (mode, fee PDA, attesters/quorum, pool); `[attest]
<date>: $… attested and submitted (the program counted N unit(s)) — <sig>` per reading (the first is the baseline); `[fees] curve: …` /
`[fees] cpmm: …` (claim notes or sent signatures); before graduation `[program] <date>: waiting for the CPMM pool …` (a wait, not an
error); after `register_pool` (anyone — `registerPool` in src/lib/burnReceipts/crank.ts) `[pool] check_pool_health: pool tradeable`, then
either `crank_buyback deferred by the program (TwapUnavailable) — waiting for TWAP history` (a fresh pool needs 600–1,200 s of trades in
its oracle) or `[program] <date>: CRANKED · burned · spent … got … burned … · <sig> · DEBT|<date>|…|v2`. `data/burnkeeper-devnet-site/
status.json` → `.program` shows attestation, queue and pool health; `burns.json` the program's facts per day with a green verify block.

The legacy Jupiter leg (`BURNKEEPER_EXECUTION=legacy`) refuses this token (its creator is the fee PDA) — deprecated, vault-mode/dev only.

A quick way to get several reading days at once: set `BURNKEEPER_BASELINE_DATE` to a business day two weeks back.

## 4. Record

Filled 2026-10-10 by the devnet rehearsal (REHEARSAL-RUNSHEET §A; full log with every command: `docs/burnkeeper/devnet-run-log-2026-10-10.md`).

| Step | Signature / address | Explorer |
|---|---|---|
| deploy burn_receipts (devnet build) — program id, `solana program show` | program `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM`; ProgramData `CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn`; 700,496 B; authority deployer → Squads vault `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD` (2-of-3, 60 s time lock, multisig `GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w`) | deploy [`5nRYafJtNR…`](https://explorer.solana.com/tx/5nRYafJtNRMWAr6o1YS4zsVfremBaBYejYdMtj7uPPacrTdS3HGsL6JAenuTog8w16bdDh76tjjqZMxmvNd1vZqS?cluster=devnet) · set-authority [`2WXsrxWqzz…`](https://explorer.solana.com/tx/2WXsrxWqzz1bCnp2a1sJCHw6HexyeGTh6Rn21UUUvHAE1Hz1pGDa7LBpE78TnHjSGju3Se2nXqsTLawHJmBATeeG?cluster=devnet) · [`AuQjoSgq…zhMM`](https://explorer.solana.com/address/AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM?cluster=devnet) |
| `initialize_token` (mint keypair signs; keeper key = the only attester, quorum 1; rules sha = the rule file's) | TokenConfig `FqfwxFKaiLRaK1HAsBsRRkXAq3nzbEt92fX9qWQTZYPh`, fee PDA `3J2B6wquyN35esxJuWyT6xMmxv52yMrmfBmBozqJTF9a`; attester keeper `D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn`, quorum 1, admin = vault, genesis devnet, TWAP 300 bps/1,200 s, floor 0.001 SOL, platform pinned `GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf` | [`2qV3SuXeYJ…`](https://explorer.solana.com/tx/2qV3SuXeYJaxCxZ3fb8rVaobrGH7cJECToCjWKFcxC5frZzfy4tqKLUWY27Ngqkmer3TNZxu2Zce7czPFz1cgFGe?cluster=devnet) |
| rules sha published (`--print-rules`) | `b9ad29b48ef13548e18674dca770a554b0f96e1924fcf70fdd378225689d8884` (`config/burnkeeper/deficit.devnet.rules.json`; = the TokenConfig's rules_sha256 and the memo's `rules=sha256:b9ad29b48ef1`) | — |
| LaunchLab create (creator = fee PDA) + first buy | mint `4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F`, LaunchLab pool `8etFJShXbrpNmQm16z7ctCQXzyffiB5rJc2yUb8PssR5` on our platform `GvSKpe5p…v3tf` (25 bps dev / 50 bps burn pool / LP burned), raise 1 SOL, first buy 0.1 SOL; verify-platform-pins exit 0 before it | platform [`5sAHZSKmid…`](https://explorer.solana.com/tx/5sAHZSKmid2sJ4nv4jBNszEqoTsvhRr3GRE4uW1y6MYuCDTxq7jex1G7a4QudGjZZXUxue9g4cnb6SN2CqvWgdwt?cluster=devnet) · create [`4EJwd2yrKf…`](https://explorer.solana.com/tx/4EJwd2yrKfKBh6V8rD2LFFaq7q8NhTaeCGpLJDsZUfu25M6sgJpdrGWQjR9zcHU7YoeWhJvoN5z3Z1J2YxvGCM6D?cluster=devnet) |
| seed into the fee PDA (disclosed) | 0.5 SOL from the payer (devnet stand-in for the 3 SOL) | [`4PNghxJUc5…`](https://explorer.solana.com/tx/4PNghxJUc5iwz7GEh8GPkd9WbV9miR2YbxqQnAQBWhAnnzoJX9GWkUoofqzD2xPCZjK1UBqnuTxSCWrKoGUgQUtA?cluster=devnet) |
| first `submit_reading` (baseline) and the first unit day's `submit_reading` | baseline 2026-10-05 ($40,249,104,431,078.48); 10-06 23 units; 10-07 11 units; 10-08 22 units (real Treasury feed, BURNKEEPER_BASELINE_DATE=2026-10-05) | baseline [`2MoVGRc3Uf…`](https://explorer.solana.com/tx/2MoVGRc3UfZQGPKr6EeP25iL81LkJPcWChYkxD7jTFcN5GQTaYySxap89HawK9fothbNHQFXqzfmhWFaGYaV6N3y?cluster=devnet) · 10-06 [`48z66Ct4FS…`](https://explorer.solana.com/tx/48z66Ct4FSRHN9i9ixohaqGTBjAY6TAdA2kd3sYCFLRX1u9ybDkz21PZGnV12mypy8RvnkQN1D6SfVUiacBkUnry?cluster=devnet) · 10-07 [`63v24yDMcG…`](https://explorer.solana.com/tx/63v24yDMcGHh7LT4HD8j3xHk6uZhSJsZuZ1co9jo99rmc4ruCwX2vCZJRRjW7yfi29dSt37CoeHQZ1zZUhngdKSe?cluster=devnet) · 10-08 [`64SV55oiFp…`](https://explorer.solana.com/tx/64SV55oiFpAyxhZsh3dqNniH3RxyBCBMhMBAjad3CzubJjEP9cVUEJtJwudJcbjEKr9gZUw3dcgZssjoKr1EECLW?cluster=devnet) |
| curve creator-fee claim (program `claim_launchlab_creator_fee`, into the fee PDA's WSOL ATA) | against the REAL devnet LaunchLab (`DRay6f…`): vault 0.0005 → 0, fee WSOL `4VcsuCXw3sQqWm4Sv36X7hwkup9owSXcjThwSibtCTzk` 0 → 0.0005 (admin CLI, keeper pays); the keeper's own cycle sent it again after the curve buys | admin CLI [`5aqJratWm9…`](https://explorer.solana.com/tx/5aqJratWm9sqDAGojkBr4A9GhHAptx9C4NZov9gBTfiC7r6pV5XUoCABQisPhDm9XwZeTunW3C2qPbAFMrnweYcu?cluster=devnet) · keeper [`33vVy1QY1x…`](https://explorer.solana.com/tx/33vVy1QY1x5pSzRR5YhpjxAsSwhakjXgTPiy2mFDpjutZB7C8FkRQAxvWT33CamTebVXJDfSS5GEpKhjFyrwRjs7?cluster=devnet) |
| `register_pool` (program; pool_creator == fee PDA), after graduation | CPMM pool `5RoGVSCTBmcTSXdUgoktteBAi5sXTrax7QiJ6rh8hNyR` (migrated by Raydium's devnet wallet 11 s after the graduating buy, LP 100% burned) | migration [`3kbaWR8dQH…`](https://explorer.solana.com/tx/3kbaWR8dQHMUHtAiPKzTZALvBXw7nttmRLb2epLf8xsfoWkfsuVhohgPCNVKg9VagEN3tahbAugSzRdJM5krt34i?cluster=devnet) · register [`2yR8kymeZ6…`](https://explorer.solana.com/tx/2yR8kymeZ6tvy2WjM4cffXr6KquCJ6qVTif7m6k7LSHwxzDk2Rm4eJE72r7tz4J5vRAoTqQBrjzBfxgvH58Zc3Sz?cluster=devnet) |
| `check_pool_health` | pool tradeable (sent each keeper cycle) | [`3aKTy5YuQ3…`](https://explorer.solana.com/tx/3aKTy5YuQ3CQzYJorxDAbx33rVBKzir9CqjNiz3AzbKFT4UUNsmzX5SCDEHtqhJhweaKHheF2ubypyPrdrsdZZ4W?cluster=devnet) |
| a crank deferred by `TwapUnavailable` (recorded as a wait in `burns.json`) | 2026-10-06 at 10:16:35 and 10:26:39 Denver (first CPMM trade 10:15:28); a simulation refusal, so no signature; `status.json .program.queue.waits` | — (no transaction by design) |
| `crank_buyback` (program: swap + burn + memo) — Reading facts in `burns.json`, verify ✓ | 2026-10-06, 10:36:44 Denver: 23 units, rule spend 104,345,230 lamports, spent 20,132,384 (2% reserve cap, PARTIAL, 84,212,846 carried), got and burned 4,010,874.872446 $DEFICIT; supply 1,000,000,000 → 995,989,125.127554; memo on chain = the row's; `verified: true`, `health.unverified 0`; second crank 2026-10-07 at 10:57:02: 11 units, spent 20,409,545, burned 3,956,814.908585 ([`WrU2qsjH2c…`](https://explorer.solana.com/tx/WrU2qsjH2c6s2chHDXbip6ZXPCkw8Uka19rQPTJdmCAU33idaZF7UkcbYanhv2bhC58te8nzQW4pTqt1ZzcQbyj?cluster=devnet)); 10-08 left pending (`TwapDeviation`, keeper stopped) | [`3gBYyBbz5U…`](https://explorer.solana.com/tx/3gBYyBbz5U1MA2Ut71vfzevMCWaBgAX4NjGymghbnhrnBxB94ADeenr3hvKVHrmfJmBy1JHxgY3k2SJNWiDkziVU?cluster=devnet) |
| CPMM creator-fee claim (`collect_creator_fee_permissionless`, after graduation) | keeper pays, destination = the fee PDA's WSOL; collected on each cycle with accrued fees | [`RHTuiM8b3o…`](https://explorer.solana.com/tx/RHTuiM8b3oRfiooqE3iA5KkmEchgz2N4yy4sLCDimUnv7xXiPyaUFjcz4U8Y9ESZMFA2y3C8Mw4MLN5mya5dtwZ?cluster=devnet) · [`2Tvrwo9oac…`](https://explorer.solana.com/tx/2Tvrwo9oac3YrnKF3Fvg2HvDvTksX4QfN5BH1yc3nJzLFr7YSfQtvLZ9eGiGju8MGLLqywuBtD6ey2Km5EKt2Me2?cluster=devnet) · [`2rQtxBHsra…`](https://explorer.solana.com/tx/2rQtxBHsrapJ1fzMLsxkVydmBAF5xjj1KLPMrN7VDZu34t4ZSh9uF4Mso22MtQ1WZzRhHXwGtZdJsTqo1JeVma2j?cluster=devnet) |

## Mainnet launch day (for reference; the full sequence is docs/burnticker/runbook.md "Launch day")

1. Platform config (`platform … --send`, `BURNKEEPER_MAINNET=1`) → `BURNTICKER_PLATFORM_ID`.
2. Deploy burn_receipts (README §5), Squads as upgrade authority; `export BURNTICKER_PROGRAM_ID=<its id>`.
3. `initialize_token` for the mint (mint keypair signs; attesters = the keeper key, quorum 1; admin = the Squads vault; rules sha = the
   rule file's after `"mint"` is written into it — `--print-rules`, publish, `BURNKEEPER_RULES_SHA`).
4. `burnreceipts-admin.mts verify-platform-pins --cluster devnet --program <burn program> --mint <mint>` must exit 0 (re-check R3-3 launch
   gate: the platform's platformCpCreator / scales / cpConfigId still match the pins); then, in the same sitting, LaunchLab create with
   creator = the fee PDA (`launch … --dry-run`, check `burnPool.creatorIsFeePda`; then `--send`).
5. Seed 3 SOL into the **fee PDA** (not the keeper): a plain transfer; disclose it (`BURNKEEPER_SEED_TX/_SOL`).
6. Start the keeper with `BURNKEEPER_EXECUTION=program`, `BURNTICKER_PROGRAM_ID`, `BURNKEEPER_MINT`, `BURNKEEPER_MAINNET=1`,
   `BURNKEEPER_RULES_SHA` — it attests, claims and cranks. After graduation: `register_pool` (anyone); the keeper's next cycle cranks.
