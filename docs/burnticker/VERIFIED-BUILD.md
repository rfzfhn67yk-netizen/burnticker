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
deployed program. Source: monorepo commit `29f6f5de19f1916945992fae711cefc36927d856` (end-sink round 4 with the pair-forward round-3 re-check fixes, 2026-10-12; both programs upgraded on devnet and mainnet the same day — docs/burnkeeper/evidence/devnet-round4, docs/burnkeeper/evidence/mainnet-round4), before that `bc0565589ad99c774786adc21bc1e505c6e5f733`, the last commit that changed the compiled program sources — the
owner's mainnet pins (OPERATOR_TREASURY, BURNTICKER_PLATFORM; they change the two mainnet rows only — the devnet bytes are identical to
the deployed `a3a968e5` build) on pair-forward round 3 (docs/burnticker/reviews/2026-10-11-pair-forward-recheck.md: terminal-only unlink evidence, one attester set per pair with the
partner co-signing attester changes, link_pair after readings, the forward window and basis) on top of the §40 blind review r2 fixes and
LAUNCHPAD-PATH §40, winner takes the burn. pair_curve's source is unchanged; it links the burn_receipts crate, so its bytes change with
it. Both programs are built at opt-level "z".

| Program | Program id | Build | Features | Bytes | Executable hash | Deployed (read back from chain) |
|---|---|---|---|---|---|---|
| burn_receipts | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` | mainnet | default | 826,384 | `d9d447524754d52d1083c5027ebe2772fe779814c329fb07363dc90350ded2ae` | mainnet 2026-10-12, slot 456198354 (round-4 upgrade, Squads vault transaction 1): on-chain sha256 `b1f51c4826a0b79a865ec8aa26ffbab7a0a40b08cad04235a45c215f630526c7` = this build (docs/burnkeeper/evidence/mainnet-round4/) |
<!-- previous row: 2026-10-11 slot 455814493, hash e64a2759…dc19 -->
<!-- || burn_receipts | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` | mainnet | default | 763,536 | `e64a27598808e5c9564833341f892bb8be9f6d0b7254108dde68d09f7141dc19` | mainnet 2026-10-11, slot 455814493: on-chain sha256 `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` = this build (upgrade authority the Squads vault 8zsHrHjS…WrDV; docs/burnkeeper/evidence/mainnet-deploy-2026-10-11/deploy.json) | -->
| burn_receipts | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` | devnet | `devnet` | 826,392 | `87d20b26f9e4c8e4fb4847b7a6d0ae3f938e049008c4fa5c124d4e396687630a` | `87d20b26f9e4c8e4fb4847b7a6d0ae3f938e049008c4fa5c124d4e396687630a` = build (upgraded through the devnet Squads vault 2026-10-12, vault transaction 19; docs/burnkeeper/evidence/devnet-round4/) |
<!-- || burn_receipts | `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM` | devnet | `devnet` | 763,536 | `90bd47e6b48a1e2f0580f33c6dba49c140b8a8ec2c751899b8652f8c034a4b35` | `90bd47e6b48a1e2f0580f33c6dba49c140b8a8ec2c751899b8652f8c034a4b35` = build (upgraded through the Squads vault 2026-10-11, vault transaction 17; docs/burnkeeper/devnet-pair-forward-r3-run-log.md) | -->
| pair_curve | `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` | mainnet | default | 413,224 | `567f37001f4ecc9966ddce3ca3ac2da8262a1138d21c90825591c08d0bc8a895` | mainnet 2026-10-12, slot 456201604 (round-4 upgrade, vault transaction 2): on-chain sha256 `8effaac2f1a1c19ff1505ce72f28d1ae60c02c971f2411ffab707bfd29fbded2` = this build (same evidence folder) |
<!-- || pair_curve | `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` | mainnet | default | 411,296 | `50bf57327c5234c22841d325214c293136f35a20b8c599ff7e5c89d84248b3ef` | mainnet 2026-10-11, slot 455815136: on-chain sha256 `f19f4bc11b53ba509a1a1f643927d88900954ad9afb6e60f1f815aa967018767` = this build (same vault, same evidence file) | -->
| pair_curve | `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` | devnet | `devnet` | 413,224 | `364eac3de338f5356d66bba2e74dca52859f4f0339c10dbdf759173339a701cf` | `364eac3de338f5356d66bba2e74dca52859f4f0339c10dbdf759173339a701cf` = build (devnet vault transaction 20, same day) |
<!-- || pair_curve | `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN` | devnet | `devnet` | 411,296 | `ae947d591cfe357c8d911fc9e9fdc68800888d8a3fbb97b9113dfcf7d600bf42` | `ae947d591cfe357c8d911fc9e9fdc68800888d8a3fbb97b9113dfcf7d600bf42` = build (vault transaction 18, same run) | -->

**Round 5 (external burn targets, docs/burnticker/EXTERNAL-BURN.md; the incinerator end sink and initialize_token_r5, docs/burnticker/END-SINK.md): built 2026-10-13 on the same Mac and toolchain, NOT deployed.**
These rows go into the table above only when the upgrade lands (the staging copy for the upgrade script is
docs/burnkeeper/evidence/devnet-round5/verified-build.round5.json; the same toolchain rebuilt round 4 from source to exactly
`d9d44752…d2ae`, the deployed hash):

- burn_receipts mainnet (default features): 967,304 B, executable hash `224d10b192e9d7e7378bdac8df8343afac929dc2e4a35a3966009d5ec616ca87`
- burn_receipts devnet (`devnet`): 967,280 B, executable hash `50fc618e4108cf77f5a7223c0c3558b6f745a129e597b1e30e43518e75aaf8c6`
- The program grows by about 141 KB: each cluster's program data needs `solana program extend` by 143,360 bytes (about 1.00 SOL of
  rent) before the upgrade (DEVNET-ROUND5-TEST-PLAN.md, step U2).

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

**Previous builds (history, no longer deployed):** pair-forward round 2 (source `6fc15f00`): burn_receipts mainnet
`2eb83584ffd550dbac4f7fd9d6fa5ff0ad6625e7e68ce26e98d658f4b3fdabc3` / devnet `5a2d16004ec70c6cbcc1e3f9877b9784b141d8717f5b5e23bbba57fb4d62bf87`
(749,552 / 749,736 B; vault transaction 15), pair_curve mainnet `82310a2d990146007a2ba82e4c1a89aa3f811ce4a53443b666606816e3101bf4` / devnet
`96b8d79cd46bd6b0d8d6069656f1ab2fdddca47b82e6e2e1e6607dff6e4ef178` (410,008 / 410,064 B; vault transaction 16;
docs/burnkeeper/devnet-pair-forward-r2-run-log.md). The r2 intermediate (source `bfe3bfd6`, superseded within the hour by the servability change): burn_receipts devnet
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

**The mainnet rows carry the owner's pins (2026-10-11).** burn_receipts: `OPERATOR_TREASURY` = `8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5`
(the owner's hardware wallet, which is also the LaunchLab platform's fee wallet — owner decision; not the Squads vault): claim_lock_fees
pays the 20 % there and nowhere else. burn_receipts and pair_curve: `BURNTICKER_PLATFORM` = `94x5qDDJP4UCkeMWppnmvqTmMgo971h3d6MDRnjEfYy9`
= getPdaPlatformId(LaunchLab `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`, admin `EMht6aGcQWsBjKx4Ya41giF3G9MdZn1PVvctEjb6Tt23`) —
re-derived with the Raydium SDK (the same derivation gives the devnet platform `GvSKpe5p…` from `Bfy67…`). That PlatformConfig does not
exist on chain yet: until the admin creates it, initialize_token (policies 0 and 2) and init_pair cannot read it and fail. No other
placeholder is left in either mainnet build (CLUSTER_GENESIS_HASH is mainnet's; the Raydium ids are mainnet's). Both mainnet builds
are sBPFv3 (e_flags 0x3). Upgrade authority after the deploy: the mainnet Squads vault `8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV`
(multisig `7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc`). `scripts/squads-program-upgrade.mts` refuses any buffer whose executable
hash is not this table's.

**Mainnet deploy (Monday 2026-10-12) — runbook delta.** Build: `bash scripts/ops/verified-build.sh --local` must print MATCH for both
mainnet rows (default features; the files land in `$TMPDIR/burnticker-verified-build/local-mainnet/`). Rent (`solana rent`, mainnet,
2026-10-11: 5,080 lamports/byte): burn_receipts needs 3.8796 SOL for its buffer and 3.8796 SOL for its program data (peak ≈ 7.76 SOL;
the buffer's lamports come back when the deploy completes), pair_curve 2.0902 + 2.0903 SOL (peak ≈ 4.18) — ≈ 5.97 SOL stays locked in
the two program-data accounts. Deployed one after the other, the deployer's 10 SOL covers both (≈ 4 SOL left, less fees). No `--max-len` headroom is needed (program data is extended at upgrade time with `solana program
extend`, as on devnet). Deploy each with its program-id keypair (the one devnet was deployed with; `solana-keygen pubkey` must print the
id): `solana program deploy -u mainnet-beta -k <deployer.json> --program-id <AuQjoSgq… keypair> <local-mainnet>/burn_receipts.so`,
then pair_curve likewise with the `2jQotwSG…` keypair; confirm `bash scripts/ops/verified-build.sh --onchain mainnet` prints MATCH;
then `solana program set-upgrade-authority -u mainnet-beta -k <deployer.json> <PROGRAM_ID> --new-upgrade-authority
8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV --skip-new-upgrade-authority-signer-check` for each, and `solana program show <PROGRAM_ID>
-u mainnet-beta` must show that authority. Platform: the admin `EMht6aGc…` creates the PlatformConfig with the transaction printed by
`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnticker-platform-config.mts --admin
EMht6aGcQWsBjKx4Ya41giF3G9MdZn1PVvctEjb6Tt23 --fee-wallet 8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5 --cluster mainnet
--lp-platform-pct 100 --program AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM --web <https url> --img <https url>` (dry run; it prints
platformId `94x5qDDJ…`, scales 1,000,000 / 0 / 0, lock-NFT wallet = the FEE_KEYS PDA `Bj4XCAoGHy9JTcDtQovijFwpG7NsSG6Snqmf8kFi2Yt3`,
fee wallet `8cwwy895…`), signed and sent by the admin through `scripts/burnkeeper-launch.mts --platform`. Per coin, after its
initialize_token and immediately before LaunchLab's create: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import
./test/alias-hook.mjs scripts/burnreceipts-admin.mts verify-platform-pins --cluster mainnet --mint <the coin's mint>` — never create on a
non-zero exit.

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

