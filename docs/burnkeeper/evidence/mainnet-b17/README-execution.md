# B-17 mainnet upgrade of burn_receipts: execution sheet (prepared 2026-10-21 07:05 Denver)

Same shape as `docs/burnkeeper/evidence/mainnet-round5/README-execution.md`: extend → buffer → buffer authority to the vault → Squads
proposal in the app → Claude verifies on chain → two approvals → execute → Claude re-verifies → keeper clients switch by hash.
The owner signs every step that moves anything; Claude prepares and checks. Nothing here is run by Claude.

## What is being deployed
- Source: monorepo commit `116ff5ad` (B-17: `register_fee_key` accepts the pool LaunchLab actually made once it marks the coin
  migrated; `register_pool` accepts another tier only with LaunchLab's migrated status 2, the fee PDA as creator and the pinned
  platform; `replace_pool` strict). Rehearsed on devnet 2026-10-20 (FIX-RECORD 19:48) and independently read by Codex (BT-FULL-20261021-06).
- Build: two independent interim Mac builds of `116ff5ad` reproduced byte for byte.
  - executable hash (what the chain shows and `scripts/squads-proposal-verify.mts --expect-hash` checks):
    `b5b6e44f7c58531c9e0a62b00e42c7a359c1ae3d660aeb3465cbc1b7ea29978b`
  - file sha256 `faf072925c169ede89788e17c66cd6ab446fa332d47ae0362fca46dbb1a4e4f8`, 1,030,912 bytes (code 1,030,897)
  - staged copy for the owner: `~/mct-runner-study/launch-debt-egg-2026-10-09/b17-upgrade/burn_receipts-116ff5ad.so`
- Program data on chain (read 2026-10-21 07:03): `CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn`, space 1,029,821, code capacity
  1,029,776; the new code needs 1,030,897, short by 1,121 → **extend 10,240 bytes** (about 0.052 SOL, stays in the program account).
- Deployer `F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P` held 5.606 SOL at 06:55; buffer rent 5.2385 SOL (returns to the spill at
  execute), extend 0.052, fees ≤ 0.05. Enough; no transfer needed.

## M0. Variables (owner's Mac terminal)
```
M=~/.config/meme-coin-trader/mainnet-keys; RPC=<the host's mainnet RPC url, from its private env file>
B=~/mct-runner-study/launch-debt-egg-2026-10-09/b17-upgrade; E=~/Projects/meme-coin-trader/docs/burnkeeper/evidence/mainnet-b17
S=~/.local/share/solana/install/active_release/bin; BR=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM
VAULT=8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV; MS=7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc
$S/solana-keygen pubkey $M/deployer.json          # must print F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P
shasum -a 256 $B/burn_receipts-116ff5ad.so        # must print faf072925c169ede89788e17c66cd6ab446fa332d47ae0362fca46dbb1a4e4f8
$S/solana balance F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P -u "$RPC"   # at least 5.4 SOL
```

## M1. Extend the program data (owner signs)
```
$S/solana program extend $BR 10240 -u "$RPC" -k $M/deployer.json | tee $E/br-extend.log
$S/solana program show $BR -u "$RPC" | grep "Data Length"      # 1040016 (≥ 1,030,897)
```

## M2. Write the buffer (owner signs)
```
$S/solana program write-buffer $B/burn_receipts-116ff5ad.so -u "$RPC" -k $M/deployer.json --with-compute-unit-price 20000 --max-sign-attempts 20 | tee $E/br-buffer.log
```
Note the printed `Buffer:` address as BUF. If it stops part-way: `solana program close BUF -u "$RPC" -k $M/deployer.json` returns
the rent, then write again.

## M3. Hand the buffer to the vault (owner signs), then the byte check (Claude, read-only)
```
$S/solana program set-buffer-authority BUF --new-buffer-authority $VAULT -u "$RPC" -k $M/deployer.json | tee $E/br-set-buffer-authority.log
```
Paste BUF to Claude. Claude dumps the buffer and hashes it; it must print `b5b6e44f7c58531c9e0a62b00e42c7a359c1ae3d660aeb3465cbc1b7ea29978b`.

## M4. The Squads proposal (owner, in the app)
Program upgrade of `AuQjoSgq…` from buffer BUF, spill = the deployer `F1b481n5…` (the rent comes back to it), memo "B-17".
Claude then runs `scripts/squads-proposal-verify.mts --cluster mainnet --multisig $MS --expect-hash b5b6e44f…` and says yes or no.

## M5. Approve twice (owner holds two of the three keys), execute, re-verify
After execute, Claude reads the ProgramData hash on chain (must be `b5b6e44f…`), updates `config/burnticker/verified-build.json`
`deployed.mainnet.matchesBuild` to true, and publishes. The keeper and the pair client then send the B-17 account list by themselves
(`registerFeeKeyLaunchlabSlot`); until then they keep the round-5 list.

## Rollback
The previous program (`152929ce…`) stays in the table as the prior build; a rollback is the same proposal with its buffer. Do not
roll back while any coin with a pinned burn target holds fuel.
