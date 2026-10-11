# Verified build — is the deployed code this code?

Trust pack, 2026-10-10. This page says how to rebuild `burn_receipts` and `pair_curve` from this repository and compare the result
with the bytes deployed on chain. The table is `config/burnticker/verified-build.json`, written by `scripts/ops/verified-build.sh`;
`test/burntickerVerifiedBuild.test.ts` holds this page and the table together and compares any built `.so` on the host with it.

## Status: INTERIM (local build, no Docker)

**The hashes below come from a local `cargo build-sbf` on the operator's Mac, not from solana-verify's Docker image.** Docker is not
installed on that host (`docker info` → command not found, 2026-10-10). What was checked instead:

- a clean build in a fresh checkout (a new cargo target directory) gave the same bytes as the build in the main checkout;
- the devnet builds (`--features devnet`, Raydium's devnet program ids compiled in) are **byte-for-byte the programs deployed on
  devnet**: `solana program dump` of both program ids, hashed the same way, gives the same numbers (`bash scripts/ops/verified-build.sh
  --onchain devnet` → MATCH, MATCH);
- both programs' upgrade authority on devnet is the Squads vault `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD` (read from the
  ProgramData accounts).

What is not checked yet: that a build inside solana-verify's Docker image (the reproducible environment anyone can run) gives the
same numbers. It may not — a different platform-tools version gives different bytes — and when it runs on a Linux host, its numbers
replace this table (`kind: docker`). The OtterSec verified-builds registry entry is mainnet-only and comes after the mainnet deploy
(owner step: docs/burnticker/TODO-OWNER.md).

## The hashes

The executable hash is solana-verify's definition: sha256 of the program bytes with trailing zero bytes removed — the number
`solana-verify get-executable-hash <file.so>` prints for a build and `solana-verify get-program-hash <PROGRAM_ID>` prints for the
deployed program. Source: monorepo commit `3d82b6b5d4beb771467462ac753673d9f0626f33`, the last commit that changed the compiled program sources — the LP-lock
release (LAUNCHPAD-PATH §35: graduation LP locked forever in Raydium's CPMM lock, the Fee Key held by burn_receipts, claim_lock_fees
80 % burn pool / 20 % operator). Both programs are built at opt-level "z" from this release on.

| Program | Program id | Build | Features | Bytes | Executable hash | Deployed on devnet |
|---|---|---|---|---|---|---|
| burn_receipts | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` | mainnet | default | 635,968 | `088c0b1d5967a0ede42945abb916532e41835a5ba725ecb6439f620f5347024f` | — (not deployed on mainnet) |
| burn_receipts | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` | devnet | `devnet` | 636,056 | `f18ba9cce758fc3dbd69b7f632e26feedad0c90dfbf444f681e094eefe24d151` | `f18ba9cce758fc3dbd69b7f632e26feedad0c90dfbf444f681e094eefe24d151` = build (upgraded through the Squads vault 2026-10-10 21:56 Denver, vault transaction 8) |
| pair_curve | `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` | mainnet | default | 393,488 | `8587c45adf033bfb0d45d7b7ab36ed224fe87a38a279af98316b440971ab3ff0` | — (not deployed on mainnet) |
| pair_curve | `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` | devnet | `devnet` | 393,544 | `e406b969432d3dec0d1a90d15b5bd8132b7be64c24b9a98c55317e38c199adc5` | `e406b969432d3dec0d1a90d15b5bd8132b7be64c24b9a98c55317e38c199adc5` = build (upgraded through the Squads vault 2026-10-10 21:56 Denver, vault transaction 7) |

**Previous builds (history, no longer deployed):** burn_receipts mainnet `3ecae91b0cf52c271b38e2e48aa0a45154f1d84a61f331e01a7bc74f32d9074f` /
devnet `5ad3dd54287394b13e5e95ebca81b7aeebde6b58d941b27cbf13eaf3feea8f8d` (721,096 B, source `fcda14eb`, graduation LP destroyed under the pre-lock policy);
pair_curve mainnet `9ef38e0d8954f6c8242d8157dccdc8a2b169dbd987b13f588c5096ee280ec006` / devnet
`91d403e061d37a999e418ca552545ff480bcf006b745be6c4d261dd0d05379d9` (365,824 / 365,880 B, source `fcda14eb`, re-check round 2). The
devnet LP-lock release was first deployed at source `d54664ed` (burn_receipts devnet `755fb289…`, pair_curve devnet `affb2774…`,
vault transactions 5 and 6, 21:42 Denver) and replaced 14 minutes later by the treasury-parking fix above.

The burn_receipts **mainnet** row also carries no operator treasury yet (the all-zero placeholder): claim_lock_fees refuses every
claim (TreasuryNotPinned) until the owner's mainnet Squads vault is compiled in, and the fees wait in the lock meanwhile.

The pair_curve **mainnet** row is a build that can never open a pair: its `BURNTICKER_PLATFORM` is still the all-zero placeholder, so
every `init_pair` fails with `PlatformNotPinned` (runbook gate P0). Pinning the owner's mainnet LaunchLab platform changes that hash;
the table is rewritten then. `scripts/squads-program-upgrade.mts` refuses any buffer whose executable hash is not this table's.

