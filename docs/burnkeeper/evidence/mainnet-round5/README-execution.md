# Round 5 → mainnet: owner execution sheet (staged 2026-10-15, NOT run)

**EXECUTED 2026-10-15 ~19:57 Denver** (2026-10-16T01:57:13Z): vault transaction 3 executed in slot 457461970, signature `2u95GqT9W4pxg8GPmbfyWRUrpsjbrnH8ruKCussb9HMX9UkUjFibToW7Z8BmQ1BJzjiixri3R6y6uS2DuciAiFpR`; the votes and the execute are in `squads-votes-execute.log`, the read-back (`152929ce…0821` MATCH, authority still the vault; pair_curve still round 4 `567f3700…8a95` MATCH) in `onchain-verify-after.log`, both read from chain 2026-10-16. The sheet below is kept as it was staged.

burn_receipts round 5 with the round-5 review fixes (R5-1..R5-7, R5-12, second review R5-01, A, B, C; release_target; pin_burn_target
needs an end sink; initialize_token retired) and R5-8 / R5-9 inside the program (owner decision 2026-10-15: carried-spend lamport budget
with the CarriedPace PDA, stalled targets dead, optional BurnTarget accounts on forward_to_winner / forward_on_end). Updated 2026-10-15
evening for that build; the earlier `07b2b58f…` build is superseded and must not be proposed. Same shape as round 4 (`~/mct-runner-study/launch-debt-egg-2026-10-09/ROUND4-UPGRADE-OWNER.md`):
extend → buffer → buffer authority to the vault → Squads proposal in the app → Claude verifies on chain → two approvals → execute →
read-back. Nothing on this page has been run on mainnet. Claude prepared the bytes and the numbers and reads every result back; every
mainnet signature below is the owner's. **Run it only after the devnet rehearsal (docs/burnkeeper/devnet-r5-run-log-2026-10-15.md) is
green.** Only burn_receipts is upgraded; pair_curve stays on its round-4 bytes (`567f3700…8a95`).

## What gets deployed

| | value |
|---|---|
| program | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` (ProgramData `CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn`) |
| file | `~/mct-runner-study/launch-debt-egg-2026-10-09/round5-build/local-mainnet/burn_receipts.so` |
| bytes | 1,028,944 |
| executable hash (what the chain will show) | `152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821` |
| file sha256 | `cd0146726962ce586cce2004a5141309f921dba2908dea7146f7872e6bfed290` (`round5-build/SHA256SUMS`) |
| expected-hash file | `burn_receipts.mainnet.expected-hash.txt` (this folder) |
| program source | monorepo `089024ff6ab0cc92ae37899dee1509d52cb5e203` (branch `worktree-agent-r5prog`; built from the merge `a4e195a3` in `worktree-agent-r5devnet`, whose programs/ equals it) |
| reproduce | `OUT=<clean dir> bash scripts/ops/verified-build.sh --local` → `<dir>/local-mainnet/burn_receipts.so`, same hash (reproduced from clean target directories by the builder twice and by the devnet agent once) |
| on chain now (read 2026-10-15) | round 4 `d9d44752…d2ae` MATCH (`onchain-verify-before.log`); upgrade authority the vault `8zsHrHjS…WrDV`; Data Length 835,216 |
| mainnet multisig | `7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc`, 2 of 3, time lock 0; members `DLxTkuqM…` (A), `57ugkFkT…` (B), `9usyTn3L…`; next transaction index 3 |

## Money (the deployer `F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P`)

Rent on mainnet is 5,080 lamports per byte (`solana rent`, 2026-10-15).

| item | lamports | SOL |
|---|---|---|
| extend: 1,028,944 − 835,216 = 193,728 B needed, rounded up to 19 × 10,240 = **194,560 B** (832 B of headroom) × 5,080 | 988,364,800 | 0.98836 (stays in the program account) |
| buffer: (37 + 1,028,944 + 128) × 5,080 | 5,227,873,720 | 5.22787 (comes back to the spill when the upgrade executes) |
| write-buffer and other fees (about 1,000 transactions; a priority fee of 20,000 µlamports/CU adds little) | — | ≤ 0.05 |
| **peak the deployer needs** | | **≈ 6.27** |

The deployer holds **6.40 SOL** (after the owner's top-up, 2026-10-15 evening): enough for the ≈ 6.27 SOL peak with ≈ 0.13 SOL to spare.
With the spill set to the deployer, the 5.228 SOL returns at execute, so the round costs about 1.04 SOL in the end (the extend plus fees).

## Before you start

- The devnet re-run on this build is green: devnet vault transaction 22 executed 2026-10-15 and the run log §U2 table is filled (go/no-go: GO). The first rehearsal (vault transaction 21, build `a475d902…`) is green.
- Launch flag order. The upgrade retires `initialize_token`: from the execute on, a launch built with the round-4 layout fails with
  `InitializeTokenRetired`, and a launch built with the round-5 layout before the execute fails with 101. So: pause creator launches on the
  live host just before M5's execute, set `BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5` right after the read-back (M6), restart the web
  service, un-pause. Claude stages that as one script after the read-back; it is not part of this sheet.
- Do NOT approve the older pending "SetTimeLock 172800" config transaction if the app still lists it (owner decision 2026-10-12).

## Setup (one terminal; nothing printed is secret)

```
cd ~/Projects/meme-coin-trader
M=~/.config/meme-coin-trader/mainnet-keys; RPC=<the host's mainnet RPC url, from its private env file>
B=~/mct-runner-study/launch-debt-egg-2026-10-09/round5-build; E=docs/burnkeeper/evidence/mainnet-round5
S=~/.local/share/solana/install/active_release/bin; BR=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM
VAULT=8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV; MS=7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc
DEP=$($S/solana-keygen pubkey $M/deployer.json)        # must print F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P
shasum -a 256 $B/local-mainnet/burn_receipts.so         # must print cd0146726962ce586cce2004a5141309f921dba2908dea7146f7872e6bfed290
$S/solana balance $DEP -u "$RPC"                        # at least 6.3 SOL
```

## M1. Extend the program data (owner signs)

```
$S/solana program extend $BR 194560 -u "$RPC" -k $M/deployer.json | tee $E/br-extend.log
$S/solana program show $BR -u "$RPC" | grep "Data Length"      # 1029776 (≥ 1,028,944)
```

## M2. Write the buffer (owner signs)

```
$S/solana program write-buffer $B/local-mainnet/burn_receipts.so -u "$RPC" -k $M/deployer.json --with-compute-unit-price 20000 --max-sign-attempts 20 | tee $E/br-buffer.log
```
Note the printed `Buffer:` address as BUF. If it stops part-way, the half-written buffer keeps its rent: `solana program close BUF -u "$RPC"
-k $M/deployer.json` returns it, then write again.

## M3. Hand the buffer to the vault (owner signs), then the byte check (read-only)

```
$S/solana program set-buffer-authority BUF --new-buffer-authority $VAULT -u "$RPC" -k $M/deployer.json | tee $E/br-set-buffer-authority.log
$S/solana program dump BUF /tmp/r5-buf.so -u "$RPC" && node -e 'const b=require("fs").readFileSync("/tmp/r5-buf.so");let n=b.length;while(n&&!b[n-1])n--;console.log(require("crypto").createHash("sha256").update(b.subarray(0,n)).digest("hex"))'
```
The last line must print `152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821`. (The same dump-and-hash of the devnet
buffer `H1nLhesD…` printed the devnet hash `74659afd…` on 2026-10-15.)

## M4. The Squads proposal (owner, in the app; members are Phantom wallets, so there is no CLI command for this step)

https://app.squads.so, Phantom on member A (`DLxTkuqM…`): multisig `7gYAZ6me…` → Developers → Programs → Upgrade program:

| field | value |
|---|---|
| program | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` |
| buffer | BUF (from M2) |
| spill | `F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P` (the deployer, so the 5.228 SOL comes back to it) |

