# Raydium LaunchLab — what the $DEFICIT launch needs from it (read, not run)

Written 2026-10-09 for the burn keeper. Sources: read from the Raydium SDK (`@raydium-io/raydium-sdk-v2` 0.2.74-alpha, the npm `latest` on 2026-10-08), its demo repo (pinned to 0.2.70-alpha) and the LaunchLab pages on docs.raydium.io, plus read-only GETs of Raydium's public config endpoints. **Nothing here was run.** No transaction was sent on any cluster, no key was made, no package was installed into this repository.

> **Update, later on 2026-10-09.** The SDK is now a pinned dependency (0.2.74-alpha), `scripts/burnkeeper-launch.mts` builds the launch from its own
> builders (`src/lib/burnKeeper/launch.ts`), the keeper's two hand-encoded claims were checked byte for byte against the SDK and kept, and the
> post-graduation CPMM claim is built (`src/lib/burnKeeper/creatorFees.ts`). The fee picture — including the post-migration `platformCpCreator`
> rule and the CPMM `collect_creator_fee` path this note calls "not built" — is in **`fees.md`**; what was simulated on each cluster and the
> owner's run book are in **`devnet-run.md`**. Three statements below are superseded: the "creator = this.scope.ownerPubKey" shape (the creator
> is a plain pubkey, not a signer — `initialize_v2` account 2), "that claim is not built", and **"the keeper's key must be the launch's
> creator"** — after the blind program review's H-2 the creator is the burn program's FEE PDA for the mint (`burnPool.ts`), and the keeper
> only pays for permissionless claims.

## The four facts that shape everything

1. **Vesting starts at graduation, not at creation.** When the bonding curve completes and the pool migrates, the program sets `vesting_schedule.start_time = block_time + cliff_period`. Until then nothing vests and nothing can be claimed. In **vault mode** the keeper's vault is empty until graduation plus the cliff, so every unit day before then is a memo-only shortfall day.
2. **Only the beneficiary can claim vested tokens, and only the creator can claim creator fees.** There is no permissionless claim and no crank. So:
   - **vault mode:** the keeper's address must be the vesting beneficiary;
   - **buyback mode (the primary mechanic):** the keeper's key must be the launch's creator, or the owner must forward the fees by hand.
3. **New launches must use `migrateType: 'cpmm'`.** The program now rejects `'amm'` with `MigrateTypeNotMatch`, even though the demo and the docs' code page still show `'amm'`.
4. **The SDK defaults every launchpad call to the mainnet program and the mainnet Raydium platform, even with `cluster: 'devnet'`.** On devnet, pass `programId` and `platformId` explicitly on every call.

## Program ids and configs

| | Mainnet | Devnet |
|---|---|---|
| LaunchLab program | `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` | `DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6` |
| Authority PDA (`vault_auth_seed`) | `WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh` | `5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq` |
| Raydium platform | `4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4` | `2Jx4KTDrVSdWNazuGpcA8n3ZLTRGGBDxAWhuKe2Xcj2a` |
| SOL global config | `6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX` | `7ZR4zD7PYfY2XxoG1Gxcy2EgEeGYrpxrwzPuwdUBssEt` |

The live config values below are from `launch-mint-v1.raydium.io/main/configs` and its devnet twin. All rates are out of 1,000,000.

| Config | Trade fee | Max lock rate | Min sell rate | Min migrate rate | Min fundraise |
|---|---|---|---|---|---|
| Mainnet SOL | 2500 (0.25%) | 800000 (80%) | 200000 | 150000 | 24 SOL |
| Devnet SOL | 2500 (0.25%) | 999999 | 1 | 1 | 1 |

A devnet USDC config also exists: `4wHbNkobu7iARU9MbCEqDSAq6JuQreGupG2Jsf2R3DFP`, quoted in `USDCoctVLVnvTXBEuP9s8hntucdJokbo17RwHuNXemT`.

## Creating the token with a locked (vesting) share

The SDK call is `raydium.launchpad.createLaunchpad({...})`, which emits `initializeV2`.

**Fields**
- `mintA`: a fresh keypair, passed in `extraSigners`.
- `name`, `symbol`, `uri`.
- `decimals`: must be 6. The SDK's `Curve.checkParam` throws otherwise.
- `configId`, `platformId`, `migrateType: 'cpmm'`.
- `supply`, `totalSellA`, `totalFundRaisingB`.
- `totalLockedAmount`, `cliffPeriod`, `unlockPeriod`.
- `buyAmount`, `createOnly`, `txVersion`.

