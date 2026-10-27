# Mainnet upgrade: burn_receipts (and pair_curve) with both burn caps removed — execution sheet (prepared 2026-10-25, Denver)

Same shape as `mainnet-b17/README-execution.md`: buffer → buffer authority to the vault → Squads proposal in the app → Claude
verifies on chain → two approvals → execute → Claude re-verifies. The owner signs every step that moves anything; Claude prepares
and checks. The Squads time lock is 0 (owner decision 2026-10-11), so execute follows the second approval at once.

## What is being deployed
- Source: monorepo commit `94241647` (owner decision 2026-10-25: no 25 SOL burn-pool cap, no cap-raise power, no cranker
  allowlist, no 2% per-run reserve bound, no carried budget pacing; a burn spends the rule's full share in one run). Every account
  layout, instruction, discriminator and error code 6000–6143 is unchanged; 6144 CapRemoved is new; propose/cancel/apply cap
  raise refuse. Devnet rehearsal: `docs/burnkeeper/evidence/devnet-caps/`.
- Builds: `scripts/ops/verified-build.sh --local` on the operator's Mac, run twice, identical.
  - burn_receipts (mainnet features): executable hash
    `1aff5fbfe243ea8233c360bfae6809b0dd411e2298600831d10be5ea97c99e17`, file sha256 `c753fc2763f794df665b60a23591397e6526567b0c81c86d76533394d30bb4d7`, 1,011,440 bytes.
  - pair_curve (mainnet features): executable hash
    `8d21ff603670000ac7e1f492aea842fc37891c26197df88b5b7135656373f1e3`, file sha256 `9205de80b377a3fc3c4c8b3de93b66c8a49e8120a78b082e3e5ed850d142088d`, 419,304 bytes. Its source is
    unchanged; the binary moved because it links burn_receipts as a library. Upgrading it keeps the verified-build table and the
    trust page honest. Round 2, after round 1's rent returns.
  - staged copies for the owner: `~/mct-runner-study/launch-debt-egg-2026-10-09/caps-upgrade/`.
- Program data on chain (read 2026-10-25 via public RPC): burn_receipts ProgramData `CqKa66Tx…gbKn` space 1,040,061 (≥ 1,011,440:
  **no extend**); pair_curve ProgramData `D7yNbaLY…UKTG` space 421,581 (≥ 419,304: **no extend**).
- Deployer `F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P` holds 5.548 SOL (read 2026-10-25). Round 1 buffer rent ≈ 5.14 SOL,
  returned to the deployer (spill) at execute. Round 2 buffer rent ≈ 2.14 SOL, from the returned rent. No transfer needed if the
  rounds run in order.

## M0. Variables (owner's Mac terminal)
```
M=~/.config/meme-coin-trader/mainnet-keys; RPC=<the host's mainnet RPC url, from its private env file>
B=~/mct-runner-study/launch-debt-egg-2026-10-09/caps-upgrade; E=~/Projects/meme-coin-trader/docs/burnkeeper/evidence/mainnet-caps
S=~/.local/share/solana/install/active_release/bin; BR=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM; PC=2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN
VAULT=8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV; MS=7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc
$S/solana-keygen pubkey $M/deployer.json          # F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P
shasum -a 256 $B/burn_receipts-94241647.so        # c753fc2763f794df665b60a23591397e6526567b0c81c86d76533394d30bb4d7
$S/solana balance F1b481n5KLLJQ8xQyAtjmZdX8zBv726qwg9TrpDZJv5P -u "$RPC"   # at least 5.3 SOL
```

## Round 1 — burn_receipts

### M1. Write the buffer (owner signs)
```
$S/solana program write-buffer $B/burn_receipts-94241647.so -u "$RPC" -k $M/deployer.json --with-compute-unit-price 20000 --max-sign-attempts 20 | tee $E/br-buffer.log
```
Note the printed `Buffer:` address as BUF. If it stops part-way: `$S/solana program close BUF -u "$RPC" -k $M/deployer.json` returns the rent; write again.

### M2. Hand the buffer to the vault (owner signs), then the byte check (Claude, read-only)
```
$S/solana program set-buffer-authority BUF --new-buffer-authority $VAULT -u "$RPC" -k $M/deployer.json | tee $E/br-set-buffer-authority.log
```
Paste BUF to Claude. Claude dumps the buffer and hashes it; it must print `1aff5fbfe243ea8233c360bfae6809b0dd411e2298600831d10be5ea97c99e17`.

### M3. The Squads proposal (owner, in the app)
Program upgrade of `AuQjoSgq…` from buffer BUF, spill = the deployer `F1b481n5…`, memo "caps removed".
Claude runs `scripts/squads-proposal-verify.mts --cluster mainnet --multisig $MS --expect-hash 1aff5fbf…` and says yes or no.

### M4. Approve twice, execute, re-verify
After execute, Claude reads the ProgramData hash (must be `1aff5fbf…`) and writes `onchain-verify-after.log` here.

## Round 2 — pair_curve (same steps with $PC, `$B/pair_curve-94241647.so`, expected hash `8d21ff60…f1e3`, memo "caps removed, pair_curve relink")

## Afterwards (Claude)
`config/burnticker/verified-build.json` deployed rows → matchesBuild true; publish 127 (the site copy already says there is no cap);
then GasCat's review page is a Launch click again.

## Round 1 — executed 2026-10-25 22:10:51Z
Buffer `AdyxJ3ZBCy6xPZXcQB7eFcVUdduHKbjx78h8WhrUBzea` (bytes checked on chain before the proposal: `br-buffer-check.txt`, MATCH).
Squads vault transaction index 5, proposal `ABfWPBsNJCstacyW17uRJvGZkySX6c4T5NjkAEgHLF6K`, approved by `57ugkFkT…4crt` and `DLxTkuqM…6ZCJ`,
executed in `3S8o216anWPUx2Exen3JLMUwP8CbheYVo8B1oYWsQ9RSsTQmrVWpYkPjrDweheyfJ8AWPBBjZNZqts5tbGD9Fkgs` (the verifier's later "buffer does not exist" is the consumed buffer; `br-proposal-verify.txt`). Read back (`onchain-verify-after.log`):
executable hash `1aff5fbf…9e17` = the build, MATCH; last-deployed slot 461,421,913; upgrade authority still the vault; the buffer rent returned to
the deployer (5.543 SOL after).

## Round 2 — pair_curve, executed 2026-10-25 ~22:20Z
Buffer `3JxG5rWk6rbHZ9tq9wbeFtvEmt1EQq7vnqEaSpqUw2J3` (`pc-buffer-check.txt`, MATCH 8d21ff60…f1e3). Squads vault transaction index 6, verified before
approval (`pc-proposal-verify.txt`, verdict "matches"), approved by both owner keys, executed in `46RRG147iD6CU7ti6wTv1kzWCZFbqxQSCa8Poz8yxfvweYWi6YJCXcSyoUYu4ZhLvKysaUMK52HDgJ5dEBcWqmjg`. Read back (`onchain-verify-after.log`): both programs
MATCH; pair_curve last-deployed slot 461,423,192; authority still the vault; deployer 5.541 SOL after both rents returned.
