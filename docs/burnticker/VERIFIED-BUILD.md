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
deployed program. Source: monorepo commit `6fc15f00ff13c86c7efdc9e7a69573527d6bde9c`, the last commit that changed the compiled program sources — the §40 blind
review r2 fixes (docs/burnticker/reviews/2026-10-11-pair-forward-blind.md: no result can wedge a queue, the loser's quorum consents, a
win servable without the pools, unlink_pair, link before readings) on top of LAUNCHPAD-PATH §40, winner takes the burn. pair_curve's
source is unchanged; it links the burn_receipts crate, so its bytes change with it. Both programs are built at opt-level "z".

| Program | Program id | Build | Features | Bytes | Executable hash | Deployed on devnet |
|---|---|---|---|---|---|---|
| burn_receipts | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` | mainnet | default | 749,552 | `2eb83584ffd550dbac4f7fd9d6fa5ff0ad6625e7e68ce26e98d658f4b3fdabc3` | — (not deployed on mainnet) |
| burn_receipts | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` | devnet | `devnet` | 749,736 | `5a2d16004ec70c6cbcc1e3f9877b9784b141d8717f5b5e23bbba57fb4d62bf87` | `5a2d16004ec70c6cbcc1e3f9877b9784b141d8717f5b5e23bbba57fb4d62bf87` = build (upgraded through the Squads vault 2026-10-11, vault transaction 15; docs/burnkeeper/devnet-pair-forward-r2-run-log.md) |
| pair_curve | `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` | mainnet | default | 410,008 | `82310a2d990146007a2ba82e4c1a89aa3f811ce4a53443b666606816e3101bf4` | — (not deployed on mainnet) |
| pair_curve | `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` | devnet | `devnet` | 410,064 | `96b8d79cd46bd6b0d8d6069656f1ab2fdddca47b82e6e2e1e6607dff6e4ef178` | `96b8d79cd46bd6b0d8d6069656f1ab2fdddca47b82e6e2e1e6607dff6e4ef178` = build (vault transaction 16, same run) |

**Bytecode version: sBPFv3 (SIMD-0500 checked 2026-10-11).** cargo-build-sbf 4.4.0 (Solana CLI 4.3.0, platform-tools v1.57, Anchor
1.2.1) builds `--arch v3` by default, and all four rows above are sBPFv3 — ELF header `e_flags = 0x3` (`readelf -h <file>.so | grep
Flags`), the same on the bytes read back from devnet. SIMD-0500 ("Disable deployment of SBPF v0, v1 and v2 programs", feature
`B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`) is still inactive on mainnet and devnet (`solana feature status`, 2026-10-11); once it is
active it refuses deploys, upgrades and finalisations of v0–v2 bytes only. Deployment of v3 programs is already enabled on both clusters
(SIMD-0178/0189/0377, feature `5cC3foj77CWun58pC51ebHFUWavHWKarWyR5UUik7dnC`: mainnet since epoch 993, devnet since epoch 1069) — the
devnet upgrades of 2026-10-10 (r2) and 2026-10-11 (§40) are v3 bytes accepted under it. So these builds can be deployed on mainnet
now, upgraded after SIMD-0500, and finalised (upgrade authority → none) later; no rebuild flag is needed. Source:
https://solana.com/upgrades/sbpfv3-programs and the on-chain feature set.

**Feature sets (lp-lock blind review I-7).** Only the two builds above are deployable: `default` (mainnet) and `devnet`. They differ
in the Raydium ids, the genesis tag, OPERATOR_TREASURY and BURNTICKER_PLATFORM compiled in. `localnet` and `test-pins` builds exist
for the local validator and the LiteSVM suites only. They compile a test treasury (`[0x7e; 32]`, unspendable) and the harness's test
platform, and must never be deployed anywhere: a `localnet` build on mainnet would route the 20 % to an unspendable address. A
`devnet` build on mainnet would route it to the devnet vault's address and would not match mainnet's Raydium ids. The upgrade script
refuses any buffer whose executable hash is not one of this table's rows.