**Units**
- Amounts are raw base units: 6 decimals for the token, and the quote token's decimals for `totalFundRaisingB`.
- `cliffPeriod` and `unlockPeriod` are in seconds.

**Defaults (`LaunchpadPoolInitParam`)**
- Supply 1,000,000,000.
- Sell 793,100,000.
- Raise 85 SOL.
- Lock 0.
- Pass all three curve values explicitly. When they are omitted, the SDK takes them from the config API.

**The cap on the locked share is enforced in both the SDK and the program**
- `totalLockedAmount ≤ supply × maxLockRate / 1e6`; a violation fails with `VestingRatioTooHigh (6010)`.
- The migration reserve (`supply − totalSell − totalLocked`) must be at least `supply × minMigrateRate`.
- On mainnet the sell must be ≥ 20% and the reserve ≥ 15%, so **the locked share is at most 65%**. With the default sell of 793.1M, a lock of 20–30% fails the reserve check, so **`totalSellA` must be lowered**.
  - Example: a 25% lock leaves at most 60% for the curve. 1B − 250M − 600M = 150M = exactly 15%.
- `total_locked_amount = 0` requires `cliff_period == unlock_period == 0`.
- The mint authority is revoked inside the create instruction, so supply is fixed from creation.

## Assigning the vested share to a designated wallet, and claiming it

**Assigning: `createVesting({ programId, poolId, beneficiary, shareAmount })`**
- Creator only.
- Allowed while the pool is still raising, i.e. before graduation. The docs' state matrix says so; the program source is not public, so this is not confirmed in code.
- One vesting record per (pool, beneficiary). The record is a PDA with seeds `["pool_vesting", pool, beneficiary]`.
- The SDK refuses `shareAmount + totalAllocatedShare > totalLockedAmount`.
- **Locked tokens never assigned are lost once the launch graduates.** Assign the whole locked amount before graduation.

**Release formula**
- `unlocked = share × min(now − start, unlock_period) / unlock_period`, where `start` already includes the cliff.
- Each claim pays `unlocked − claimed_amount`.

**Claiming: `claimVesting({ programId, poolId })`**
- Signed by the beneficiary.
- Pays into the beneficiary's associated token account. The SDK creates the account if needed.
- Reverts in three cases:
  - `PoolNotMigrated`: before graduation.
  - `VestingNotStarted`: before the cliff ends.
  - `NoAssetsToCollect`: nothing new to pay.
- Repeatable at any time.
- The SDK helper hard-codes the classic token program, so it does not work for a Token-2022 base mint.

**Vesting record layout** (`LaunchpadVesting`): an 8-byte discriminator, then `epoch` (u64), `poolId`, `beneficiary`, `claimedAmount` (u64 at byte 80), `tokenShareAmount` (u64 at byte 88), then padding. The keeper parses it in `src/lib/burnKeeper/launchlab.ts` (`parseVestingRecord`).

**What the keeper does with this (vault mode).** When `BURNKEEPER_LAUNCHLAB_POOL` is set, the keeper's key, as beneficiary, simulates a `ClaimVestedToken` into its vault before each burn day and sends it only if the program accepts.

The instruction is hand-written from the SDK's `instrument.ts`:
- **Discriminator:** `sha256("global:claim_vested_token")[0..8]`, checked in the tests.
- **Accounts, in order:** beneficiary, auth, pool, vesting record, pool base vault, beneficiary token account, mint, token program, system program, associated-token program.
- **Base-vault PDA:** derived with the SDK's CLMM constant `pool_vault`. That constant was taken as Raydium's standard value; it is flagged in the code.

## Creator fees: the buyback mode's fuel

- The creator fee is paid in the **quote token** (SOL, held as wrapped SOL) into a vault keyed by `[creator, quote mint]`.
- Only the creator can claim it: `claimCreatorFee({ programId, mintB })`, signed by the creator.
- The rate is set by the platform's `creatorFeeRate`, at most 5000 (0.5%) of each trade.

**What the keeper does with this (buyback mode).** When `BURNKEEPER_CLAIM_CREATOR_FEES=1`, the keeper builds three instructions, simulates them, and sends them only if the program accepts:
1. Create its wrapped-SOL account (idempotent).
2. `claimCreatorFee`. Discriminator `sha256("global:claim_creator_fee")[0..8]`, checked in the tests.
3. Close the wrapped-SOL account, which unwraps the claimed SOL into the keeper's wallet, i.e. the fee pool.

