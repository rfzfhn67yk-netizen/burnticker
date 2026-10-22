# Devnet run log — LP locked forever, fees fund the burn (LAUNCHPAD-PATH §35), 2026-10-10 21:38–22:08 Denver

Run by Claude (agent) on the Mac, worktree `mct-wt-LPLOCK`, branch `burnticker/lp-lock`. Devnet only (every CLI checks the RPC's
genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`); keys = the throwaway devnet keys in `~/.config/meme-coin-trader/devnet/`
(new mints `pc6-mint-{a,b}.json`, `lk-mint.json`). Evidence: `docs/burnkeeper/evidence/devnet-lock-2026-10-10/` (every CLI output as
JSON, trade logs, the lock positions read back). Explorer: `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

**Real Raydium programs throughout:** devnet CPMM `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb`, devnet LaunchLab
`DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6`, devnet CPMM **lock program `DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX`** (authority
`7qWVV8UY2bRJfDLP4s37YzBPKUkVB46DStYJBpYbQzu3` = its PDA `["lock_cp_authority_seed"]`). The LiteSVM suites use a TEST-ONLY stand-in for the
lock program (`programs/burn-receipts/mocks/cpmm_lock_mock`, its source is not public); this run is where the real one is exercised.
burn_receipts' FEE_KEYS PDA `["fee_keys"]` = **`Bj4XCAoGHy9JTcDtQovijFwpG7NsSG6Snqmf8kFi2Yt3`**; operator treasury (devnet build) = the
Squads vault `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD`.

## U — both programs upgraded through the Squads vault (verified hash required)

`scripts/squads-program-upgrade.mts` refuses unless the buffer's executable hash equals `config/burnticker/verified-build.json`, the
buffer and program authorities are the vault and the spill is a member; each proposal's `checks` block is in the evidence.

| step | burn_receipts `AuQjoSgq…zhMM` | pair_curve `2jQotwSG…ELkN` |
|---|---|---|
| program-data extension | — (636,056 B fits the 721,096 B program data) | `solana program extend … 20480`: `2aLkxipNiqaf7dcYKng4MKJzmHHmQ1uF16ZKYWGw2H74hsGwiUbwQygsk2tHndTDHgpoUuzcunVqQjqLW4W9LH58` |
| round 1 (source `d54664ed`): proposal / execute | tx 6 `mXW8bwNi51PHAEWcUBEsWC5Vsp5gMDvNvbE2bZCsMJAvc5hp3Rr6yzwRi3K8UEsfpMvcMTAREjENi8HfwVk17xD` / `4Z4CGueSHuA1WFtVutQ8pTr551yoQ4oUqXKJPRF26M5yPvAThtexq91R7A81rM1XcWidbCLN9knb8Vs9c4Q84zGJ` (21:42) | tx 5 `5qvXcbNa8WZ2bCLQmWf7WgY2FhD4NzbKcQwd2gJdbPsf6MXc375rPKeLxxxqA9Q5WRVcrUxkakUyqyhDmnXn43a3` / `nWuFcT3fuhLEUKf6JnbV3TXF5yY6Nfa8GkWqi5fhZMLMEdStoidxGx593Xyu9mxkCSArj8TEhP8JVhmLtaMvgYX` (21:42:34) |
| round 2 (source `3d82b6b5`, the treasury-parking fix below): proposal / execute | tx 8 `5Ncx9dU8YtEUDu1M3GmaFxqmJ8j7998uod2FUKETaSkvcx5FrVkF8tzjA1JLKbCBPAzhQ5jkg2SFdYr5advJ5UT9` / `4w8tJBpy1XwuFh3s6UgUY9onh5rpr5EamYxWLKwctApbmjEb7QUvPNvbNmhbRRhDa14vnPJE9djjxuDtNxFeckKR` | tx 7 `4tcsYaCdUjk83C3LKSg9mZf8DVihqQmeP5vtF3Li6YwJ11WYQoQnuKWtXxJLYDGHWBSkzyESuEip99vroinvucKt` / `5z1wzPPjqXF1cz4Zd5Py2GpsGLZsNDf9d9s61WE8vCg3pRCjcWNAGDax9xZPwpUJRaZpb6a7xgLt8QarF9kf9ziw` (21:56:11) |
| deployed executable hash (`verified-build.sh --onchain devnet` → MATCH) | **`f18ba9cce758fc3dbd69b7f632e26feedad0c90dfbf444f681e094eefe24d151`** | **`e406b969432d3dec0d1a90d15b5bd8132b7be64c24b9a98c55317e38c199adc5`** |

Approvals (squads-a, squads-b): tx 5 `5CqpCPhQ2LzRdcbJnDaPp577YSLeDrL6a89YogjYDg1b1A4EYN7w5rgM2GtUajnqvcwXg3NCYMoKYpLPcRoKWNYk`,
`4mT9JMiagYd6ccCNgXFsqQrX5CvibLuZbMXq22isi28KS7Y5ZJx49hGGDJ2wCNAoiEBxdQZ9G5mAfGXEBeVGjCdQ`; tx 6
`2LVUYx5aeGwf2WV4JBXJ2Zd1wWKZqdVrT9myJ9YrAxUheZ4L3UbXRXCWvZsYchpvJvkXum8TW6yPVhKmSTDY62H5`,
`2TkSjBZMgtTPgtXx6mhhgXC344tjVMFAQb8yigiV9c7s8RtymqJ7nmFCkpSP2ugQNNKA8ofVkRWsLLojRZEYHjjD`; tx 7
`5HqCRNZr5wa3zGnKdpof5RbUZHhdt6cYDBrah4WPXjzXUVS5r2cQfFNDLjSG8NxbipFqpQZwxtXCQo1YwSMLeN6u`,
`4CuDJDVzQFPBAg3tSwKvthPp5SjS9mbBoR1CuRUaKXCvaBDrZbc35LLtDw6JKWNGsP3ftnztpESuBTRrs5fM9CdE`; tx 8
`43dtVW8rDExoyoMDAqTg1CKdXuit82pA8esSJTNGuGyf4LAHjCBVNG4Z9qv44JrvitDBF1unGQgdTsThzfJjiqtN`,
`p6GL8f5HDCzVUagGnrNy6waNGHUT4BVvv6d8tKYk5QNWqkP8msdUxMZASGPTXYtcCeLLX65G5MgyisXqe9ucnbA`. Every buffer's rent came back to squads-a
and was returned to the payer.

## P — pair 6 ($PCLA vs $PCLB): graduate → lock_lp → register → register_fee_key → claim

Pair **`CUVutu3wjP74ic1RxVhgHYevAmrCLgq6aAd3d9gNLWYi`** (virtual 0.3 SOL, target 0.5 SOL, share 4,000 bps; `pair6-init.json`).

| step | signature | result |
|---|---|---|
| buy A 0.30 / buy B 0.25 (the second commits the pair) | `42PrZxrP69gVDkiD7DUSNnKMXRZfuAPhm22gTBTDyEjbQpRj3LmfTPYEkQoJqRAuBxQShb1zrhkCkH4hJ18Dhwoi`, `ScrSrvGJeevpMJ2H8e13oNq3NmmG9NxwZyKJAjRKNHyNdpzQzNPBVYqwiQESvTdy59g2bC4S1FYvhceSJ3o4wK4` | Graduating |
| graduate(A) | `5fcYFmqzzvXhfPcBVyj5Lb7Asd2HWFGhBrGPK1c2iVhhBw2eTixevfyVgrynDn2JkKqW2Jrv4i1e2sQmEeMmSaLh` | 159,478 CU; LP left in the vault |
| **lock_lp(A)** — real lock program, Fee Key mint = the pair_curve PDA `8shUfopKAjiDd51U2mQdzDqNWiVibLSPKbSC86frAQVb` | **`32PLafxNvm6zu9Gbq6yvNVm9uggLBod5XMM1Kvdt45ygdc93N2qM4QW7yzFrFr1f46VX3cPZVF5fP1KSbBGPGUh`** | 158,245 CU, 946 B; lp_locked 109,068,508,785 |
| graduate(B) / **lock_lp(B)** | `2WuFMWGBGKePuFwEVqxT1SjczfkGoyonnMJGwFVPWiEaCftftBPrbiShK3wQftPcb4q2cUBthWWAUSFJds7APmew` / **`G3ywKCtH25fx422em5ABjejRnc9Uh8fYAkwfG6W5TAaFJfJse7EMoe4KBrbPk7dJztNoG9hrNxnbQuce2TY1weT`** | Graduated; lp_locked 67,631,455,964 |
| register_pair_pool A / B (counts the locked LP) | `3tX9ycFo6of6XxfN8nnFnCVwKu3GuCxHejVpJhKxxY6Geoe9mjNhnuN6JUYXtvaPMZ2kVh14FyKxYrdo8J1FLfvV`, `2oXVT8npNB3rTcqYh1wCNDVeT5NkCMrrb4NxuKJGAbgxgWKvXWDrTzSTNpegVKvM67qnZe2rvUZgyJtgJPEyrz8X` | |
| register_fee_key A / B | `3qmJqVHT9Vz2CMYkyxs3uY5dzNV4cPPUfeSdAeCcU6FcHYcYLcDjGTAiVevupdgfwn7F5dsT84ragjSYbdgrjoaH`, `4njf8e17hxVDZP74j5pZVPuAR3nBnAWyZziStGPL94rFLUckNDf3AML9vbSf3KB2PweZcmgB6tBRP7QBsKyDrHgH` | |
| 12 CPMM swaps (0.02 SOL buys / 5 % sells on both pools) | `pair6-trades.log` | LP fees accrue |
| **claim_lock_fees A** (treasury unfunded) | **`yWVKxn2MHfHRdLri3NetYmihAs5FDLjDgX7odGAMR6j6qZvD4C1Z4UVhP65MUdR1rduXpwWb5PHeaNxKCCywBEd`** | 251,785 CU; WSOL claimed 110,798 → burn pool **+88,639** (80 %), operator 22,159 **parked** in the FeeKeyRecord; **155,542.492023 $PCLA burned** |
| **claim_lock_fees B** (treasury unfunded) | **`426Mdxee5vXY33RVJUEh31bRDTxbhNrqqJkW9cYVwW7wxC9LNbhnNVb1kxY6BBJHTBrJECFrWXPoBGWv4piPAEjG`** | 235,076 CU; burn pool **+74,502**, operator 18,625 parked; **149,720.281628 $PCLB burned** |
| treasury funded with 0.002 SOL (devnet) | `SJidErwNGgYV6ttTGBcXSPApewnMF4XMNteXdzMVmNWeWxDM5DG8AopsbXt6xpXyE4uEr3xVhKVu4JAXa4NoYh3` | |
| claim A again after 4 more swaps | `3PQu6nAuJ6wEJnV8QVqLDGiNTDDjx26xL9vXwytvwV6KQAK8uq6TmYrXdhNLVnrX9SHhZwCEsXmA8SWe3FjN6PYH` | treasury **+36,178** = the parked 22,159 + this claim's 20 % |
| claim B again (nothing new accrued) | `3QFfi1DXzb5eos8TufVWfRD4ZNsoNeRYY37qyoCyRMNFZ4fu7LQ6vAx7iYbjPxJLbzN5ED8jLYhG6ugAzLkKzkNE` | treasury **+18,625** (the parked share delivered) |

## L — a LaunchLab coin ($LOCKT) under the new platform pins: graduation → register_fee_key → claim

| step | signature | result |
|---|---|---|
| devnet platform `GvSKpe5p…v3tf`: migrateCpLockNftScale (1,000,000 / 0 / 0) + updateLockNftWallet (FEE_KEYS), by the platform admin (`scripts/launchlab-platform-lp-lock.mts`) | `2TFCZGnnKpjdJcFQos51uDEwZWkq6Q1gHYDdLMCtDwuNUSjSngyfaxGiCqZtCSGnJSepyzjLVj6ETuKyGYEt9aaU` | **LaunchLab accepts burnScale 0** (no minimum burn); scales were 0/0/1,000,000 before |
| initialize_token (policy 0; the new pin: NFT wallet = FEE_KEYS, scales 1,000,000/0/0) | `hrT3wxiY8mjrJNXkqJfM3bZTbAJv411Lp1xevUsn5ytwAHeUP1ZXaRKVhd47wobHNJhWszC9rXWfUgrocBjr8D7` | mint `CxX5PH8Awsxvs2nrzXfmq2T91Cr6t1EMvEDhMs18hkou` |
| verify-platform-pins (launch gate, incl. the NFT wallet) | — | `ok: true`, `lockNftWallet` = FEE_KEYS |
| LaunchLab create (raise 1 SOL; first buy 0.1) | `3Vp2coxduHwwjhxY4X1GUPxTHXnA1aHEZUPhndmweJm77NLwpJimMNKNA3edN74CQe2oMRzT7CDYznC5V19VrLTF` | LaunchLab pool `5etpCRsffWAaVaPxoqzZHN4XUZDLYFar8EnGFbECDiqT` |
| curve buys 0.5 + 0.5 → **graduated**; Raydium's devnet migrator moved it to CPMM within seconds | `41AKhNCN6U2pqRbnABQWdsWrEFDHcZm3t9F8Ztq7eeU2aCPUzN7KQfTpoDqRPy4Btz8N296bHo7XxGrYwhe6ysfo`, `EQzUCqV6uXPH4CPRjp3L3QiYiHS5qGawZ9RwxaTeomXWhZiNftqU2a3DuhvC68B4ER6B7urWMtFXhbpM9M39Zxy`; migration `3xJ3hcg1oDFaMLV39bH6XRHKeU7f7gtS8c76A98nrLnnoXDPME3x8MvscbXQZazbUY6SaZAwWWYSw9NU6DWUDQon` | CPMM pool **`AKRxMfAjMjP4ZFPKtUw6R13Gi8KczYWiKua6t5acEsoQ`**; **one lock position with 454,862,616,521 LP = lp_supply − 100 (100 %)**, Fee Key `D6ZTNvkuaM8RH8QRBf3dvnWBPoneXshAprLDiJ8Y1TbX` **held by FEE_KEYS** |
| register_pool (locked LP counted) | `9fPGZAcxuNSs82GS6HSsMaDu1s76PtndQntLmZNiqsftvjaYfzFyKebf2Q6kHG2Juybxi4UhWtA6Bd98MruiZ8j` | |
| register_fee_key (scan found the one position, held by FEE_KEYS) | `rWL8aX6VeoPW68G3abjZgWJeJPcws22ozWqRsV66pjp4VsKoZpuWST5KehE2dWaDMnHPNx8sk8BLM1PmJWUDGTJ` | |
| 6 CPMM swaps | `launchlab-trades.log` | |
| **claim_lock_fees** | **`2jRnqfeaybe4HKbXNySyL8vrNs5QL2qGY9mYP7WA1hFipYP4Yjqf93EE8GTiJw5G3VdHFSbKcLx5QCeDP72TaGJm`** | 246,416 CU; WSOL 465,326 → fee PDA **+372,261** (80 %), treasury **+93,065** (20 %); **182,630.070502 $LOCKT burned** (supply 1,000,000,000 → 999,817,369.929498); memo `LOCKT|lockfees|wsol=465326|burnpool=372261|operator=93065|burned=182630070502|nft=D6ZTNvkuaM8R|v1` |

`lock-positions.json` holds, for each of the three coins, the FeeKeyRecord, the lock program's **LockedCpLiquidityState** account (owner
`DRay25Us…`, 256 B, raw bytes + decoded, PDA re-derived), the Fee Key account (owner FEE_KEYS, amount 1) and the pool's LP: 99.9999 %
of each pool's LP sits in the lock (the rest is CPMM's 100 never-minted units).