Create the proposal. **STOP before approving**: tell Claude the transaction index (3 unless something else was proposed). Claude runs:
```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/squads-proposal-verify.mts --cluster mainnet --rpc "$RPC" --multisig $MS --index <N> \
  --program $BR --buffer BUF --spill F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P --expect-hash 152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821 > $E/br-proposal-verify.json
```
and approval waits for `"verdict": "matches"` with `"problems": []` (one Upgrade instruction, program/buffer/spill as above, the buffer's
authority the vault, the buffer's executable hash `152929ce…`).

## M5. Approve and execute (owner, in the app)

Approve with A, switch Phantom to member B (`57ugkFkT…`), approve, Execute (time lock 0). This is the only step that changes the program.

## M6. Read-back (Claude, read-only)

```
$S/solana program dump $BR /tmp/r5-mainnet.so -u "$RPC" && node -e 'const b=require("fs").readFileSync("/tmp/r5-mainnet.so");let n=b.length;while(n&&!b[n-1])n--;console.log(require("crypto").createHash("sha256").update(b.subarray(0,n)).digest("hex"))' | tee $E/onchain-verify-after.log
```
must print `152929ce…0821`; `solana program show $BR` must still show authority `8zsHrHjS…WrDV`; the deployer's balance is back up by
5.228 SOL. Then Claude rewrites `config/burnticker/verified-build.json` (burn_receipts mainnet row; the devnet row after devnet's read-back),
the table in docs/burnticker/VERIFIED-BUILD.md, and stages the host flag script (layout r5, launches un-paused).

## Rollback

docs/burnticker/ROLLBACK.md (program-rollback section): the round-4 artifact `d9d44752…d2ae`, rebuilt from `29f6f5de`, through the same
vault and the same steps (its bytes fit the extended program data). Do not roll back while any coin with a pinned burn target holds fuel.
Coins created by `initialize_token_r5` read under round 4 (same account layout).

## Checklist: what the owner presses

1. Confirm the deployer holds ≥ 6.3 SOL (6.40 reported).
2. M1 extend (signs with the deployer).
3. M2 write-buffer (deployer).
4. M3 set-buffer-authority (deployer); paste BUF to Claude for the byte check.
5. M4 create the proposal in the Squads app (Phantom A); paste the index to Claude; wait for "matches".
6. Pause launches on the live host (Claude's staged one-liner).
7. M5 approve A, approve B, Execute.
8. Claude: read-back, table, flag script; the owner runs the flag script (layout r5, restart, un-pause).