### Throwaway Linux host (the Docker build, owner-run; ops-2 2026-10-12)

Docker is not installed on the operator's Mac and the Linux research box was deleted on 2026-10-06, so the Docker build runs on a server
created for it and deleted after it. It needs no key and no wallet, and it sends nothing to any chain.
`scripts/ops/reproducible-build-host.sh` does every step and prints one table.

1. Create the server at any cloud provider: image **Ubuntu 24.04**, the smallest shared **x86** type with 2 vCPU and 4 GB (about one
   US cent an hour). Not an ARM type: solana-verify's image is amd64. Add your SSH key; no volume, no backups.
2. From the repository on the Mac, run the script on it (it is streamed over ssh; about 30 to 40 minutes, most of it compiling
   solana-verify and pulling the build image):

   ```sh
   ssh root@<server ip> 'bash -s' < scripts/ops/reproducible-build-host.sh
   # another commit: ssh root@<server ip> 'bash -s -- --commit <public commit>' < scripts/ops/reproducible-build-host.sh
   ```

   By hand, the same steps are:

   ```sh
   apt-get update && apt-get install -y docker.io git curl build-essential pkg-config libssl-dev libudev-dev
   curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal && . "$HOME/.cargo/env"
   cargo install solana-verify --locked
   git clone https://github.com/rfzfhn67yk-netizen/burnticker && cd burnticker && git checkout af52b4a4ea0b80168a4c2e0f47a32045d1035c91
   solana-verify build programs/burn-receipts --library-name burn_receipts
   solana-verify build programs/burn-receipts --library-name pair_curve
   sha256sum programs/burn-receipts/target/deploy/{burn_receipts,pair_curve}.so
   solana-verify get-executable-hash programs/burn-receipts/target/deploy/burn_receipts.so
   solana-verify get-executable-hash programs/burn-receipts/target/deploy/pair_curve.so
   solana-verify get-program-hash -u https://api.mainnet-beta.solana.com AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM
   solana-verify get-program-hash -u https://api.mainnet-beta.solana.com 2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN
   ```

