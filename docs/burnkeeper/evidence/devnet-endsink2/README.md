# End-sink round 4 (LAUNCHPAD-PATH §45): local evidence and the staged devnet run

Branch `burnticker/endsink2`. Everything below the line "Owner commands" is for the owner to run: the agent signed and sent nothing,
read no secret, and made no RPC call (devnet key files were read for their public keys only). Devnet still runs round 3.

## Local evidence (2026-10-12, operator's Mac)

| check | result | file |
|---|---|---|
| Rust: `programs/burn-receipts/scripts/test.sh` (LiteSVM, every suite incl. `tests/end_sink.rs`, pair_curve) | all green | `rust-tests.txt` |
| TS: `npm test` | see file | `ts-suite.txt` |
| `tsc --noEmit` (after `next typegen`) | clean | — |
| localnet, this source (`BURN_RECEIPTS_LOCALNET=1 BURNKEEPER_EXECUTION=program`) | end-sink test green; 3 failures that predate this branch (below) | `localnet-r4.txt` |
| localnet, the DEPLOYED round-3 source with this branch's client (`BURN_RECEIPTS_LOCALNET_SO=<round-3 build> BURN_RECEIPTS_LOCALNET_LAYOUT=r3`) | the default round-3 `initialize_token` lands; same 3 old failures | `localnet-r3.txt` |
| build hashes (`OUT=<scratch> bash scripts/ops/verified-build.sh --local`) | burn_receipts devnet `87d20b26…630a` (826,392 B), mainnet `d9d44752…d2ae` (826,384 B) | `build-hashes.txt` |

