# Devnet test plan, burn_receipts round 5 (a coin that burns another token)

For the owner. The agent built and tested this on a branch and ran nothing on any cluster: no key was read, nothing was signed or sent,
no RPC call was made. Devnet and mainnet run round 4. Design: docs/burnticker/EXTERNAL-BURN.md.

What the run proves on a real cluster: the upgrade through the devnet Squads vault, old coins unchanged, a devnet coin that pins a devnet
test token and its real devnet CPMM pool before the coin exists, two readings, a crank that swaps the coin's SOL for the test token on
that pool and burns it (memo v3), the refusals (crank_buyback on the target coin, a pin after the mint exists, a pool substitution), and a
held crank when the pool is drained under the floor.

## Build facts (operator's Mac, cargo-build-sbf 4.4.0, the same toolchain whose round-4 build reproduces the deployed `d9d44752…`)

| build | bytes | executable hash |
| --- | --- | --- |
| round 4 (deployed, rebuilt here from the base branch) | 826,384 | `d9d447524754d52d1083c5027ebe2772fe779814c329fb07363dc90350ded2ae` (= the table) |
| round 5 mainnet (default features) | 947,600 | `ac47edb5c07e2b846c74956f55c10068827b401ba1d2f3bfc0b1946427dc5832` |
| round 5 devnet (`--features devnet`) | 947,576 | `596e03225d0ce718d0b1eba10464fc5d27081f4d750914e1cae1f7c610cb8b9c` |

The program grows by about 121 KB, so the program data must be extended before the upgrade (step U2). Staging table for the upgrade
script: `docs/burnkeeper/evidence/devnet-round5/verified-build.round5.json` (config/burnticker/verified-build.json is untouched).
Rebuild and check these numbers yourself in step U1; re-hash if the branch moved after this plan was written.

## Setup (once per shell)

```
cd <your checkout of this branch>
D=~/.config/meme-coin-trader/devnet; DEVNET_RPC=<your devnet RPC>; E=docs/burnkeeper/evidence/devnet-round5
PROG=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM; MS=GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w; VAULT=A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD
OUT=/tmp/round5-build; NODE="node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs"
C="--cluster devnet --rpc $DEVNET_RPC --program $PROG"; T="$NODE scripts/burnticker-devnet-trader.mts"
export BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5   # this shell only: lets initialize-token carry --burn-target
```

## U. Upgrade burn_receipts on devnet through the Squads vault

1. `OUT=$OUT bash scripts/ops/verified-build.sh --local | tee $E/build.log` prints burn_receipts devnet `596e0322…8b9c` (947,576 B)
   (the "DIFFER" against the deployed table is expected).
2. Room for the bigger program: `solana program show $PROG -u "$DEVNET_RPC"` (note "Data Length"). If it is under 947,576, extend by the
   difference rounded up to a multiple of 10,240; from 826,392 that is 122,880 bytes (about 0.86 SOL of rent):
   `solana program extend $PROG 122880 -u "$DEVNET_RPC" -k $D/payer.json | tee $E/extend.log`
3. `solana program write-buffer $OUT/local-devnet/burn_receipts.so -u "$DEVNET_RPC" -k $D/payer.json | tee $E/buffer.log` (note BUFFER)
4. `solana program set-buffer-authority <BUFFER> --new-buffer-authority $VAULT -u "$DEVNET_RPC" -k $D/payer.json | tee $E/set-buffer-authority.log`
5. Dry run, then the proposal:
   `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/squads-program-upgrade.mts --cluster devnet --rpc "$DEVNET_RPC" --multisig $MS --program $PROG --buffer <BUFFER> --spill HUWbm4CnrTfe4MLwpFhstTJFVyrj4FNuTidMzEBoiHfb --member $D/squads-a.json --expect-file $OUT/local-devnet/burn_receipts.so --table $E/verified-build.round5.json --memo "burn_receipts round 5: external burn targets" > $E/dry-br.json`,
   then the same line with `--send > $E/squads-upgrade.json` (note the transaction index N).
6. Votes with `$D/squads-a.json` and `$D/squads-b.json` (`squads-multisig-cli proposal-vote … --transaction-index N --action approve | tee -a $E/squads-votes.log`).
7. After the time lock: `squads-multisig-cli vault-transaction-execute … --transaction-index N | tee $E/squads-execute.log`.
8. Read back: `bash scripts/ops/verified-build.sh --onchain devnet | tee $E/onchain-verify.log` shows `596e0322…`.