**Previous builds (history, no longer deployed):** the r2 intermediate (source `bfe3bfd6`, superseded within the hour by the servability change): burn_receipts devnet
`7a70b20841cd7e418111ef5d9833b4f43e1eadd75a90a9cf39581c5d8a7ef90e`, pair_curve devnet `bdb8ae753c5de001e33e5023d2ec6901f80d1c486ed2cd7874e7ee59c7d63dc6`
(vault transactions 13 / 14). §40 winner takes the burn (source `c1834074`): burn_receipts mainnet
`7d1949a20e0438ed418af1cd545f993bdebbbcceaf2c3e1603cc7e7f34ff7a22` / devnet `b23df8fa78c25c6f7375f9a5bb5cd7341f0bfe063e1b9b6af8ffebf0a54f97a5`
(729,048 / 729,232 B; vault transaction 11), pair_curve mainnet `abe0ce277ee7cb6d3d9e0663924fc3590c433e8d80e9fb3f60f68f7d5d2e73ab` / devnet
`f8c515cd1509260fd65fca6c261fbee4fa3847babd85f928e686c09268bc83c7` (409,224 / 409,280 B; vault transaction 12). Before that, the LP-lock r2 fixes (source `40e13bf5`): burn_receipts mainnet `d7353e39858d5668fc97692841fca33f1824ba2f66c30c085baf47cc158478ac` / devnet
`b5b7ea596e66b4dd890af6a3f67d526b3ca825979ebb8f88f497fe235e2a00a3` (643,144 / 643,328 B; vault transaction 9), pair_curve mainnet
`a67b48947fb031ea7e401d33bbaf23579b7feac6288536d60ae6b97b9575827d` / devnet `7d1b06a568ac7ef70c89e6ba8b7e6f5fabf22793652aeceeb2b3c64b945c7796`
(406,624 / 406,680 B; vault transaction 10). Before that, the LP-lock release (source `3d82b6b5`): burn_receipts mainnet
`088c0b1d5967a0ede42945abb916532e41835a5ba725ecb6439f620f5347024f` / devnet `f18ba9cce758fc3dbd69b7f632e26feedad0c90dfbf444f681e094eefe24d151`
(635,968 / 636,056 B; vault transaction 8), pair_curve mainnet `8587c45adf033bfb0d45d7b7ab36ed224fe87a38a279af98316b440971ab3ff0` / devnet
`e406b969432d3dec0d1a90d15b5bd8132b7be64c24b9a98c55317e38c199adc5` (393,488 / 393,544 B; vault transaction 7). Before that: burn_receipts mainnet `3ecae91b0cf52c271b38e2e48aa0a45154f1d84a61f331e01a7bc74f32d9074f` /
devnet `5ad3dd54287394b13e5e95ebca81b7aeebde6b58d941b27cbf13eaf3feea8f8d` (721,096 B, source `fcda14eb`, graduation LP destroyed under the pre-lock policy);
pair_curve mainnet `9ef38e0d8954f6c8242d8157dccdc8a2b169dbd987b13f588c5096ee280ec006` / devnet
`91d403e061d37a999e418ca552545ff480bcf006b745be6c4d261dd0d05379d9` (365,824 / 365,880 B, source `fcda14eb`, re-check round 2). The
devnet LP-lock release was first deployed at source `d54664ed` (burn_receipts devnet `755fb289…`, pair_curve devnet `affb2774…`,
vault transactions 5 and 6, 21:42 Denver) and replaced 14 minutes later by the treasury-parking fix above.

The burn_receipts **mainnet** row also pins no LaunchLab platform yet (BURNTICKER_PLATFORM = the all-zero placeholder, lp-lock blind
review RL-3): every policy-0 and policy-2 initialize_token fails with `PlatformNotPinned` until the owner's mainnet platform is compiled
in, which changes this hash. It also carries no operator treasury yet (the all-zero placeholder): claim_lock_fees refuses every
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