3. Read the table. The numbers to expect (the mainnet rows above):

   | Program | sha256 of the .so (the Mac build) | Executable hash (build and chain) |
   |---|---|---|
   | burn_receipts | `7f26a83adf1f6bc6ea9a495fe6cc47fa78b3e45e78ab9919025fc5f1f4f25a9a` | `e64a27598808e5c9564833341f892bb8be9f6d0b7254108dde68d09f7141dc19` |
   | pair_curve | `f19f4bc11b53ba509a1a1f643927d88900954ad9afb6e60f1f815aa967018767` | `50bf57327c5234c22841d325214c293136f35a20b8c599ff7e5c89d84248b3ef` |

   `MATCH` on both programs means the deployed bytes are what anyone gets from the public commit in solana-verify's image: record it
   with `bash scripts/ops/verified-build.sh --docker --write` on the same server (it changes the table's `kind` to `docker`), or paste
   the table to the operator, and the registry step below can follow. `DIFFER` means the Docker image's toolchain produces other bytes
   than the Mac build that was deployed (the interim warning above). Nothing is wrong on chain in that case, but the programs cannot be
   called verified until a Docker-built buffer is deployed through the Squads vault, after launch week and never on a launch night.
   If solana-verify cannot choose an image for Solana 4.3.0, set `SV_BASE_IMAGE=solanafoundation/solana-verifiable-build:<tag>`.
4. Delete the server in the provider's console. Billing stops at deletion.

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