**This only works if the keeper's key created the launch.** Two consequences:
- **Pre-graduation fees only.** After graduation, creator fees on the CPMM pool go to the platform's `platform_cp_creator`, or to the launch creator if that is unset. They are claimed through the CPMM program. **That claim is not built.** Until it is, the owner claims post-graduation fees from Raydium's UI and sends them to the keeper's address, and the status page discloses the transfer.
- **Not exercised on chain.** No devnet launch was created.

## Registering a third-party Platform

The SDK call is `raydium.launchpad.createPlatformConfig({...})`. One platform per admin wallet; the platform is a PDA with seeds `["platform_config", admin]`.

| Field | Meaning |
|---|---|
| `platformAdmin` | Signer and owner of the platform |
| `platformClaimFeeWallet` | Wallet that claims platform fees |
| `platformLockNftWallet` | Receives the fee NFT for the locked LP at migration |
| `platformVestingWallet` | Receives the platform's vesting share (`platformVestingScale`, out of 1e6, default 0) |
| `cpConfigId` | CPMM fee tier for the post-graduation pool. Devnet index 0 is `5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy` (0.25%) |
| `feeRate` | Platform trade fee, out of 1e6, at most 50000 (5%). Raised from 10000 on 2026-08-26 |
| `creatorFeeRate` | Out of 1e6, at most 5000 (0.5%) |
| `migrateCpLockNftScale {platformScale, creatorScale, burnScale}` | Must sum to 1e6, and **`creatorScale` must now be 0**. The demo's 400k/500k/100k split reverts. A valid example is `(100000, 0, 900000)`. At migration the platform+creator share of LP becomes one fee NFT owned by the platform's NFT wallet; the rest is burned. |
| `name` / `web` / `img` | Up to 64 / 256 / 256 bytes |
| `transferFeeExtensionAuth` | Authority for Token-2022 transfer fees |

**Claiming platform fees (quote token)**
- `claimPlatformFee({ platformId, poolId, platformClaimFeeWallet })` claims per pool.
- `claimVaultPlatformFee({ platformId, mintB })` claims from the platform's fee vault.
- Either way, the platform's fee wallet signs.

`updatePlatformConfig` lets the admin change one field per call.

## Exact devnet calls (SDK 0.2.74-alpha; a sketch, not run)

```ts
// npm i @raydium-io/raydium-sdk-v2@0.2.74-alpha @solana/web3.js @solana/spl-token bn.js   (in a scratch directory, not this repo)
import { Raydium, TxVersion, DEV_API_URLS, DEVNET_PROGRAM_ID, getPdaLaunchpadConfigId, LaunchpadConfig } from '@raydium-io/raydium-sdk-v2'
import { NATIVE_MINT } from '@solana/spl-token'; import BN from 'bn.js'
const PID = DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM                     // never rely on the default (mainnet)
const load = (owner) => Raydium.load({ owner, connection, cluster: 'devnet', disableFeatureCheck: true,
  urlConfigs: { ...DEV_API_URLS, BASE_HOST: 'https://api-v3-devnet.raydium.io', OWNER_BASE_HOST: 'https://owner-v1-devnet.raydium.io', SWAP_HOST: 'https://transaction-v1-devnet.raydium.io' } })

// (a) register a platform (admin key)
const r = await load(admin)
const { execute: ex1, extInfo: { platformId } } = await r.launchpad.createPlatformConfig({ programId: PID,
  platformAdmin: admin.publicKey, platformClaimFeeWallet: admin.publicKey, platformLockNftWallet: admin.publicKey, platformVestingWallet: admin.publicKey,
  cpConfigId: new PublicKey('5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy'), transferFeeExtensionAuth: admin.publicKey,
  creatorFeeRate: new BN(5000), feeRate: new BN(1000),
  migrateCpLockNftScale: { platformScale: new BN(0), creatorScale: new BN(0), burnScale: new BN(1_000_000) },
  name: 'x', web: 'https://x', img: 'https://x/i.png', txVersion: TxVersion.V0 })
await ex1({ sendAndConfirm: true })

// (b) the token, 25% locked, 365-day linear unlock, no cliff (CREATOR key = the keeper's key, so it can claim creator fees)
const configId = getPdaLaunchpadConfigId(PID, NATIVE_MINT, 0, 0).publicKey      // 7ZR4zD7… on devnet
const configInfo = LaunchpadConfig.decode((await connection.getAccountInfo(configId))!.data)
const mint = Keypair.generate()
const { execute: ex2, extInfo } = await r.launchpad.createLaunchpad({ programId: PID, platformId, configId, configInfo,
  mintA: mint.publicKey, extraSigners: [mint], name: 'DEFICIT', symbol: 'DEFICIT', uri: 'https://…/metadata.json', decimals: 6, migrateType: 'cpmm',
  supply: new BN('1000000000000000'), totalSellA: new BN('600000000000000'), totalFundRaisingB: new BN(1_000_000_000),
  totalLockedAmount: new BN('250000000000000'), cliffPeriod: new BN(0), unlockPeriod: new BN(365 * 86400),
  buyAmount: new BN(0), createOnly: true, txVersion: TxVersion.V0 })
await ex2({ sequentially: true }); const poolId = extInfo.address.poolId

// (c) vault mode only: assign the whole locked amount to the keeper BEFORE graduation; the keeper claims after graduation
await (await r.launchpad.createVesting({ programId: PID, poolId, beneficiary: KEEPER, shareAmount: new BN('250000000000000'), txVersion: TxVersion.V0 })).execute({ sendAndConfirm: true })
await (await (await load(keeperKey)).launchpad.claimVesting({ programId: PID, poolId, txVersion: TxVersion.V0 })).execute({ sendAndConfirm: true })
```