## C. Old coins are unchanged (right after U)

TokenConfig keeps its size; the last reserved byte is now `burn_target_kind`, 0 on every existing coin.

1. `$NODE scripts/burnreceipts-admin.mts target-status $C --mint 4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F > $E/compat-deficit-target.json`
   Expect `burn_target_kind 0`, `burnTarget null`.
2. Its next reading and `crank` exactly as in the round-4 plan (C2 of docs/burnkeeper/evidence/devnet-endsink2/README.md): the crank is
   `crank_buyback`, memo v2, unchanged.

## P. A devnet test token, its real devnet CPMM pool, and a Pyth price for it

The program checks every target burn against Pyth. A made-up devnet token has no Pyth feed, so the test token borrows a REAL feed: it
is pinned with WIF's feed id (`4ca4beec…61fc`) and its pool is kept at WIF's SOL price, so the pool and Pyth agree exactly as a real
WIF pool would. AMM v4 is exercised by the LiteSVM suite only (a devnet AMM v4 pool needs an OpenBook market to create; mainnet pools exist).

0. Pyth on devnet: `$NODE scripts/burnreceipts-admin.mts check-target $C --target-mint <any mint> --pool <any pool> --feed 4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc`
   shows whether Pyth's sponsored WIF and SOL accounts (`6B23K3tk…`, `7UVimffx…`, the same PDAs on devnet) are live there (problems
   mention "not on this network" or "more than a minute old" if not). If they are not, post fresh updates to those feeds with Pyth's own
   price pusher (Hermes needs the key in BURNTICKER_PYTH_API_KEY; Full verification) and pass the posted accounts; this plan does not
   automate that step.
1. Token: `spl-token create-token --decimals 6 -u "$DEVNET_RPC" --fee-payer $D/payer.json --mint-authority $D/payer.json` (note TBONK;
   no `--enable-freeze`, so there is no freeze authority), `spl-token create-account TBONK`, `spl-token mint TBONK 1000000000`, then
   `spl-token authorize TBONK mint --disable` (the program refuses a target that can still be minted).
