# Devnet upgrade of burn_receipts with both burn caps removed, 2026-10-25 (executed ~20:56Z)

Build commit `94241647` (owner decision 2026-10-25: no burn-pool cap, no 2% per-run bound), devnet feature set, built twice on the
operator's Mac by `scripts/ops/verified-build.sh --local` (identical): 1,011,416 bytes, executable hash
`e52d27fcfa14f75148bfc00a298f061d3e522321370e6cb99f0f41dcdf8e13d1` = the devnet build in `config/burnticker/verified-build.json`.

Program `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM`, upgrade authority the devnet 2-of-3 Squads vault
`A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD` (multisig `GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w`, 60 s lock); members are
throwaway devnet keypairs on the operator's Mac. Devnet SOL for the buffer was gathered from the other throwaway keys (the faucet was
rate-limited). Public devnet RPC throughout.

| step | result |
|---|---|
| program data 1,038,581 bytes ≥ 1,011,416, no extend | — |
| `write-buffer` (deployer) | buffer `EtsF76jWHhhMwQTqrf2nqG1nimBukL1yfJVH2jm6qpmq` (`write-buffer.log`) |
| `set-buffer-authority` → the vault | `set-buffer-authority.log` |
| proposal 24 via `scripts/squads-program-upgrade.mts --send` (buffer executable hash = table = local file) | `propose.log` |
| approve squads-a, squads-b (20:54Z) | `approve.log` |
| execute after the 60 s lock | `2E1cPAojQV8wBvYeNpoijisTsKPWoUfQERJJCp6XARowd34FycS8sM7uXvTEiZtxeh4wzs6AXknutLzeoYNNbvzh` (`execute.log`) |

Read back at 2026-10-25T20:56:06Z (`onchain-after.log`, `program-show-after.txt`): executable hash `e52d27…13d1` = the build (MATCH); last-deployed
slot see program-show-after.txt. pair_curve on devnet was not upgraded in this rehearsal (its table row DIFFERs, expected).