## Findings

1. **An unfunded treasury blocked claims (fixed in `3d82b6b5`, deployed as round 2).** The first claim_lock_fees on pair 6 failed in
   simulation with `InsufficientFundsForRent` (nothing landed): the devnet Squads vault held 0 lamports, and crediting it 22,159
   lamports would have left it below its rent-exempt minimum — failing the whole claim, the burn pool's 80 % included. The operator
   share now waits in the FeeKeyRecord account (`operator_pending`) and is delivered with the first claim after which the treasury is
   rent-exempt (observed above: +36,178 and +18,625). Regression test `lock_fees::an_unfunded_treasury_parks_…`.
2. LaunchLab's devnet program accepts `burnScale 0` with `platformScale 1,000,000`; the migration locked the entire LP in ONE
   position whose Fee Key went to the platform's NFT wallet (FEE_KEYS) — exactly what register_fee_key expects.
3. pair_curve's lock_lp works against the real lock program with the Fee Key mint as a pair_curve PDA signer (no keypair) and
   `with_metadata = false`; 140–158 k CU per side.
4. The real lock program accepts `lp_fee_amount = u64::MAX` ("everything accrued") both with and without accrued fees.

## SOL (devnet)

Payer 11.35 → 9.68 SOL; deployer/squads/keeper small. Spent ≈ 1.7 SOL: two program-data extensions (pair_curve 0.104), the pair's
curves (0.55, mostly now in the two pools) and Raydium's create-pool fees (0.30), the LaunchLab coin's curve (≈ 1.05) and rents; the
four upgrade buffers' rent (≈ 10.5 SOL in total over two rounds) came back each time. ≥ 2 SOL stays on the payer for the TS agent's
rehearsal.