The publish entries in `docs/burnticker/CHANGELOG.md` record the plain sha256 of `target/deploy/burn_receipts.so` (`f3812ce4…` for
the same default build); the executable hash differs only because it strips the file's 15 trailing zero bytes.

Toolchain of the interim build: Solana CLI 4.3.0, cargo-build-sbf 4.4.0, platform-tools v1.57 (rustc 1.95.0-sbpf-solana-v1.57),
Anchor 1.2.1, macOS arm64. The same program id serves devnet and mainnet (decision D-7); the two builds differ only in the Raydium
program ids compiled in.

## Reproduce it

### Locally (what the table holds today)

```sh
bash scripts/ops/verified-build.sh --local            # builds both programs × {default, --features devnet}; MATCH/DIFFER per hash
bash scripts/ops/verified-build.sh --onchain devnet   # dumps the deployed programs (read-only RPC) and compares
```

The program keypairs are not needed: the ids are compiled in from `declare_id!`. `cargo build-sbf --sbf-out-dir` writes a throwaway
keypair beside the output, never into `target/deploy`. Nothing is sent to any cluster.

### Docker host (the real verifiable build)

On a Linux machine with Docker (a throwaway VM is fine — it needs no key and no wallet):

```sh
cargo install solana-verify --locked
git clone https://github.com/rfzfhn67yk-netizen/burnticker && cd burnticker && git checkout <PUBLIC_REPO_COMMIT>
bash scripts/ops/verified-build.sh --docker           # solana-verify build programs/burn-receipts --library-name <lib> [-- --features devnet]
bash scripts/ops/verified-build.sh --docker --write   # if the numbers differ, record them (kind: docker) and commit the table
```

`SV_BASE_IMAGE=solanafoundation/solana-verifiable-build:<version>` pins the image when solana-verify cannot pick one for the
workspace's Solana version (4.3.0 at the time of writing).

### `solana-verify verify-from-repo`

`<PUBLIC_REPO_COMMIT>` is the public repository's commit that carries these sources (each publish records it in
`docs/burnticker/CHANGELOG.md`). `bash scripts/ops/verified-build.sh --commands <commit>` prints these with the commit filled in.

Devnet, now (anyone can run it; it builds in Docker and compares with the deployed program):

```sh
solana-verify verify-from-repo -u https://api.devnet.solana.com --program-id AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM \
  https://github.com/rfzfhn67yk-netizen/burnticker --commit-hash <PUBLIC_REPO_COMMIT> --library-name burn_receipts \
  --mount-path programs/burn-receipts -- --features devnet
solana-verify verify-from-repo -u https://api.devnet.solana.com --program-id 2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN \
  https://github.com/rfzfhn67yk-netizen/burnticker --commit-hash <PUBLIC_REPO_COMMIT> --library-name pair_curve \
  --mount-path programs/burn-receipts -- --features devnet
```

Mainnet, after the owner deploys (default features; answer "n" to the PDA upload prompt — the upgrade authority is the Squads vault,
so the verification PDA goes through a Squads proposal, next section):

```sh
solana-verify verify-from-repo -um --program-id AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM \
  https://github.com/rfzfhn67yk-netizen/burnticker --commit-hash <PUBLIC_REPO_COMMIT> --library-name burn_receipts --mount-path programs/burn-receipts
solana-verify verify-from-repo -um --program-id 2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN \
  https://github.com/rfzfhn67yk-netizen/burnticker --commit-hash <PUBLIC_REPO_COMMIT> --library-name pair_curve --mount-path programs/burn-receipts
```

### The OtterSec verified-builds registry (mainnet only — owner step)

The registry (verify.osec.io, shown by explorers as "Verified") accepts only programs on mainnet, and the verification PDA must be
written by the program's upgrade authority — the Squads vault. For each program:

```sh
solana-verify export-pda-tx https://github.com/rfzfhn67yk-netizen/burnticker --program-id AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM \
  --uploader <MAINNET_SQUADS_VAULT> --encoding base58 --compute-unit-price 0 \
  --commit-hash <PUBLIC_REPO_COMMIT> --library-name burn_receipts --mount-path programs/burn-receipts
# Squads → Developers → TX builder → import the printed base58 transaction → two signers approve → execute. Then:
solana-verify remote submit-job --program-id AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM --uploader <MAINNET_SQUADS_VAULT>
# repeat both for pair_curve (2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN, --library-name pair_curve)
# status: solana-verify remote get-job-status, or https://verify.osec.io/status/<PROGRAM_ID>
```

## What the test checks

`test/burntickerVerifiedBuild.test.ts`: the table validates (both programs, both builds, 64-hex hashes, the devnet build uses the
`devnet` feature, `matchesBuild` agrees with the hashes); every hash in the table appears in this page; the executable-hash function
strips trailing zeros exactly as solana-verify does; and **when a build is present on the host** (`programs/burn-receipts/target/deploy/*.so`
for the default build, `target/deploy-devnet/*.so` for the devnet build) its hash equals the table — skipped otherwise, like the IDL test.
