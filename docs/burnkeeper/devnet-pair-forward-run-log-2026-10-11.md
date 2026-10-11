# Devnet run log — LAUNCHPAD-PATH §40, winner takes the burn, 2026-10-11 10:00–10:45 Denver

Run by Claude (agent) on the Mac, worktree `mct-wt-LPLOCK`, branch `burnticker/pair-forward`, program sources at `c1834074`. Devnet
only: every CLI checks the RPC's genesis hash, `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Keys are the throwaway devnet keys in
`~/.config/meme-coin-trader/devnet/`. The keeper key `D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn` is the one attester (quorum 1) of
BOTH pair-6 coins, so one signature satisfies both quorums. Evidence: `docs/burnkeeper/evidence/devnet-pair-forward-2026-10-11/`. Every
CLI output is saved as JSON, plus the decoded on-chain events. Explorer: `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

The coins are pair 6, `CUVutu3wjP74ic1RxVhgHYevAmrCLgq6aAd3d9gNLWYi`, already graduated, LP locked, both pools registered:

| side | coin | mint | fee PDA |
|---|---|---|---|
| A | $PCLA | `7dNGQuvijwxFBw6PXUHnw2mfmTuRd2KmV6nBGrFxXb2T` | `HXEXbwJFENsRFv65XQqBKGuXbYK3jTAb9Am7YxW8S8cm` |
| B | $PCLB | `6jxEWF78rtBsMCA44FYaCG4nFUjk4S15e4wAKKjgMzmN` | `EzWnvfMsDr8My3QgwAK6xQAqLv9HPmYjreCejaXtfFbB` |

Rule of both coins: f = 100 bps per unit, floor 0.001 SOL, reserve 0.02 SOL, unit = $1B on the Treasury feed.

## U — both programs upgraded through the Squads vault (verified hash required)

`config/burnticker/verified-build.json` holds the hashes written by `verified-build.sh --local --write`; a re-run of the same command
reported MATCH. Each proposal was dry-run first: buffer, table and local build all agreed. All four builds are sBPFv3 (ELF e_flags
0x3). SIMD-0500 is inactive on both clusters; see VERIFIED-BUILD.md.

| step | burn_receipts `AuQjoSgq…zhMM` | pair_curve `2jQotwSG…ELkN` |
|---|---|---|
| program-data extension | `solana program extend … 20480` → 741,576 B: `5xRRQe8bgf9PifqKcKbbEWgZpJgzc71dTFfTLigATghjNZNbGh7SHKxgUJWacm7BeXFAktw6CbwGaREn2ZCy12cH` | not needed (409,280 B fit) |
| buffer / set-buffer-authority → vault | `2xrbhr9zSyEuz9sK7nWgSR3MMEF1TJk914e33d5VHRma` / `43rXDNJaPAvd5hBCUUf2uZMDVrEk6Z4KjEkGp3oLjrLFYxthTBbXcSnXLfwt4vYdFVWtBiWgvppmfR4pcprQWcKq` | `2DkpCB8Baw3czex5d6nEqivNXWHTzw4a1nEMB3qioDWk` / `Pij5cz1L4f2LVTF2nqF1J61yywUEQF4xJ65UJoC4g4nbMxK4hDMFXFHnwsvBhxzeLUPs4aAsayTnidh65KyW5MZ` |
| proposal (vault tx) | tx 11 `54JnBeZSWfeNAqZG8YZ8wQoLi8PrLGzZkvZ21BWKVoPsSH7hLzhKyyrm8TwPet7oiTJgHwE71n1AgPi5yZ8m828K` | tx 12 `qVLW1WDywn9Ege6bATszmGJN5NAxAMpBHAUggiH431cyVgLau4yDupCanLWUDwDBqnHG9NJLFYu7CpB7Ezajuhk` |
| approvals (squads-a, squads-b) | `4AoMXfU6U3nbthVvQgPk2ZXUZzofnLAv9M221QAt8SwjN4G4x7mP8nNUEzdeiR9ogADyG2B24Bwfk1gpo1m1gtZ7`, `9PUaEpTcQpwPbn76yr7qrjJ3Mferqfu4GD46Xe6R1PQ97HtFVMrMuBzTkSycAmJFTC65JEK3vdeCZLcVwSRx5B3` | `4orcrEWWdRXG9xvhf3wLScYU76proMgBrvihy8iFUkyG25p6DXhAv8BnSwUCeKajXCuRhpkjVoiTXr6gVpsJ9meY`, `4khLMsRQ42ZwXd5NvBaet2yefFakxqMp3iS6xKHnnHLairuLZ72wd4Q24XqkXygZ4QxZ3scMFASyBa6hpPaxrEoE` |
| execute (after the 60 s time lock) | `4sHWghBT2TjHvwcSCezwVvhuRzAdvMkRk3iW8yfpnXf9CarZS3fmNnaP1MWRXxWivB7RjswYsfFVAw5skSVWYZRj` (10:04:56) | `CsNtpH7GNLFD6SoCvt4vsVhseALvEt8ib8q6K9KXSxvKDaAUoeiRkar5JntMuRMBkaryGrqAhY8dG3YXu7B5xdY` (10:05:29) |
| deployed executable hash (`verified-build.sh --onchain devnet` → MATCH) | **`b23df8fa78c25c6f7375f9a5bb5cd7341f0bfe063e1b9b6af8ffebf0a54f97a5`** | **`f8c515cd1509260fd65fca6c261fbee4fa3847babd85f928e686c09268bc83c7`** |

pair_curve's source did not change, but it links the burn_receipts crate, so its bytes changed and it was upgraded with the same
table. The buffer rent came back to squads-a (the spill), and 5.78 SOL was returned to the payer:
`3LZ7quzrWF1hd4FxpJaiRW9J418wwS5mf1qt5cTuTjeTpkQo4LVUfuUQGqAXzgcPVg96SBqghPUHYVUPfiJpMNvZ`.

## P — pair 6: link → readings → result → forward B → A → A's crank burns

| step | signature | result |
|---|---|---|
| **link_pair** — pair 6 was registered before §40; the Pair is the witness | `5Gs6fZVnADg6npyGVJgVYpHZ3G4YF8djBHVBwMkwUQDtmQushdiPM7RXXkV58ggrr6tYJBtKBNiQYTh9WLQ5TYyJ` | 67,282 CU; two PairLinked events; both configs pair_state = 2, witness = pair_curve |
| A reading 2026-10-09, the baseline ($40,273B) | `35dXF4PbKXqiV8vijepvJ2NwygHTx7cjoNS5728XJ49iPoFk5efe1eHpcvJ5VC3pwpFw13i9SvKWRwuPx3FV9aWB` | 0 units, processed at submission |
| A reading 2026-10-10 (+$21B) | `2Y6VqnM27JvQ4DyA5b7TCKmWrdz41iDexat9R85VYpWQvBpqhvXpxFsHftoevxpzCqFPN3gYKS2hGZzU5rQLztve` | 21 units |
| B reading 2026-10-09, the baseline | `3gapsmdjnMpsApLmC25mBG6K4YvaZABVadasrxCkBC6BrWUb9749A4LQf2kMAGRGSWvo1Heqk1TWr5txLHHYnhq9` | 0 units |
| B reading 2026-10-10 (+$13B) | `1jYcr79HV7R5ETVW6oN11BbfjeRkhCoau58SyxoEUgkCVfsjSB2AjijS98r7cDtEy5qCAyjPGDmUegJ8PQFFLz3` | 13 units |
| B crank before any result (dry run) | — | refused: **PairResultPending** (6086) |
| **submit_pair_result** 2026-10-10, winner A | `qLrctk7FiLMYNuueuRgyv1pzmsYaWtMPzQDhNcPKDvQn3B7cAimFNcBMq1rirQqTxhCTgViDiyCM9rJ7TACUk5H` | 108,917 CU |
| B crank (dry run) | — | the keeper's planner plans **forward_to_winner** (kind `forward`), not a buyback |
| **forward_to_winner** B → A, 2026-10-10 | `4RFUhAB4vWgEC9J1ACC8agi9WyGuF1qgJryejBMKCAfvPueTwvZdNsX5Z1fuE4C3rap5DTwbk4ioExXWzK4kkY71` | **0 lamports** — see the note below; memo `PCLB\|forward\|from=6jxEWF78rtBs\|to=7dNGQuvijwxF\|period=2026-10-10\|lamports=0\|v1`; B's reading is processed FORWARDED |
| the same forward again (dry run) | — | a no-op (no transfer, no memo) |
| B's fee PDA funded with 0.5 SOL | `scEChZpQcXPJpH4BvwY37dBLeYp8m2DmeBWppdxDaB3KXFgApm31EbwTagzAdBSFPyfzvQ9GxWqyouq1jEE3cLD` | a stand-in for accumulated burn-pool fuel (anyone can send SOL to a fee PDA) |
| A reading 2026-10-11 (+$5B), B reading 2026-10-11 (+$17B) | `4QQnqxJxsZKmvVSzX81si6F5hWmfL7yMptET1MPGUkisYAnKBKr17McLAxJUzPtpfqsD1hjKEGwSzfm9cyGGeQPt`, `41gX6xrgygyfLmfFwVjBmWqnRoSbanNQ54FepJaArRorn3pYanMyjEVWNVMgPJ7iA2uD29HJd3Q5vR15CesWEqLg` | 5 / 17 units |
| **submit_pair_result** 2026-10-11, winner A | `2t6PrnW6vPtNZX91MLKrGDB8yDS7XoA45g1EbmbQRdUANagtseK74U32gfiGW6oaBMnkVBhtKuAQp3zYweZqBB8y` | 107,306 CU |
| **forward_to_winner** B → A, 2026-10-11, sent through the keeper's planner (`crank --mint B`) | **`2Cg9ouyAtE29NEsZQ3NuQKJ5ZYrfKczVpcT9MbMnuUvbLWK3v6LrVxBpCrAAiP7Ym4PW1AmAgJTp6uAZV1PUiDeT`** | 118,660 CU; event ForwardedToWinner {units 17, pool_lamports 504,956,626, **lamports 79,306,876**, all SOL}; memo `PCLB\|forward\|from=6jxEWF78rtBs\|to=7dNGQuvijwxF\|period=2026-10-11\|lamports=79306876\|v1`; B fee PDA 524,956,626 → 445,649,750 |
| **A's crank_buyback** 2026-10-10 (paired: PairLink + PairResult passed; A won) | **`3WohujuQ3nHH6828mxpDUeJgqgU8HqL4TB6YvDb53DZntem6x7r4iZKFMugmehN7udj8L87nkjaPGuEmsDBRsAhf`** | 268,240 CU; pool 84,711,308, which includes the forwarded 79,306,876; spent 1,734,235 (the 2 % reserve cap of this small pool; the rest is carried); **2,683,394.875645 $PCLA burned**; memo v2 `…\|units=21\|pool=84711308\|spent=1734235\|…\|swap=7GRjCd6JjiHM\|…\|v2` |
| A's crank 2026-10-11 (the first attempt right after the 10-10 crank was refused TwapDeviation — our own swap had just moved the price; retried after one 600 s window) | **`2xNmweipJRLYK71Be9EddUNZnoKUhfmzAyfs9fnJ8trTu23AGtdKXzbkkrN3WjzTAJmt1qHmGBCpPYHKV3B9inmL`** | pool 82,977,073; spent 1,768,906; **2,630,908.058598 $PCLA burned**; memo v2 `…\|units=5\|pool=82977073\|spent=1768906\|…\|v2` |
| B's crank afterwards | — | idle: cursor 2026-10-11, both of B's burn readings were processed by forwards |

Exact amount: 504,956,626 × (1 − 0.99^17) = 79,306,876 lamports. Here 504,956,626 = B's fee PDA minus the 0.02 SOL reserve, under
the 25 SOL cap, and f = 1 % per unit over 17 units. That is what B's own crank would have spent had B won. The reserve stayed in B's
fee PDA. B's supply is untouched.

**The 0-lamport forward on 2026-10-10 was correct, not a fault.** B's fee PDA held 4,956,626 lamports above the reserve. Thirteen units
at 1 % make 593,584 lamports, which is under B's floor of 1,000,000, so B's own crank would have bought nothing. The forward moved the
same nothing and still processed the reading, so B's queue did not stall. The 0.5 SOL top-up gave the 2026-10-11 period real fuel.

Final PairResult 2026-10-11 (`pair-status`): winner A, forwarded = true, forwarded_lamports = 79,306,876. A's view is 1 (won); B's is
2 (lost).

## What this run proves on the real cluster

- **link_pair:** an existing, already registered pair can be paired after the fact, with the pair_curve Pair as the witness.
- **Pair result:** a PairResult signed by the keeper key, which is both coins' attester, satisfies both quorums in one legacy
  transaction.
- **Crank gate:** a paired coin's crank waits for the result.
- **Forward:** once the result names a loser, the keeper's planner switches that coin's reading to forward_to_winner. The forward
  moves exactly the formula amount, below the floor it moves nothing, and a repeat is a no-op.
- **Burn:** the winner's ordinary crank burns its own coin from a pool that includes the forwarded fuel.

Not exercised on devnet (LiteSVM only, `programs/burn-receipts/programs/burn_receipts/tests/pairs.rs`):

- pairing at initialize_token, including the 7-day window;
- a draw;
- the 72 h grace;
- WSOL forwards;
- the cap bound;
- a one-shot rule;
- the wind-down sweep.