## Why the devnet demo is not extended through LaunchLab

The SDK does support devnet. The demo still uses a plain SPL mint, for three reasons:

1. **The SDK is not a dependency of this repository.** Adding a third-party package to the codebase that signs for the trading arms is the owner's call, not a side effect of this task.
2. **The vested vault cannot be shown on devnet.** Vesting and claims only start at graduation. Graduation needs Raydium's migration wallet to sign, and no devnet graduation crank could be confirmed. A devnet launch would most likely sit in the bonding curve for ever, with nothing to claim.
3. **A fresh devnet mint has no pool**, so buyback mode's swap cannot be run for real on devnet either.

So `scripts/burnkeeper-devnet-demo.mts` uses a plain SPL mint:
- **Buyback mode:** a clearly labelled stub swap (a real devnet transaction at a fixed price), followed by the keeper's real BurnChecked and v2 memo.
- **Vault mode:** a pre-filled vault.

Running the sketch above on devnet requires the owner to install the SDK in a scratch directory.

## Not confirmed

- Whether a graduation crank runs on devnet.
- Whether the program itself rejects `CreateVestingAccount` after graduation. The docs imply it does.
- The exact accounting of `platform_vesting_scale` against the creator's locked total.
- The two docs pages disagree on two points, though both mean "after fundraising completes":
  - which status a claim requires: `Trade (2)` vs `Migrated`;
  - when `start_time` is set: "fundraising ends" vs migration.
- The `pool_vault` seed for the base vault, taken from the SDK's CLMM module.
- Both hand-written instructions (claim vested, claim creator fee) are encoded from the SDK source and covered by unit tests, but have not been sent to any cluster. _(Later 10-09: both are byte-identical to the SDK's builders — `test/burnKeeperLaunch.test.ts` — and `claim_creator_fee` was simulated successfully on mainnet against two real creators' vaults; still never sent.)_

## URLs read

- SDK: raw.githubusercontent.com/raydium-io/raydium-sdk-V2/master/src/
  - common/programId.ts
  - raydium/launchpad/launchpad.ts
  - raydium/launchpad/instrument.ts
  - raydium/launchpad/layout.ts
  - raydium/launchpad/type.ts
  - raydium/launchpad/pda.ts
  - raydium/launchpad/curve/curve.ts
  - common/fee.ts
  - api/api.ts
- Demo: raw.githubusercontent.com/raydium-io/raydium-sdk-V2-demo/master/src/
  - launchpad/createMint.ts
  - launchpad/createPlatform.ts
  - launchpad/createVestingAccount.ts
  - launchpad/claimVesting.ts
  - launchpad/claimPlatformFee.ts
  - config.ts.template
- Docs: docs.raydium.io/products/launchlab/
  - vesting
  - instructions
  - platform-config
  - global-config
  - creator-fees
  - platforms
- Docs, other pages:
  - docs.raydium.io/reference/program-addresses
  - docs.raydium.io/user-flows/creating-a-launchlab-token
- Config endpoints:
  - launch-mint-v1.raydium.io/main/configs
  - launch-mint-v1-devnet.raydium.io/main/configs
  - api-v3-devnet.raydium.io/main/cpmm-config