The three localnet failures that predate this branch: the two buyback tests stop at `register_pool` with `FeeKeyNotRegistered` (since the
LP-lock round a pool registers only after `register_fee_key`, which needs Raydium's lock program, not loaded on this validator), and the
admin-CLI test refuses `config/burnkeeper/deficit.rules.json` because it now names the real $DEFICIT mint. This branch fixed the other
stale part of that suite (the preloaded LaunchLab platform now sits at the test-pins pin with the §35 lock settings).

`verified-build.endsink2.json` is a STAGING copy of the build table with this branch's burn_receipts hashes, for
`scripts/squads-program-upgrade.mts --table`. `config/burnticker/verified-build.json` stays the deployed truth until the upgrade lands.
pair_curve is not upgraded: its bytes built from this branch differ only because it links burn_receipts (TokenConfig's two new fields sit
inside the old reserved bytes; same size), and the deployed pair_curve reads the new layout correctly.

## Owner commands (devnet only; nothing here touches mainnet)

Set these once in your shell (no secret is printed; the RPC is yours):

```
cd <your checkout of burnticker/endsink2>   # the repository root
D=~/.config/meme-coin-trader/devnet; DEVNET_RPC=<your devnet RPC>; E=docs/burnkeeper/evidence/devnet-endsink2
PROG=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM; MS=GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w; VAULT=A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD
OUT=/tmp/endsink2-build; NODE="node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs"
```

### U. Upgrade burn_receipts on devnet through the Squads vault

1. Build and check the hash: `OUT=$OUT bash scripts/ops/verified-build.sh --local | tee $E/build.log` must print
   `burn_receipts built 87d20b26f9e4c8e4fb4847b7a6d0ae3f938e049008c4fa5c124d4e396687630a` for devnet (the "DIFFER" against the deployed
   table is expected).
2. Room for the bigger program: `solana program show $PROG -u "$DEVNET_RPC"`; if its data length is under 826,392, extend by the
   difference rounded up to a multiple of 10,240 (from the last run log it is 762,056, so 71,680):
   `solana program extend $PROG 71680 -u "$DEVNET_RPC" -k $D/payer.json | tee $E/extend.log`
3. `solana program write-buffer $OUT/local-devnet/burn_receipts.so -u "$DEVNET_RPC" -k $D/payer.json | tee $E/buffer.log` (note BUFFER)
4. `solana program set-buffer-authority <BUFFER> --new-buffer-authority $VAULT -u "$DEVNET_RPC" -k $D/payer.json | tee $E/set-buffer-authority.log`
5. Dry run, then the proposal:
   `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/squads-program-upgrade.mts --cluster devnet --rpc "$DEVNET_RPC" --multisig $MS --program $PROG --buffer <BUFFER> --spill HUWbm4CnrTfe4MLwpFhstTJFVyrj4FNuTidMzEBoiHfb --member $D/squads-a.json --expect-file $OUT/local-devnet/burn_receipts.so --table $E/verified-build.endsink2.json --memo "burn_receipts round 4: end sinks (LAUNCHPAD-PATH §45), burnticker/endsink2" > $E/dry-br.json`
   then the same line with `--send > $E/squads-upgrade-burn_receipts.json` (note the transaction index N).
6. Votes: `squads-multisig-cli proposal-vote --rpc-url "$DEVNET_RPC" --keypair $D/squads-a.json --multisig-pubkey $MS --transaction-index N --action approve`
   and the same with `$D/squads-b.json` (`| tee -a $E/squads-votes.log`).
7. After the 60 s time lock: `squads-multisig-cli vault-transaction-execute --rpc-url "$DEVNET_RPC" --keypair $D/squads-a.json --multisig-pubkey $MS --transaction-index N | tee $E/squads-execute.log`
8. Read back: `bash scripts/ops/verified-build.sh --onchain devnet | tee $E/onchain-verify.log` shows burn_receipts `87d20b26…`.
   Existing coins are unaffected: `$NODE scripts/burnreceipts-admin.mts end-status --cluster devnet --rpc "$DEVNET_RPC" --program $PROG --mint 4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F > $E/flagship-end-status.json`
   (end_state 0, no EndSink, `forwardOnEnd.status` "no-end-sink"); the keeper's next devnet reading and crank on an old coin land as before.

### R. The run: a RESOLVED coin forwards to the devnet $DEFICIT; a VOID coin keeps its wind-down

Common flags: `C="--cluster devnet --rpc $DEVNET_RPC --program $PROG"`. The keeper key `D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn`
is the one attester (quorum 1); the devnet LaunchLab platform is `GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf`.

1. Two throwaway mints: `solana-keygen new --no-bip39-passphrase -o $D/endx-mint.json` and `-o $D/endy-mint.json`.
2. ENDX with a flagship end sink (minimum 0.01 SOL), dry run first, then `--send`:
   `$NODE scripts/burnreceipts-admin.mts initialize-token $C --payer $D/payer.json --creator $D/payer.json --mint $D/endx-mint.json --admin $VAULT --attester D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn --launchlab-platform GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf --rules config/burnkeeper/endsink-devnet-x.rules.json --end-sink flagship:10000000 --program-round 4 [--send] > $E/endx-init[-dry].json`
   Expect the EndSink account in the output; `end-status` then shows kind 0 (flagship), sink `4QnwyiBM…`, minimum 10,000,000.
3. Two readings (raw values in cents; three $1B units):
   `$NODE scripts/burnreceipts-admin.mts submit-reading $C --payer $D/payer.json --mint <ENDX> --date 20261008 --value 3800000000000000 --attester $D/keeper.json --send > $E/endx-reading-20261008.json`
   and `--date 20261009 --value 3800300000000000` (`endx-reading-20261009.json`).
4. Fuel: `solana transfer <ENDX fee PDA from step 2> 0.2 --allow-unfunded-recipient -u "$DEVNET_RPC" -k $D/payer.json`
5. `end-status` → `forwardOnEnd.status` "not-ended". Then the end (dated exactly the last reading; any other date is refused):
   `$NODE scripts/burnreceipts-admin.mts submit-rule-end $C --payer $D/payer.json --mint <ENDX> --date 20261009 --outcome resolved --attester $D/keeper.json --send > $E/endx-rule-end.json`
6. Refusals (dry runs; each prints the simulation error): a reading dated 20261010 (`RuleEnded`, `endx-reading-after-end-refused-dry.json`);
   a second `submit-rule-end` (the RuleEnd account exists, `endx-rule-end-again-refused-dry.json`).
7. The forward: `$NODE scripts/burnreceipts-admin.mts forward-on-end $C --payer $D/payer.json --mint <ENDX>` (dry), then `--send > $E/endx-forward.json`.
   Expect target = intended = `4QnwyiBM…`, memo `ENDX|endfwd|to=4QnwyiBMm2Ca|lamports=<≈0.2 SOL>|v1`, the flagship fee PDA up by exactly that
   amount and ENDX's fee PDA back to its reserve. A second dry run refuses `NothingToForward` (`endx-forward-again-refused-dry.json`).
   If the dry run says `FlagshipNotLive`, the devnet $DEFICIT's pool is not verified on this program: stop and tell the agent.
8. ENDY (VOID): steps 2–4 with `endsink-devnet-y.rules.json` and `$D/endy-mint.json`, then `submit-rule-end … --outcome void --send`
   (`endy-rule-end.json`); `forward-on-end` prints `status: void` and sends nothing (`endy-forward-void.json`); a reading dated 20261010
   dry-runs clean (`endy-reading-after-void-dry.json`).

Checklist for the owner: U8 shows `87d20b26…`; ENDX's RuleEnd is resolved with forwards 1; the flagship gained exactly the forwarded
lamports; ENDY's RuleEnd is void and nothing moved; the old coin's reading/crank still lands. Paste the outputs into this folder (they
contain no secret) and the agent writes the run log.

### C. Compatibility crank: accounts made under round 3 read and crank unchanged under round 4 (right after U)

Layouts, round 3 → round 4: **TokenConfig** keeps its size and every field offset; `end_state: u8` and `end_date: u32` take five of the
old six `reserved` bytes (a round-3 account's zeros read as live / 0). **Pair** (pair_curve), **PairLink**, **PairResult**,
**FeeKeyRecord**, **Reading** and **PlatformConfig** are unchanged. New accounts only: EndSink, RuleEnd. So no migration instruction and
no versioned decoder: Borsh reads old accounts as they are. Pinned in Rust by
`a_round3_token_config_reads_and_cranks_unchanged_under_round4` (`tests/end_sink.rs`): a TokenConfig written BY THE ROUND-3 PROGRAM
(`programs/burn-receipts/fixtures/round3-token-config.hex`) deserialises under round 4, is byte-identical to round 4's own write for the
same inputs, and then takes readings, a crank and a burn.

1. The devnet $DEFICIT (round-3 TokenConfig, verified pool): `$NODE scripts/burnreceipts-admin.mts end-status $C --mint 4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F > $E/compat-deficit-status.json`
   Expect `end_state 0`, `end_date 0`, `endSink null`, `forwardOnEnd.status "no-end-sink"`, and `crank_cursor` / `last_record_date` as before the upgrade.
2. Its next reading and crank, exactly as the keeper does (one day after its `last_record_date`, the counter from its rules; or simply let
   the devnet keeper run one cycle): `$NODE scripts/burnreceipts-admin.mts submit-reading $C --payer $D/payer.json --mint 4QnwyiBM… --date <next> --value <counter> --attester $D/keeper.json --send > $E/compat-deficit-reading.json`
   then `$NODE scripts/burnreceipts-admin.mts crank $C --payer $D/payer.json --mint 4QnwyiBM… --send > $E/compat-deficit-crank.json`.
   Expect the reading to land and the crank to burn (memo v2) or defer (`TwapUnavailable` / below floor) exactly as under round 3; never
   `RuleEnded`, `ForwardOnEndRequired` or a deserialisation error.
3. A round-3 PAIR (pair 6, LaunchLab: `7dNGQuvijwxFBw6PXUHnw2mfmTuRd2KmV6nBGrFxXb2T` / `6jxEWF78rtBsMCA44FYaCG4nFUjk4S15e4wAKKjgMzmN`):
   `pair-status` for both (`compat-pair6-status-A.json`, `-B.json`: pair_state 2, both PairLinks paired, the same attester-set hash),
   then one reading each and `crank` on each, as in step 2 (`compat-pair6-*.json`). Expect the pair gate to behave as in round 3.
4. Pair 8 (pair_curve, `CGp4Qa9wrBD3MfJfPafpxaWiSSwtu8XHwLGbxXg6FboA` / `H3KnEmyvaWFuQofo5ZmkcuPHefMCnhYjzXFVHB7PZLCy`):
   `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/paircurve-admin.mts status --cluster devnet --rpc "$DEVNET_RPC" --pair 7GYFPpKqHP5hJp4Vu2K1Ys8RRggdY12XREhoK9kXajmq > $E/compat-pair8-status.json`
   (the Pair decodes as before).

### P. A pair_curve pair created with link_pair inside the init_pair transaction (re-check P3-1), through one result and a forward

`PC="node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/paircurve-admin.mts --cluster devnet --rpc $DEVNET_RPC"`

1. Mints: `solana-keygen new --no-bip39-passphrase -o $D/pc11-mint-a.json` and `-o $D/pc11-mint-b.json`; rules: copy
   `config/burnkeeper/paircurve-devnet-8a.rules.json` / `8b` to `paircurve-devnet-11a/11b.rules.json` with `mint` set to the new pubkeys
   and the tickers `PCLA` / `PCLB` (devnet only).
2. `$PC init-pair --payer $D/payer.json --creator $D/payer.json --mint-a $D/pc11-mint-a.json --mint-b $D/pc11-mint-b.json --admin $VAULT --attester D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn --launchlab-platform GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf --rules-a config/burnkeeper/paircurve-devnet-11a.rules.json --rules-b config/burnkeeper/paircurve-devnet-11b.rules.json --pair-id pc11-endsink2 --target-sol 1 --deadline-secs 86400 --end-sink-a pair-winner:10000000 --end-sink-b pair-winner:10000000 [--send] > $E/pc11-init[-dry].json`
   Expect step 3 of the output to carry two instructions (init_pair, link_pair) and `pair-status` on both mints right after: pair_state 2.
3. Fill both sides past the target (`$PC buy --pair <PAIR> --side A --sol 0.6 --payer $D/payer.json --send`, the same for B), then
   `$PC crank --pair <PAIR> --payer $D/payer.json --send` until both sides are graduated, LP locked and both pools registered
   (`$PC status --pair <PAIR>`: both `pool_verified true`) → `pc11-graduate-*.json`.
4. One result: both coins read the same day (`submit-reading` as in R3, keeper key), then
   `$NODE scripts/burnreceipts-admin.mts submit-pair-result $C --payer $D/payer.json --mint-a <A> --mint-b <B> --date <D> --winner <A> --attester $D/keeper.json --send > $E/pc11-result.json`
   and the loser's crank, which forwards: `$NODE scripts/burnreceipts-admin.mts crank $C --payer $D/payer.json --mint <B> --send > $E/pc11-forward.json`
   (memo `PCLB|forward|from=…|to=…|period=<D>|lamports=N|v1`), then the winner's crank burns (`pc11-crank-A.json`).

### B. Rollback: re-deploy the previous verified artifact through the same vault (only if a read-back fails)

The previous artifact is the round-3 build of `bc0565589ad99c774786adc21bc1e505c6e5f733`: mainnet executable hash `e64a2759…dc19`
(763,536 B), devnet `90bd47e6…4b35`, both in `config/burnticker/verified-build.json` at that commit.

1. A clean checkout of that commit: `git worktree add /tmp/br-rollback bc0565589ad99c774786adc21bc1e505c6e5f733 && cd /tmp/br-rollback`
   (link `node_modules` from your checkout), then `OUT=/tmp/br-rollback-build bash scripts/ops/verified-build.sh --local` must print
   MATCH for burn_receipts (mainnet `e64a2759…`, devnet `90bd47e6…`).
2. Devnet: `solana program write-buffer /tmp/br-rollback-build/local-devnet/burn_receipts.so -u "$DEVNET_RPC" -k $D/payer.json`,
   `set-buffer-authority <BUFFER> --new-buffer-authority $VAULT`, then `scripts/squads-program-upgrade.mts --cluster devnet … --buffer <BUFFER> --expect-file /tmp/br-rollback-build/local-devnet/burn_receipts.so`
   (the default table at that commit), votes and execute as in U5–U7; read back with `verified-build.sh --onchain devnet` = `90bd47e6…`.
3. Mainnet (the same steps through the mainnet vault `8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV`, multisig
   `7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc`): write-buffer and set-buffer-authority with the deployer key, then
   `scripts/squads-program-upgrade.mts --cluster mainnet --multisig 7gYAZ6me… --program AuQjoSgq… --buffer <BUFFER> --spill <a member> --member <a member key> --expect-file /tmp/br-rollback-build/local-mainnet/burn_receipts.so`
   prints the vault transaction for your signing tool (it sends nothing on mainnet); approve A + B in Squads, execute; read back
   `verified-build.sh --onchain mainnet` = `e64a2759…`. Then set `BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r3` and `BURNTICKER_END_SINKS_LIVE=0`
   on the host and close creator launches. What a rollback leaves behind: EndSink / RuleEnd accounts stay (the round-3 program ignores
   them); a coin that recorded a RESOLVED end reads those bytes as reserved again and resumes round-3 behaviour (its keeper wind-down);
   a pair rotated under round 4 is on one set either way.

### F. The opening's host flags (owner, Monday 2026-10-19, after the mainnet read-back)

`sh scripts/ops/burnticker-open-creator-launches.sh --check <the host's env file>`, then `--apply <the same file>`; it sets exactly
`BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r4`, `BURNTICKER_END_SINKS_LIVE=1`, `BURNTICKER_PAIR_CURVE_ENABLED=1`,
`BURNTICKER_CREATOR_LAUNCHES_ENABLED=1` (a backup copy first), and prints the restart line
(`systemctl restart mct-burnticker-web mct-burnticker-keeper`). Mainnet program data: 763,536 B deployed; round 4 is 826,384 B, so
`solana program extend AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM 71680 -um -k <deployer key>` before the mainnet write-buffer
(check `solana program show` first).
