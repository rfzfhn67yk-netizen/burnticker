# Devnet run log: LP-lock blind review r2 fixes, 2026-10-10 23:37–23:50 Denver

Run by Claude (agent) on the Mac, worktree `mct-wt-LPLOCK`, branch `burnticker/lp-lock-r2`, program sources at `40e13bf5`. Devnet only
(every CLI checks the RPC's genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`). Keys: the throwaway devnet keys in
`~/.config/meme-coin-trader/devnet/`. Evidence: `docs/burnkeeper/evidence/devnet-lock-r2/`. Explorer:
`https://explorer.solana.com/tx/<sig>?cluster=devnet`. Review: `docs/burnticker/reviews/2026-10-11-lp-lock-blind.md`.

What r2 changes, in one line each (details in the commit and `docs/burn-receipts/powers-register.md`):

- RL-2: `register_fee_key` identifies the lock position by its **locker** (LockedCpLiquidityState @128), not by a majority of the live
  LP supply. Policy 0: LaunchLab's `["vault_auth_seed"]` PDA. Pairs: the pair vault. The sanity floor is a strict majority of the LP in
  Raydium's lock account for the LP mint, so a deposit cannot dilute it.
- RL-3: `BURNTICKER_PLATFORM` is compiled into burn_receipts per cluster. The mainnet placeholder refuses. Policy 0 now runs
  `register_fee_key` **before** `register_pool`, and `register_pool` requires the FeeKeyRecord for that pool.
- L-1: `claim_lock_fees` runs against `FeeKeyRecord.pool`. L-3: it takes no amount argument.
- L-2: new pair_curve `burn_lp(side)`, a 30-day fallback.
- I-5: receipt memo v2.
- I-6: the Fee Key mint must have no mint or freeze authority.

## U: both programs upgraded through the Squads vault (verified hash required)

The executable hashes are in `config/burnticker/verified-build.json` (`verified-build.sh --local --write`, then re-run: MATCH). The
dry run of `scripts/squads-program-upgrade.mts` matched the buffer, the table and the local build. Each proposal's `checks` block is in
the evidence.

| step | burn_receipts `AuQjoSgq…zhMM` | pair_curve `2jQotwSG…ELkN` |
|---|---|---|
| program-data extension | none needed (643,328 B fits in 721,096 B) | `solana program extend … 20480`: `5Wb6PFbt6QFmTTwtPMbFyswt8bPf2JqYbRMNBW3VhwDqim9nF7mRLeDBzghdeBdg5qkHY5Wb3hfDxkMvGUu4uJaY` |
| buffer / set-buffer-authority → vault | `5QPnmmTSRtQh6PR3NjEgWYs6jQ1qZCFc4PtZS4xRzg4h` / `3Ete8yWYqaZovgBWyrHKQgqFeM3bghSaFyAT7iYnDYHN9oZ8q35c4Hk1JDscoAnTvo4zB4ogiyttbXgmuymMr6q9` | `F1uoo9Qijr1wyRVkbWTFCEJ2zwRSRYFZVRRSDnvdTrMT` / `5bVntasCnfhv59bRqW2mDc4sEjKd1cR5hXQReUECDxE1rtaQyQ4XnqjAx6mReiTCHo34FKUV8tKQatoXnUqYVqtq` |
| proposal (vault tx) | tx 9 `DoYECLM6HrQdq3Qc7ri15reRu2VDWpbsn6k1N6zzZXP2AD2QMH5Vy2pSFwGr4CR14H3zNDC9PouiYpfpdAxB4R8` | tx 10 `66ukASepXGz3DbJsbABoLJdqyKW8Nit9s8GWKbbW4HwT35wPJpvEbNks3ZZ1CeiG1JwQhwt3NcHZ2N4ZTbR5rMyg` |
| approvals (squads-a, squads-b) | `3rwHt6Hz4zqZuz8GD6ahMfJerzg62Vo4tYoLwjEqXfcSVHKCvQv4hsnoppaDeEK8YDGFFXCTqVhdQRfi6QiuJeEM`, `5Ho2555VWLQxTrsCe6UMWCcA6ExEbtkTvaoTQJT8iaTe5vRmqAhqCk48UQdom6yH46naP4iZ7wUtc2McL6Hq2xQh` | `494ufSH76AUCSfKk5rxiCiKHyKJrj3G6LXaLtY29j4xWyeouTn2CbioeqopCj1nMEiZd6o28Wo6cLmwhRHpUiqNA`, `4t28gMaxwRP2VU4qBtLRdG3zunkXukk4SaYcAej6PbessMHsPqbsxxEQkgsUBeFeL4YmkMxZgPCSMUXZ5t7XrxUg` |
| execute (after the 60 s time lock) | `66Fz72fLND63cP1fv64z3sXUd2MMyhNgKymNBuqHWXW7NPH3A8crEYd6Uo3jLGv9Y8pWfmKzZNV5FQy7ZQwKXsCw` | `5wytchxo3KMFuXrAnzJcwsY67HjeoHL5Vxx2oBkoe63VyVdkyW1B4R261Bducbfq96Vk1BjweL9nSYZrsgTdDefM` |
| deployed executable hash (`verified-build.sh --onchain devnet` → MATCH) | **`b5b7ea596e66b4dd890af6a3f67d526b3ca825979ebb8f88f497fe235e2a00a3`** | **`7d1b06a568ac7ef70c89e6ba8b7e6f5fabf22793652aeceeb2b3c64b945c7796`** |

The buffer rent came back to squads-a (the spill), and 5.32 SOL was returned to the payer:
`4bF5zaGD81iQgdrexSSNJ4Sze1v4ZVtTMMbKzJs4xjaiajXarVvLdsxgcA2wymGoeoZri6vnhdQdWCoVHmyWAGat`.

## C: the claim path re-run on the upgraded programs (no amount argument, v2 memo)

The swaps were small CPMM round trips from the payer, so that the locked LP earns fees: 3 × (0.05 SOL buy, 5 % sell) on $LOCKT
(`launchlab-trades.log`), and 2 × (0.02 SOL buy, 5 % sell) on each pair-6 pool (`pair6-trades.log`). The treasury
(`A8VVQ8zt…MffD`) was funded, so every operator share was delivered at once.

| claim | signature | CU | memo (on chain) |
|---|---|---|---|
| $LOCKT (policy 0, mint `CxX5PH8Awsxvs2nrzXfmq2T91Cr6t1EMvEDhMs18hkou`) | **`5ZewLwqPV8ZV89aQNgpfkEiU17dgAb9fCyrRg1NAW9DZ13HnjZJaxehkAwnQEN1cZYLDnbq7LKNYHE8Axwqimc8G`** | 254,382 | `LOCKT\|lockfees\|wsol=357197\|burnpool=285758\|operator=71439\|paid=71439\|pending=0\|burned=189027580233\|nft=D6ZTNvkuaM8R\|v2` |
| pair 6 side A ($PCLA, pair `CUVutu3wjP74ic1RxVhgHYevAmrCLgq6aAd3d9gNLWYi`) | **`9tYBcsP8EEQKjxpuBwLX39MuDimh9gFBYxo2zuhZnjnLuKyBeLntDRaKy23BjGx777PQfKskaoZ5msqH8FHPCjF`** | 259,170 | `PCLA\|lockfees\|wsol=68890\|burnpool=55112\|operator=13778\|paid=13778\|pending=0\|burned=108993961993\|nft=8shUfopKAjiD\|v2` |
| pair 6 side B ($PCLB) | **`b6PSV2da6ifQNaCD8UUXJNo5NZLLj9S9hKndDiP72Y9j4TPTREefFFxMupfXUAzJmb4LmAwQrknithXmmM5nHEB`** | 243,117 | `PCLB\|lockfees\|wsol=61010\|burnpool=48808\|operator=12202\|paid=12202\|pending=0\|burned=102321154833\|nft=9cbPvLzqXtAc\|v2` |

All three FeeKeyRecords were written by the 2026-10-10 build. Claims run against the record's pool (L-1), and the instruction data is
the 8-byte discriminator alone (L-3).

## R: the r2 identification read back from the real devnet lock program (read-only)

`lock-positions-r2.json`: for all three positions, LockedCpLiquidityState @128 is the locker r2 expects:

- $LOCKT: LaunchLab's `vault_auth_seed` PDA `5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq`.
- $PCLA / $PCLB: the pair-6 vault `CoFsdYYkWkVdikQRLTEbuR8o4CQ2uTeohvPiLaUqdEVd`.

Each position holds all of the LP in Raydium's lock account for its LP mint, so the r2 `register_fee_key` would accept each one. After
a collect, the real program reduces `locked_lp` by the fee LP it withdrew and leaves unclaimed = 0. The LiteSVM stand-in now does the
same (I-1).

## Not exercised on devnet (LiteSVM only)

The fail-closed paths are covered in `programs/burn-receipts/programs/*/tests/{lock_fees,review_lock}.rs`. They run against the
stand-in and against the real mainnet lock binary (`REVIEW_LOCK_SO`). The paths are:

- `register_pool` without a FeeKeyRecord.
- A position locked by someone else (`LockerMismatch`).
- A Fee Key mint with an authority.
- A deposit before `register_fee_key`.
- `burn_lp` before and after 30 days.

A fresh devnet LaunchLab coin graduated under the new order (register_fee_key → register_pool) is the next rehearsal item. It costs
about 1 SOL of curve buys.