2. The pool on the devnet tier (CPMM_TIER.devnet, fee 0.5 % with the creator fee, under the 1 % bound), at least 2 SOL (the devnet
   build's floor; use 3 SOL), at WIF's price in SOL: tokens = 3 × (SOL/USD ÷ WIF/USD) (e.g. SOL $106, WIF $0.206 → 1,544 TBONK):
   `$T cpmm-create --mint <TBONK> --sol 3 --tokens <that number> --payer $D/payer.json` (dry), then `--send > $E/pool-create.json` (note POOL).
3. Admission + Pyth, read-only: `$NODE scripts/burnreceipts-admin.mts check-target $C --target-mint <TBONK> --pool <POOL> --feed 4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc > $E/check-target.json`
   Expect `ok: true`, `problems: []`, `referenceX32` within 3 % of `spotX32`. If WIF moved, nudge the pool with `cpmm-swap` and re-check.
4. TWAP history (the CPMM crank also needs 600–1,200 s of its own oracle): six small swaps about 150 s apart, alternating
   `$T cpmm-swap --mint <TBONK> --pool <POOL> --dir buy --sol 0.002 --payer $D/payer.json --send` and `--dir sell --pct 1`; keep the pool
   within 3 % of Pyth (re-run step 3).

## R. The run: TGTX burns TBONK

1. Mint keypair: `solana-keygen new --no-bip39-passphrase -o $D/tgtx-mint.json` (note TGTX; do NOT create the mint yet).
2. initialize_token (dry run, then `--send`):
   `$NODE scripts/burnreceipts-admin.mts initialize-token $C --payer $D/payer.json --creator $D/payer.json --mint $D/tgtx-mint.json --admin $VAULT --attester D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn --launchlab-platform GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf --rules config/burnkeeper/target-devnet-x.rules.json --program-round 5 [--send] > $E/tgtx-init[-dry].json`
3. pin_burn_target in its own transaction (the two together exceed the packet limit):
   `$NODE scripts/burnreceipts-admin.mts pin-burn-target $C --payer $D/payer.json --mint $D/tgtx-mint.json --target-mint <TBONK> --pool <POOL> --feed 4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc [--send] > $E/tgtx-pin[-dry].json`
   Expect `BurnTargetPinned` (pool kind 0, the feed id, reference and spot); `target-status --mint <TGTX>` shows `burn_target_kind 1`.
4. Create the coin's mint now (fixed supply, no freeze authority): `spl-token create-token --decimals 6 $D/tgtx-mint.json …`,
   `spl-token create-account`, `spl-token mint <TGTX> 1000000000`, `spl-token authorize <TGTX> mint --disable`.
5. Refusal, a pin after the coin exists: make a second keypair `$D/tgty-mint.json`, run step 2 for it, create its token, then dry-run
   step 3 with `--mint $D/tgty-mint.json`: expect `MintAlreadyCreated` (`$E/pin-after-mint-refused-dry.json`).
6. Two readings with the keeper key (as R3 of the round-4 plan): `submit-reading $C --payer $D/payer.json --mint <TGTX> --date 20261012 --value 3800000000000000 --attester $D/keeper.json --send`
   and `--date 20261013 --value 3800300000000000` (three units). Fuel: `solana transfer <TGTX fee PDA> 0.2 --allow-unfunded-recipient -u "$DEVNET_RPC" -k $D/payer.json`.
7. The crank (the planner picks `crank_target_burn` with the sponsored Pyth accounts; the Pyth prices must be ≤ 60 s old when it lands):
   `$NODE scripts/burnreceipts-admin.mts crank $C --payer $D/payer.json --mint <TGTX>` (dry: `kind: "target"`), then `--send > $E/tgtx-crank.json`.
   Expect memo `TGTX|2026-10-13|…|target=<TBONK>|own=0|swap=<POOL 12>|…|v3`, `TargetBurned` with `reference_x32`, TBONK's supply down by
   exactly `got`, the fee PDA down by `spent`, spent ≤ 2 % of the pool's SOL.
8. Refusals (dry runs, simulation errors expected):
   - a pushed pool: `cpmm-swap --dir buy --sol 0.3` (≈ 20 % push on a 3 SOL pool), then `crank` (dry, after another reading): expect
     `TargetPriceDeviation`; push back with `--dir sell` and the dry run passes again (`$E/tgtx-pushed-dry.json`).
   - a held pool: sell TBONK into it until its SOL reserve is under 2 SOL: `crank` (dry) fails `TargetPoolBelowFloor` and the fee PDA
     does not move (`$E/tgtx-held-dry.json`).
9. Re-pin (optional, the admin is the devnet vault): a second pool with `cpmm-create` on another devnet tier at the same price, propose it
   through the vault (`propose-target-pool --mint <TGTX> --admin $VAULT --pool <POOL2>` dry run prints the instruction), veto once with the
   keeper key (`veto-target-pool --attester $D/keeper.json --send`), propose again, wait 48 h, `apply-target-pool --send`.

Checklist for the owner: U8 shows `596e0322…`; the old coin's crank is still crank_buyback with memo v2; TGTX's crank burned TBONK
(supply down by `got`) with memo v3; the pushed and the held cranks moved nothing. Paste the JSON files into `docs/burnkeeper/evidence/devnet-round5/`
(they hold no secret) and the agent writes the run log.

## B. Rollback

Re-deploy the round-4 artifact (`87d20b26…630a`, devnet) through the same vault exactly as section B of the round-4 plan, with the
round-4 source commit `29f6f5de19f1916945992fae711cefc36927d856`. A coin pinned under round 5 then keeps a BurnTarget account the round-4
program ignores; its TokenConfig byte `burn_target_kind = 1` reads as the round-4 `reserved` byte, so round 4's crank_buyback would
burn the coin itself: do not roll back while a target coin holds fuel on that cluster.

## Mainnet (not part of this plan)

Only after a round-5 blind review: the same steps through the mainnet vault, an extend of 122,880 bytes (947,600 − 826,384 rounded up),
the verified-build table rewritten, then the host flag `BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5` and the page wiring (WIRING-ROUND5.md).
Before offering BONK or WIF, read both mints on mainnet (no mint authority, no freeze authority, classic SPL Token) and pick a CPMM pool
that passes `check-target` (at least 50 SOL of reserve, fee at most 1 %).
