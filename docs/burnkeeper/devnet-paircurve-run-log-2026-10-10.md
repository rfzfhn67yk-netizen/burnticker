# Devnet rehearsal run log — pair_curve, 2026-10-10 (Saturday evening)

Run by Claude (agent) on the Mac, worktree `mct-wt-PAIRCURVE`, branch `burnticker/pair-curve`. **The fixed program (after two blind reviews) was re-rehearsed at 18:32–19:22: §R2 at the end.** Devnet only: every command carried
`-u devnet` / `--cluster devnet`, and every CLI checked the RPC's genesis hash (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`). Keys:
the throwaway devnet keys in `~/.config/meme-coin-trader/devnet/` (four new mint keys `pc{1,2}-mint-{a,b}.json`); the pair_curve
program keypair in `~/.config/meme-coin-trader/mainnet-keys/pair_curve-program.json` (generated today, mode 600, one id for devnet and
mainnet like burn_receipts). Times are America/Denver. Explorer: `https://explorer.solana.com/tx/<sig>?cluster=devnet`. Design:
`docs/burnticker/PAIR-CURVE.md`. Evidence: `docs/burnkeeper/evidence/devnet-paircurve-2026-10-10/` (every CLI output as JSON, keeper logs,
the TWAP trade log).

Toolchain: Solana CLI 4.3.0, Anchor 1.2.1, `squads-multisig-cli` 0.1.7 (voting and execution only — see finding 1).

## Builds (16:59–17:00)

Devnet artefacts built apart from the default ones (`cargo-build-sbf --features devnet --sbf-out-dir target/deploy-devnet`), so the
committed IDLs still come from the default build (the 10-10 run's finding 3):

| program | bytes | sha1 (devnet build) | ids compiled in |
|---|---|---|---|
| burn_receipts | 721,096 (+20,600 over the deployed 700,496) | `4f6307f3…` | devnet CPMM `DRaycp…`, devnet LaunchLab `DRay6f…`, pair_curve `2jQotw…` |
| pair_curve | 344,688 (opt-level "z"; 420 KB at opt-level 3) | `e31f2ade…` | devnet CPMM, devnet LaunchLab, burn_receipts `AuQjoS…` |

## U — burn_receipts upgraded through the Squads vault (17:00–17:06)

The devnet program's upgrade authority is the 2-of-3 Squads vault `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD` (multisig
`GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w`, 60 s time lock) since the morning run, so the new instruction went in exactly the way a
mainnet upgrade would.

1. SOL consolidated into the deployer (payer 0.78, keeper 0.73, squads-a 0.39): `5hQmUc4V8m81AARPTwwhRd2k9pKiku9ZzNvm5CAtzAFnznh3Qce8enEUveF7betwD5hYtq8yZmYbX1zx2tBrcYfE`,
   `48uNJVmyZybKFyotLj7KpCqmqKLxWLPasUn1ymMAbt3v7tZNBabn5SShQ9FaYZzVHBXAfnsk2hSGmFN8Mih2Tg1t`, `5nQnpnGWcy88wPRmKjxyLjZvBFhsiHaFDFXKvPYuRuPq6JQSaQxCpvmt3tJNr8sisARJiYoAEDmFRx9rfBUxfM3C`.
2. `solana program extend AuQj…zhMM 20600` (permissionless on devnet; 0.1047 SOL): `5E84Nz2dSe1HhNW6GdQ17HMPesYysTPRc6n1hWz6AgyufgCHNZLynTU9kBgLwziL9db3qekpXTdvC18GDdKPdvZE`.
3. `solana program write-buffer target/deploy-devnet/burn_receipts.so` → buffer `BywChbBwFjvNPjw7Wyrr1RXYYpt7RgG8uAQPBKPghC7U`; dumped back and
   compared: sha1 identical. `set-buffer-authority` → the vault: `3wg1dLWAwsD9Pssn5GXd7K6jCEXn98zAauwGBu9tzFccvzjPiDNj8HzfpGShhPHsfvDbrxwpcFjwQytDFSRurEPM`.
4. Proposal (vault transaction 2 + proposal) with the new `scripts/squads-program-upgrade.mts` (finding 1), member squads-a, memo
   "burn_receipts: register_pair_pool (pair_curve, policy 2)": `2dZnDLtjmv4VZqoqqpcrrf8FZZgwbLYJRr7pNEsgFKKRT1dMgBgdRixW6nxSD7BBw5sJ2UNb7YyMDeenYmTLVL1L`
   (`squads-upgrade-propose.json`).
5. Approve A `4w6BpcHix6s1JHkTKLrx1CoPZ4FitWVBre6tsR2Kf2BiE5ahTpaqEE1SNi68d4jkUTKR97cUTmZKGtU8Qyr5N7sn`, approve B
   `4MFDTqrWofTGHwHNs7tv14kHRuoqVuFdxzVYE3qFC14fv2ANdANVAfPEa6XhSb1wCvqaUUyGHKBTXmFBJWcEUfcV` (17:04:28 / 17:04:34).
6. After the 60 s time lock, `vault-transaction-execute`: **`3ARtrz75uBvAY5ubnyd2eQA81DQ2JXc5ugGBfZW6sJt1pGZxpUvYy6dEb9uaNPVdChtbt93MPVvPj11v5WzLVRKb`**
   (17:05:58, 35,314 CU). `solana program show`: authority still the vault, data length 721,096, last deployed slot 509,700,447. The
   deployed bytes dumped back: sha1 `4f6307f3…` = the build. The buffer's 5.02 SOL returned to the spill (the deployer).

The existing $DEFICIT devnet token (policy 0) is unaffected: no account layout changed; `register_pool` and every other instruction are
the same code.

## D — pair_curve deployed, authority to the vault (17:06)

- `solana program deploy target/deploy-devnet/pair_curve.so --program-id …/pair_curve-program.json`:
  **`jX24ZrjbmW7q2vKQL5HqGvtiTcc4LDMo2HBNPikS4XyxEKDkeeqg6dWBwTBiJBNhRPp5quLqqQ81KnTmBiME51F`** — **program id
  `2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN`**, ProgramData `D7yNbaLY1BSZXXvkcuDjEtkRVsUjZy3RtRPAzenoUKTG`, 344,688 B, rent 1.7519 SOL
  (devnet rent is now 5,080 lamports/byte — finding 3). Dumped back: sha1 `e31f2ade…` = the build.
- `set-upgrade-authority` → the Squads vault: `36V5B8wPZ4wSp1kfLUjPqGTFkNpoxRbgY3TrYvkSGjN3PgxVc9EcdPVke5NwENqAdW5FQERgD5N5qmnk8sAPmc6K`.
  `solana program show` → `Authority: A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD`.
- Funding for the run: deployer → payer 1.2 SOL `faf55osvocv62WhZh4Lz1QeY3W7GEcvJqhniwt8jvR8tN6zF291pwVatHmQBB3A2SLeBBcTidN76vrZ9tULkDyT`, → keeper 0.2
  `4vvinfgitpv4zLMJffv7d8SEN4NqJ5oDz5sd9CXaL8YrSnQnQUm28GYsp1wv78QHgdTi95w5KDS56Wu6t1DuiP2K`, → the developer wallet (devfee `3s97…5pZp`, which held
  0 — a sub-rent fee would have been redirected to the burn pool, by design) 0.001 SOL `4y7YtLtcpkgmCXVbPLpAb38n6bCZJ6mz43fWscLRTgZKmRXkwkLBCvAo3YuLs8B4MsZCvqGKXS3nDDVNrv9j9dBR`.

## P1 — pair 1 ($PCA vs $PCB): trade, graduate both, register both, crank both (17:09–17:29)

Parameters (`pair1-init.json`): virtual SOL 0.3, virtual tokens 1,073,000,000, curve supply 793,100,000, reserve 206,900,000, target
**0.65 SOL combined**, minimum side share **3,000 bps**, deadline +24 h; cpConfig `5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy` (devnet
AmmConfig 0, create-pool fee 0.15 SOL — read from chain), side overhead 0.182258 SOL. Rules files
`config/burnkeeper/paircurve-devnet-1{a,b}.rules.json` (the $DEFICIT devnet rule with these mints, tickers and memo prefixes), sha256
`33d3465b…f4f7` / `345afddd…664a`; attester = the keeper key, admin = the Squads vault, creator = payer.

| step | signature | CU |
|---|---|---|
| mint A + `initialize_token` (policy 2) | `MmH3Nw25T4zErS6rKfiMhX87xGBVc7LMdrg8GRgSC6UYcf8jxC2t9SUMGWs8YrxLXDAjCXKqpdzaokdyuSd32S3` | 30,248 |
| mint B + `initialize_token` (policy 2) | `285miG3pFDngLqZPxcGDQqciTB9qMAREamohrxYdyqvCGEokT3exZo7gmZ3RGUFsQENY8qSmmoX5YkyHT113y2cN` | 33,248 |
| `init_pair` → **pair `5etkAGzWxEsyUcVwWNA8hVCfH4cKcsqCBo6FiW7RRfGh`**, vault `71yLtEPJDg8JbtZMDT5wSTcKFLaAgiCrH2TmJ8zkNKiw` | `4y7P4x92oc1va54BGkyFvPXwiYTiAT8XbhoKTCvZvnfpSUq3cX3TPR1c1LQXHdLNxvxQDpPP6hKtjRidfsEXB89i` | 124,767 |
| buy A 0.25 SOL | `3L1LooVq8cmrJcQE9KUfzwkW1QXkBGUXB2wqZDnnNn5Yd95RgXa4P35i9QqZVC4SkvRmXVL6nMsN3fYGozcEzAc2` | 83,923 (creates the ATA) |
| buy B 0.15 SOL | `2uehWPHroeQvKbDgkJpASGt614gNgzbKpY4u9XbppEQRsLZSGndgZm7DDu9A61b2XaivGDKaP2z3toq53AH3VTtL` | 52,423 |
| buy B 0.15 SOL | `4fnsidvepAE4vC5HxzTbiQwj3miZkzacEuK9i19AnPgXhw1rrUM6nsjJ7bL8i5YWFVr3KM2DuuhNFBRiZhEjmyiy` | 35,770 |
| buy A 0.13 SOL → **ready** (0.673 SOL, B 44 %) | `2FKBNrSyKiWhdNNdqWwpUy572DM1VPyZzv9Lh8aupW8uXVxbXa27sLE1KSASEkpqj9pHNPoKqMCDdXj9CFN6fqJH` | 46,270 |
| sell 10 % of A → **not ready again** (0.598 SOL) | `3fsJSfLTKrLAxxCgr8p3rBaGZZ6YjRmVrAy2grJZF1d6Cc1KrGeMoi9jS1tG5xBERUpF4ku1Fhz6ttR7AvVpb3nC` | 32,356 |
| `graduate(A)` simulated now → refused `NotReadyToGraduate` (`pair1-graduate-not-ready-dry.json`) | — | — |
| buy A 0.06 SOL → ready (A 0.3603, B 0.2970) | `ddhmnFUHzGWi18LzAq13XJh1caNKgqM7hy8mQJFJUoiUhR1VsJB3H5ptggWJoqKnKiuZD9yuqfSNt8E9dtqibE4` | 46,261 |
| **`graduate(A)` + `register_pair_pool(A)`** (keeper key, one legacy tx, 1,061 B) | **`2tmzXVpgo5Y4fgAmhoDifNMWvFh3DPxnwHQfY46CrwGR4phEjgMCEPm257LXkCu7j5DZxQcEXBwee5oVqoadoxb8`** | 185,067 |
| **`graduate(B)` + `register_pair_pool(B)`** | **`goVXVCTZ4j7jLKDeBWcaRqDVqz6UtFzGSx4aqA1Ji5mYPFeETbwrRf8JkcE4RyHtq2TNADN9tRocEhqvqX8Wo6x`** | 187,291 |

The graduation (`pair1-crank-graduate.json`, read back from chain):

| | side A ($PCA) | side B ($PCB) |
|---|---|---|
| raise | 360,285,708 lamports | 297,029,704 lamports |
| **CPMM pool** (pair_curve PDA `["pool", pair, [side]]`) | **`HxSR844GVUQ42nXatLoJjxkaDCcUZvqYuBBuoaDt4MwK`** | **`6QAri6SSuup5EgtBDAXy958VKi8CgxhdQNZobKWS1xaH`** |
| pool SOL / tokens | 178,027,708 / 131,445,215.660877 | 114,771,704 / 103,648,716.393443 |
| LP at creation / burned | 152,973,495,977 / 152,973,495,877 (all but CPMM's 100 unminted units) | 109,068,509,652 / 109,068,509,552 |
| tokens burned at graduation | 283,071,015.721796 | 362,520,436.905503 |
| supply after | 716,928,984.278204 | 637,479,563.094497 |
| burn_receipts TokenConfig | `cpmm_pool` = the pool, `pool_verified` = true | same |

The SOL vault ended at **650,240 lamports — exactly its rent minimum**; each side's residue (rent refunds) went to its own burn pool.
The pools trade on Raydium's real devnet CPMM (the simulated quote in `burnticker-devnet-trader.mts cpmm-swap` and 14 landed trades).

**TWAP history** (17:11–17:27): `burnticker-devnet-trader.mts cpmm-swap` alternating a 0.001 SOL buy and a 700,000-token sell on BOTH
pools every 150 s, 14 trades, all landed (`twap-trades.log`).

**One burn_receipts crank per side** (single-token keeper `scripts/burn-keeper.mts --devnet --once`, `BURNKEEPER_EXECUTION=program`, one
ledger per coin, the real Treasury feed from 2026-10-05; logs `keeper-once-1{a,b}.log`, `keeper-crank-1{a,b}.log`, receipts
`pc{a,b}-burns.json`, status `pc{a,b}-status.json`):

| | $PCA | $PCB |
|---|---|---|
| readings (10-05 baseline, 10-06 23 u, 10-07 11 u, 10-08 22 u) | `2MdrupZFoBAoP6rebYxJjVFQYeV1abroa7G2AZqe3UVpBDrDTG54o5Vk1c3XqYTaGiJghgqw8hif1x5u5pyUSqzB`, `2S61EX3bo5snc22XQxipfvzKKoD2PRMrhdgw38wZxQ1arAJPvPTGm3VjG4CezpmVPLkDqLeX8M76Fy9HdabWpBm4`, `fB8hxDzjSsYDwpgrp722EQUGqN3sqhU6owXceS4kTz6MWPvgUSYZYppbW24qFTZrtMMGeLQFAC3AqgbsanEwvDy`, `248upD3dSr9cBSoUYrs2kz5h816ehooykJsBZZWmj21jAyQfwscM5kAQjXq77FuPqKVGvQzh4NXyaaosTnMr52Le` | `42ZCTXQWEmAzi7owBZcfxfwtJwAEsFum2B7bdAHV8iNpUcMrovWJAjr874kuGZzcc9wBgyJzHKH1bujHjtXPK2rK`, `5bf5isoPe7Lx7gJBSzNczJXgp4Jc8x4PXhMzcZPjmQZ1cy4z9EJQYbqrJidzuypgfmSK8V4tFMZvBTagQ5NBT1yB`, `4mz7uGJzjLsd5Ti1wsWoYJKkmww7Zq5riBzJH4fD27ZtB4jLNc8X24DFADaMjCt4z1hi4Dd4zmPe584dCKKfixQK`, `YGrMTG7sRQVXXswZzEUBPPTDk8rGFewh2xKVCNvf2fCsScx5wdMbHRLXzQ6BDt8KukHV4usquNK8nm86d8AYgnN` |
| `check_pool_health` (pair pool: tradeable) | `3SfxNoBn5DDvxobvnuAZ9J9tLaMA1zEmze6tygV9ZyLxNFu5heowMxGUxCiUQTEPfkBCWeARXdAWx3iM6ZCh7x7W` | `56XDdF4hEa3cyKodK7bUmgyyfQGSZwHdHf9GvzkEFZRXGv73vNoXpwPDagTHwbuD63Wd24JhD8DpCLsVh7ePAm7S` |
| first crank (17:17) | deferred `TwapUnavailable` (the pool was 7 minutes old) | same |
| **crank_buyback 2026-10-06 (17:28)** | **burned** — spent 1,405,362 lamports, got and burned 1,014,025.155046 $PCA — **`6gLu9k4uAKGF4CVnJTobBu8qJW9qxsvLLwFiwVueNfmczkpPTg1rSiWjP81Y2PJrryUXX58FjUupojieBmRDmXt`** (222,670 CU) | **burned** — spent 1,074,156, got and burned 931,998.637437 $PCB — **`4W2njhurhPWRgkg13HFGGKpnYVwMFJRJYAbb2JNFfTz1rj4TuX8tnzu6fA1rR5dz486zwPE91LQbtHtwd5ijj7ZT`** (212,939 CU) |
| 2026-10-07 / 10-08 | below floor (the tiny burn pool: 10.5 % of 0.0054 SOL < the 0.001 SOL floor) `3wLLZqEVXpcCQZWzFnEahJN8vowsvwGQLo4cpgoG8rmZwMbiro5QuYWNVbF5kGYqV3bRb1xs5q83ZoADxr6LEPJ5`; 10-08 deferred `TwapDeviation` | below floor `43W5U2Hs12zZfPTcGJEf9oDB2jecMFXbS1Fo4Vk7XtGCRBS1iCBFUsgHT8UyZUUXq1qFaB7jSEy86UeefLCtQNS7`, `55Vu12CwBEk2fby4dbvHRv2ku6GmKR8hVFg99ZmmVwp2ebCTsWHUTiQCKaNhNHBPT3nVa8j4WPzXd1VCbPBpx9Rh` |
| receipt check | `verified: true`, no failed checks; the memo `PCA|2026-10-06|…|swap=HxSR844GVUQ4|rules=sha256:33d3465b1f41|v2` | `verified: true`; `…|swap=6QAri6SSuup5|rules=sha256:345afddd0b4b|v2` |

The burn pools' money was the curve fees alone (75 bps of the curve volume: A 3,832,511, B 2,227,722 lamports) plus the 0.02 SOL
reserves and the graduation residue — i.e. the fee leg pays into exactly the account `crank_buyback` spends from. Developer slice
(25 bps): A 1,277,501 + B 742,574 lamports into devfee (`pair1-status-final.json`).

## P2 — pair 2 ($PCVA vs $PCVB): void at a 4-minute deadline, everyone sells back, close (17:11–17:17)

| step | signature | result |
|---|---|---|
| mint A + config | `1E7CWvhwAx2PV8WWNuCf9F5PbiicGRP2rox3x2yGzKMkvXWM87XMVUkKjKBjoZFpyCeKJ2UpE38WviR1i8aYX6g` | |
| mint B + config | `MQ7opgx288k9eP4EKtznCCYVNXc1DfJakzZP9r1ay69eDxxWDk3sMsSTCFZau62XP6kVoVAsFzVmw6bsBvvFfjL` | |
| `init_pair` → **pair `3WzEhdXaWZVA8K21rywXzgwK3RktQzPmxsWfZvcDb9fh`**, deadline 17:15:54 | `36AB4aEKN5sAaeA56xhweC5fe5PCU3MFYpndkwfTzoWN2oikU3snfrkYb1VfTborZVuaLyGj6NKRqeDmfnjT6Fr9` | 109,767 CU |
| buy A 0.02 (payer) | `6YKBNuNrXBK4nDmtox7oPiYA2w1ZtFsA8ZTPye4DRxSmYHhKfxQbAHXgvM87yV4nHip2NjePCqWSAVHbW6mGN3f` | |
| buy B 0.03 (payer) | `5auQnBGHJ1doJb89PAyQQi5bpjSuorYmXejEQqCqRNS8ARSQPzKJTDzMhBwjVxdJ2XFXgKc4QL6GqeCbLfdkXfN9` | |
| buy A 0.015 (keeper) | `2U2AgNPTLpB4gZ5gf1bYCGWZ2pC2nZAePmFymL2jBoHzT4xH7ntVcVf8MMTrUzgYMQbuw9ag4MyesJFyHFB7fbUS` | vault 65,006,678 = rent + 34,653,467 + 29,702,971 + 0 |
| `void_pair` before the deadline (simulated) | — | refused `DeadlineNotReached` |
| buy after the deadline (simulated) | — | refused `DeadlinePassed` |
| **`void_pair`** (keeper) | **`4RCEHF5bH8h58WAv4dQ4vZHnZ1hNMGXJd3s7nuegurYpr1w5Cc3vHyeToEa5Ex9Krt7K3MtjLyRyRaiUksCX9uyF`** | 18,057 CU, status voided |
| buy after the void (simulated) | — | refused `NotOpen` |
| sell all B (payer) | `4rWPLrF2jyGnv7h9tztjjNirqU1UKPnaduqfhopAu71TqyKecpP7anErrowksChAHbgr1vAX5dQiNnKD2YP8FSSs` | received 29,405,942 |
| sell all A (keeper) | `wGihB4VJ4eirQHFPJXVFPuSQqVhCzrSLDXfpdXGGVPd47bxWFq3E7XxjNVX6944HG5U2sqqferk9zi1PyAdv8uZ` | received 14,702,972 |
| sell all A (payer) | `4z6Dh6q5zD8ponc6DomKGjpzvHG4J5LoiZ5dPq2g6DpNtSV4TjgHVzy2jSPubCWNV1CvMV9UAx7Wo36HraLCNsG8` | received 19,603,962; **vault 650,240 = exactly its rent minimum**, sold = sol = 0 on both sides |
| **`close_pair`** (keeper) | **`59TxcGs6TWQ3fTMzgdtcUwCzjwPPBLEiLcPdBTRW893e19izQ2uwZxqxSzCu5hgMbXT6b9D26uQ7J894GymM6QDG`** | 28,422 CU; the Pair account closed, both returned supplies burned (supply 0 / 0), token-vault and Pair rent to the creator, vault still 650,240 |

## Checkpoints

| | checkpoint | verdict | evidence |
|---|---|---|---|
| PC1 | burn_receipts upgraded through the Squads vault (propose → 2 approvals → 60 s → execute), deployed bytes = the build | **PASS** | `3ARtrz75…`, dump sha1 `4f6307f3…` |
| PC2 | pair_curve deployed, authority = the vault, bytes = the build | **PASS** | `jX24Zrjb…`, `36V5B8wP…`, dump sha1 `e31f2ade…` |
| PC3 | the graduation condition holds only at target and minimum share, and a trade can un-meet it | **PASS** | ready at 0.673 SOL → a sell → `NotReadyToGraduate` → a buy → ready |
| PC4 | two CPMM pools created at pair_curve PDAs, creator = the pair's vault, 100 % of LP burned, leftovers burned, vault back to rent | **PASS** | `2tmzXVpg…`, `goVXVCTZ…`, `pair1-crank-graduate.json` |
| PC5 | both pools registered in burn_receipts (policy 2) in the same transactions | **PASS** | TokenConfig `cpmm_pool`/`pool_verified` read back |
| PC6 | one burn_receipts crank_buyback per side burns on the pair pool, receipt verified | **PASS** | `6gLu9k4u…`, `4W2njhur…`, `pc{a,b}-burns.json` |
| PC7 | void at the deadline; buys refused; everyone sells back; the vault drains to exactly its rent minimum; close burns the returned supplies | **PASS** | `4RCEHF5b…`, three sells, `59TxcGs6…` |

## Findings

1. **`squads-multisig-cli` 0.1.7 cannot create a program-upgrade proposal.** `initiate-program-upgrade` fails in simulation with "Failed
   to serialize or deserialize account data" (instruction 1, `VaultTransactionCreate`): it serialises the inner message as a Solana
   legacy `Message`, which the Squads v4 program's `TransactionMessage` (u8 counts, `SmallVec<u8>` keys and instructions, `SmallVec<u16>`
   data) cannot read. New `scripts/squads-program-upgrade.mts` builds the same two instructions in the program's own layout (devnet /
   localnet send only; on mainnet it prints the bytes); the CLI's `proposal-vote` and `vault-transaction-execute` work. This also
   unblocks the morning run's open item A25 (finalisation through Squads) and every mainnet upgrade.
2. **One instruction cannot create both pools.** The first design graduated both sides in one instruction; Solana's 64-entry instruction
   trace leaves no headroom for it and a griefer pre-funding the addresses CPMM creates could push it over and force every pair to void.
   Graduation is now one side per transaction with the first call committing the pair (`docs/burnticker/PAIR-CURVE.md` §5.1); measured
   45–47 trace entries per side with every address pre-funded (LiteSVM), 185–187 k CU with the registration on devnet.
3. **Rent is 5,080 lamports per byte on devnet and mainnet now** (`solana rent 0` = 0.00065024 SOL; the runsheets assume 6,960). The
   programs read the Rent sysvar; the TS pre-flight (`src/lib/pairCurve/pricing.ts`) and the admin CLI now use the live value. Program
   rent: pair_curve 1.752 SOL, the 20,600-byte burn_receipts extension 0.105 SOL.
4. **The single-token keeper runs pair coins unchanged**: the LaunchLab fee legs log "no LaunchLab pool" and move on; readings, pool
   health and `crank_buyback` work on the registered pair pool.
5. **Tiny rehearsal pools make tiny burns** (expected): 2 % of a 0.18 SOL reserve per crank and a 0.001 SOL floor — the later readings
   were below the floor. Not a defect.
6. Agent tooling note: zsh does not word-split `$VAR` command strings — the first init attempt ran nothing (exit 127); the CLIs were
   then called through a shell function.

## SOL spent (devnet)

Start (17:00) 5.85 SOL across deployer/payer/keeper/squads-a/squads-b; end (17:30) 3.16 + devfee 0.0033 → **≈ 2.69 SOL spent**: 1.752
pair_curve program rent, 0.105 program extension, ≈ 0.66 into pair 1's curves (0.293 now in the two pools, 0.30 to Raydium's
create-pool fee, the rest rents and burn-pool fees), ≈ 0.13 rents (four mints, four TokenConfigs and fee-PDA reserves, two Pairs, reading
accounts; pair 2's Pair and token-vault rent came back at close), ≈ 0.02 transaction fees and the TWAP trades. The 5.02 SOL upgrade buffer
came back to the deployer.

---

# §R2 — re-rehearsal of the fixed program after the two blind reviews (18:32–19:22)

The first version above was reviewed blind twice (`docs/burnticker/reviews/2026-10-10-pair-curve-blind-{1,2}.md`); every finding was
fixed or accepted in writing (`docs/burn-receipts/CHANGELOG.md`, "late evening"; code commit `fa8627a4`). This run upgrades the devnet
program through the Squads vault and repeats both pairs on the fixed code, adding the reviewers' attacks where they can be staged on a
real cluster: a pre-funded WSOL pool vault (R2 H-1), a pre-created vault token account (R2 H-3), the commit latch against a late sell
(R2 L-2), a developer claim instead of per-trade payments (R1 H-2), a fee-free pro-rata redemption (R2 M-1), and a close after a holder
burned one raw unit (R2 L-1). Evidence files carry the prefix `r2-` in the same folder. burn_receipts was not changed in this round.

## R2-U — pair_curve upgraded through the Squads vault (18:32–18:39)

| step | signature / result |
|---|---|
| build: `cargo-build-sbf --features devnet --sbf-out-dir target/deploy-devnet` → 365,240 B, sha256 `1ab6b1c9405b5d5fbdc0548143dc2a0e30e29ef6bc1da1d1168347ff44a17fa0` (mainnet build 365,184 B, `567b1f85…e06e482`) | — |
| `solana program extend 2jQo…ELkN 20600` (deployer) | `2eDopGLA7mTqhRjZEMTs7g6DN1qGCi1sbzirHK7HR9QPeMuhz8P8ybVthUgr6aY34Qyc7paKeC3m7RhVSdHmAgNZ` |
| `solana program write-buffer` → buffer `CHW1bHRiuio4FStE3QeL8Uhhi3WFrD3WXaatLYeKNS1U` | |
| the hardened proposal script refuses while the buffer is still the deployer's (R2 M-2 check 2) | `r2-squads-refusals.log` #1 |
| `set-buffer-authority` → the vault | `2yjj2E9g5BjffPcqvXEbHHmVzGzstPhy9BXSz9NyctNE3tFeGiAzmXWrbQCQCy2vJ8m3QSqz65z36P5WP2Zfkovs` |
| refusals: `--expect-file` = the mainnet build (hash ≠ buffer), `--expect-sha256` ≠ the file, spill = the deployer (not a member), `--vault-index 256` | `r2-squads-refusals.log` #2–#5, each `exit 2` |
| **proposal** (vault transaction 3, member squads-a, spill squads-a, memo "pair_curve: blind reviews PC-1/PC-2 fixes (fa8627a4)"); the `checks` block printed buffer sha256 = local sha256 = `1ab6b1c9…`, buffer authority = program authority = vault `A8VV…MqffD`, spill "a multisig member" | **`32dyoAwvP4P5FzZLq3C31GaH81jvHVy8xV61rGq6XabW7MGZYsbyvDFpzCbQ5y9pnmNWo6HVRBL4Xd4T51ZxMpke`** (`r2-squads-upgrade-propose.json`) |
| approve squads-a / squads-b (18:35:54 / 18:36:24) | `4gc3EHxG3GrY6Zs5YV5cvg19B2xMwsYbZgQhsjnSX4pG1H54wF9V7cWRoyQRkztBdCidTH258gkTwgMmNBFDxczY`, `rWCYPniug2UPwLSTDvvizkPenJmTJK7EfTibquhReCbzhdSMgWWqgx3i6oJ3un1eKa8Z2p1zh3WRq3B6KaifqUA` |
| execute at 18:36:59 → refused `TimeLockNotReleased` (the 60 s lock works) | simulation only |
| **execute** (18:38:10) | **`27ZQn9ATnKYiJza3yhktSGAzymXLba2EBSNW4252vepb8oeJEVDj4ebPLdVkuWTTuy25R7W25WX6UxArHRPcFpi8`** |

`solana program show`: authority still the vault, data length 365,288, last deployed slot 509,723,606. `solana program dump`: the first
365,240 bytes hash to `1ab6b1c9…` and the rest are zero — **the deployed bytes are the devnet build of `fa8627a4`**. (solana-verify executable hash `35b5b3e1c5080aa6c662616607e101fd2626a2f354dd75eba187572c7225d3d1`, `scripts/ops/verified-build.sh --onchain devnet` → MATCH.) The buffer's
≈ 1.857 SOL went to the spill (squads-a) and was moved back to the payer (1.0) and keeper (0.6):
`3HyybgFXtMRaNBuB8rJ6DfoZTiT87QRvMFKGbdDwgofibqHXDT3GTF2zHHW6ioGEXVbkDQ18zNDsshqwj4hPrjBS`, `2ZBDoh8kkwS2Qa2irMn1xs9z1dkr6o73k1Tm5DPZMx7PiJQ5GP4rkye2KvMXWtMV4uGUbYJ6bQ1pYRzg6bhsnKZT`.

## R2-P3 — pair 3 ($PCRA vs $PCRB): latch, pre-funded vault, graduate and register separately, claim, seed, crank (18:40–19:22)

Parameters (`r2-pair3-init.json`): virtual SOL 0.3, target **0.5 SOL combined**, minimum share **4,000 bps** (the new maximum), deadline
+24 h, platform `GvSKpe5p…` (= the compiled-in `BURNTICKER_PLATFORM`), cpConfig `5MxLgy9o…` (create-pool fee 0.15 SOL), side overhead
0.182258 SOL. Rules `config/burnkeeper/paircurve-devnet-3{a,b}.rules.json`, sha256 `f11a515f…5f78` / `aaa93022…6de3`.
**Pair `5LUZ63F62Wwq6Ma2pPiMqiEftFaRFYuckU9xsiaQJpiZ`**, vault `yAF15bpvtuyWVVa69qQioKDiwN4mHP1bkPqdZGnpiGZ`.

| step | signature | CU | state after |
|---|---|---|---|
| mint A + config (policy 2) | `MuCh8Zoe2eA6BuCdHLu8BLP9K3MLcvPo9Vtkwi7CvoRvG9SL9tn1owyRYxUGnTiAEPBxdmxwGA9GCvGBrWjb3Br` | 30,440 | |
| mint B + config | `ihzHy5FfEgx2zruagm7ab82DnCPT8gKcorMZywdtUANQj4cCvGsfvY884gRKsY1gBmfnnG9pTRUMZbrKPm3vSvV` | 34,940 | |
| `init_pair` | `PVsqrtCL55vmbwPjpEZi5xgZBn7x5HJzqfGo42yJRKJpNmUqidFepCxunBYMrAV6ycuDCSEcEhygcGLFx28kKqT` | 121,967 | vault 650,240 (rent) |
| buy A 0.20 (payer) | `4LQwDNeRm9NJrCrW6YNxHydF6n1cgrGSsrSEuKSy7tFFoxPX2YZ1kmb8zMaJ1UxsDhittLx9z91B8H4sPG91vjr2` | 50,630 | A 0.198020; **vault 200,650,240 = rent + curve + the 1 % fee, all in the vault** |
| buy B 0.12 (keeper) | `2iKmihvKSDThdyhe223WxNhV4p3S5AT9sdffWertMPAQwp1disbNhRn81G7jvpSsNie33jrXfccZset9JJKPBmq8` | 55,130 | B 0.118812 |
| buy A 0.10 (payer) | `5iM2GNLWJW5gKMR4rW6S1aDkw35jQpqbT1dHJ8U5JrqZRnXZVNGtDLiZuPVaqQgxyQqg6QzUHHp4k15aqw2asi6Z` | 33,977 | A 0.297030 |
| buy B 0.07 (keeper) | `5rsdwCC2jysuQZBg2763iJ4nh6yGKgYQLWBG8qGrm3qGvKy5sRjofrsskTnV3MR2XgNfFNzTzemW1zHfX9dTYgCN` | 35,477 | 0.485 SOL, not ready |
| sell 5 % of A (payer) | `4QWGUYG3WhAbe3kitmepq4LW4fB7DrvVBbGTbk8YgnWQPT7dBx6snWKeXaAZ8wyeS7PWKMkCVSya1KvuVsDRGf4f` | 30,004 | A 0.268868 (0.457 total) |
| `graduate(A)` simulated → `NotReadyToGraduate` (`r2-pair3-graduate-not-ready-dry.json`) | — | — | |
| **buy B 0.05 (keeper) → commits the pair** (0.5065 SOL, B 46.9 %): status Graduating in the same instruction (R2 L-2) | **`4mkLixEZYGDS3n6CP49vyXs6xctceaHXieiVanZ9ZbTWp8UG4pHoQJJ5sj5tA3a7onf55i6AifZvALeNgCBYyJsb`** | 42,359 | graduating |
| sell after the commit (simulated) → `SellsClosed`; buy → `NotOpen` (`r2-pair3-{sell,buy}-after-commit-dry.json`) | — | — | |
| **pre-fund side A's future WSOL pool vault** `AJZpVSbK4LEuzW63ET1XCqJC83dvttkArbtxGLNMuQ4V` with 0.0025 SOL (R2 H-1; the first version could never graduate after this) | `56ateEY6ymDJWDWdbTa3CbVbATEvw7a9asYLPqZVTGcrkPr9KL2E8C4Y7mvxkmvwt1SPcj97bCRz8ch7esvsbmB1` | | |
| **`graduate(A)`** alone (keeper) | **`46uhtuzdaW44FvxQHDaGj2EJGS4uRyLT2HMYQeHTNPC9Pz7hrZqo21N2aLgVoR1VTCqiigoRT4Dp1LEowC2YC8EF`** | 172,203 (946 B) | pool `cix9ZfHG…`; its WSOL vault holds 87,621,485 = pool_sol 86,609,925 + the 1,011,560 pre-funded above rent |
| **`graduate(B)`** alone | **`hB6baNZkjgd7nk81DUZr7d9xw2BdoXvnhk1oyMK2VY6zDDyzLzR8FLvNvsGFxdRo795Pq43p8LB4wutn1GPPDWN`** | 162,739 (946 B) | graduated; **vault 2,057,275 = rent + the developer accrual 1,407,035** |
| `register_pair_pool(A)` (own transaction, R2 L-3) | `53HgvikhkjeCQvpYbY67dKD9MsQWMMhETokJyjgxYx1u3oaupyuCHg2KQ1nNdWgX87gizLLjtAW74ZYReEoTyAJF` | 23,691 | |
| `register_pair_pool(B)` | `4eU4HWhDfnWMhrAQfna1mrqFUdYNi2cpc7UU4AUppg3MyWgTH4UbBrzNCXKEHWRadM68pJuz5y8Q2hWZrCijLNtF` | 22,196 | |
| **`claim_developer_fee`** (keeper, permissionless; R1 H-2) | **`1UCWQfb84HovVmDMrLKxvc8djj2KgECimqqQS8ERZAE6YkQFKNAJUXXyKsjarrsztxszRvWFzXRQFTarzFMfL4`** | 22,579 | devfee +1,407,035; vault 650,240 = rent |
| claim again (simulated) → `NothingToClaim` | — | — | |
| keeper crank: planner sees two unseeded pools → `seed(A)`, `seed(B)` (10,000-lamport swaps; R2 L-4) | `3BJ9y9fNgMTiPGS7yTN639EAGe8JucipxKoeFyqSktBDVabYGwyne2xDWRLbJuTsw5ieQWHRetL17bMTneSnFNyB`, `3Z8PWYGqDTommTPT3nTD3MpyLKz3gDgF1RnnH5fT6MLe5psjM6wQ4vRcpdr7eLXESkK9G9dK8c9AaT7UruMnJNey` | 48,602 / 41,023 | `r2-pair3-crank-seed.json` |

The graduation (`r2-pair3-status-after-graduation.json`):

| | side A ($PCRA) | side B ($PCRB) |
|---|---|---|
| raise at commit | 268,867,925 | 237,623,764 |
| CPMM pool (pair_curve PDA) | **`cix9ZfHG9Q6Um23AScu3yPVZHSFYGrHEcfs3EV8ST3e`** | **`33w6tp8A5p49gCjYCeZV2XnbjYNV9y7unVQLYGhwSkbN`** |
| pool SOL / tokens | 86,609,925 (+1,011,560 pre-funded) / 86,152,075.604568 | 55,365,764 / 61,660,261.131480 |
| LP at creation / burned | 86,883,673,957 / 86,883,673,857 | 58,428,310,483 / 58,428,310,383 |
| tokens burned at graduation | 406,708,620.887362 | 464,085,593.413745 |
| burn pool after graduation | 26,904,257 (0.02 reserve + escrow 2,438,937 + residue) | 24,759,058 (escrow 1,782,178) |
| developer accrual (claimed) | 812,977 | 594,058 |

TWAP history: `burnticker-devnet-trader.mts cpmm-swap` alternating a 0.001 SOL buy and a 700,000-token sell on both pools every 150 s
from 18:45 (`r2-twap-trades.log`).

**One burn_receipts crank per side** (single-token keeper `scripts/burn-keeper.mts --devnet --once`, program execution, one ledger per
coin, the Treasury feed from the 10-05 baseline; logs `r2-keeper-once-3{a,b}.log`, `r2-keeper-crank-3a.log`, the keeper's published
`r2-pcr{a,b}-{burns,status}.json`):

| | $PCRA | $PCRB |
|---|---|---|
| readings 10-05…10-08 | `2BDDpkPzsACaiLqRhUjCmRWmXiqoCfteJm7aiPFLAk3rZ9fWVK693BSHRLDcqK3Pi8ABGAdMCtoCq99HfaeVfeN2`, `5tSnNqQNbcUwz9psPPu6ZnNtkeb1sM2cA9vpZ6WWHyKG1Z3fEnjCHWcsaMcsRZXHiq3tdrdvxNHd5RekWiN9ss4g`, `JdpNtfaEespmejcUwBibNVVEHopCLApJgpLmFzQC9KL9iCtqubiUekbPFkvB9mEBFXuNTkttQEQFzsg8RTKknAJ`, `Sb8xDVvLsK8w9RnsqFtUTmnAnBbvoJEd9StZJz4PH5D8Vsn2q3HYnixPSPXmm4nQG4C7MgwgtyL3JKU1RW6dUYf` | `EnGfxDFUXBAUFQYzsdRWTvmwaJJEhjRJkNCAKQzWQcdBfNMXJuTZA2fFDaE18yJf5pcXGXCo2k8RKPPVybKVjdq`, `2ismE6vBiMKriYZqvefMXkHwMitdevZ8A168sYgVqG3jKrmRY3wxnQRSS2Yjh9h6hLneDvrtr4qidDw7FvGcLbZu`, `4tBA5bPRPTERkiD81V4xmqQKsjttYyQUo75LBZJc26NuoEVFb64MoedZZg6rRtyx5Zr9KnWcxdGWKiDfntHRB2W8`, `4kR1wMb1fHfyMqjoTGXiBpBZH8rGtGngcTdF1hZDKGvYvSfocMgrtxh61rfhfMgsg61LLo5zCBtV2o7Kf5TRFTZt` |
| `check_pool_health` (pair pool tradeable) | `3p5scRBzGJjRmpQdNsebq2kMW9msh4SABqqhax2z15SMY9wwvRGdA6kGGpqGnw4UjQqotCKsotbHGQSz2VxTLhuk` (+3 later cycles) | `3AdHFZEt5Ur5Hs2A7mB1Eo5gTRP1EttC1geXS2Eci2UGhk6RFAxpxgECvzvKp5seMvcoUmn7gdLMc3qps3oNL5kr` |
| 18:51 | 10-06 deferred `TwapUnavailable` (seeded 7 minutes earlier; the rule's window is 600 s) | 10-06, 10-07, 10-08 cranked **below floor** (spendable burn pool 0.00476 SOL; 1 − 0.99^23 of it = 0.00098 SOL < the 0.001 SOL floor — the rule keeps the SOL): `52YTyu228nh2XhKxtEfGe69QpFHdZv5UAa3AKcRw224Pqi3H1bZuG4KVsMPFgM1fhmn5kynS7acRjhYi9eD7XdYi`, `4LWbKh95ntJ5n9CPiCd4FGusjz6gVmhhV5r7X4Zva7pFaEEaRM81Dp9q1Q34kn15NdUVVcoRFZCnTCRzVVsvrVDd`, `2yBaWGk5oSmpaGJ1kK19q48hzT5z9iuVQej26gEieRyHsVGiQ6h4cU1JN5uGPxHYS32y9ge7AtALZeffS771aUZG` |
| 19:01, 19:11 | 10-06 deferred `TwapDeviation` while the TWAP trades were still moving the pool (and two 0.002 SOL buys at 19:09 pushed it further) | — |
| **19:22 (pool quiet ≥ 10 min)** | **10-06 burned** — spent 1,424,941 lamports, got and burned 1,283,876.587878 $PCRA on the pair pool — **`2vP8pqb1oYWMnGonNLhhCm65RfZiDEG6EGGuXHsJRQXuP1NNS9KSCejqWSUmb3ZH8kMkW1QeS3REgrvuzRJqMUNu`**; 10-07 below floor `58h3RdwkGPAJxrrYDTtWJFb3yRVs3Z7PtAGQ9Hp7ofHx5q7GfavGEMQyuE7cv8ujHsuetkSuxieNkSCdYuFCtvMj`; 10-08 deferred `TwapDeviation` (the 10-06 crank's own 1.6 % impact on a 0.089 SOL pool; retried by the keeper) | — |
| receipt | 10-06 `verified: true`; memo `PCRA|2026-10-06|…|pool=6904257|spent=1424941|…|swap=cix9ZfHG9Q6U|rules=sha256:f11a515f8187|v2` | three `skipped` (below floor) receipts, memo `…|swap=none|…` |

The burn pools hold only the curve fees' 75 bps (released at graduation) plus the 0.02 SOL reserves and residue, and rehearsal pools
are 0.05–0.09 SOL deep: side B's pool cannot clear the 0.001 SOL floor at all, and side A's one burn moves its pool by 1.6 %. That is
the rule working at toy size, not a defect; the first rehearsal (above) burned on both sides with twice the pool depth.

## R2-P4 — pair 4 ($PCXA vs $PCXB): pre-created vault account, void, pro-rata redemption, dust burn, close (18:40–18:51)

Same parameters, deadline +8 minutes (18:49:00). **Pair `8XGyJ9b3C5pjMQdXEKa7fJKzQWKwNu4GEm5LEtHPcZe3`**, vault
`9aeTyFg37NSYzdNn9vSmmatjmkRZcSw9L9emQBL3t7zc`.

| step | signature | result |
|---|---|---|
| mint A + config | `2TPk6w64dBZF6zeRQamsZErJ13dziR6DuKNtt27WDMB2kTifUbthgWndEmhEomW7kNEPMvcie6z2LU8fMSu3uBCU` | |
| mint B + config **+ the payer creates the vault's token account for mint A** (`--pre-create-vault-ata`, R2 H-3) | `26Qn8w9qu7CbXHrJH83DRU98swvgiPUe6MFHYGvpJDh9QcfiM22u2QuUrV48rBxuEigR4Esjk9fExKeJJXhznUHC` | 1,020 B |
| **`init_pair` over the pre-created account** (the first version failed here forever) | **`52bM6PEYafmmqvfGVQZVw8rfE2azCrQx5f1xGooWpvhHZBT8nRDYRVorjFX6QD7mNSDx5Uof1VobiUKTs4skT7eH`** | 112,479 CU |
| buy A 0.02 (payer) / buy B 0.03 (payer) / buy A 0.015 (keeper) | `Gnz2VHW2MmLBcLkjF9MmN3wEuhXMoKGT3MjYbhhYmfpd2bGwEcDiWaoV3n1WyYo7X13xdte3atBxjN99HUcPfPz`, `3wLpMSs5s9VKDj7rVQhKgYaBa55mvxftKyXHe7ZJLgWv1eRDphgpfDGcHcLs8nGSahEqYV3r4mBtpvkfT6KoWqwe`, `5T62eREtTa2WHwxJSyteXtGoTGnj3EPoLaQB3whcymKAnp1jUw28xbNq3QEQhsVdLXpPfRYjUQneixzARMwPRg8S` | vault 65,650,240 = rent + curves 64,356,438 + fees 643,562 |
| `void_pair` before the deadline (simulated) → `DeadlineNotReached`; buy after the deadline (simulated) → `DeadlinePassed` | — | |
| **`void_pair`** (keeper, 18:49) | **`5zQoeEcnKTxM793Wawk9YLo1qpQr2Cp1BFHxDgJRj4dKWqJEJoZkwinxoUJ2fx3GyU1QmL3ZrrvwAcVq3EjdZtmj`** | 20,150 CU; redemption pools A 34,913,368 (= curve 34,653,467 + escrow 259,901), B 29,925,743 (= 29,702,971 + 222,772) |
| buy after the void → `NotOpen`; `close_pair` while tokens circulate → `NotClosable` (simulated) | — | |
| the payer burns **one raw unit** of $PCXA (R2 L-1) | `3zBiM3pqmT8HQvx32f6mMyFACyHFYZoLAhZJmYK4XvN4x1VX6jHL65oXJ3hf8YfFEdyDuUbvXXnNrux8tHhaZf5z` | |
| redeem all B (payer) — the only B holder | `25EoVE5qa5xLoUK8CfRb1AmRBBoQq9oXtrf6FANZ4HwNMbruP2Zukqz4PMPMem6Pskgmw7WKWaepthNkbMrLM2qE` | received 29,925,743 = B's whole redemption pool, no fee |
| redeem all A (keeper, 40.20 % of A) | `4qZmzRG6bdNUsSLv2fb5jG4FeQUvoD8PV43F9Uuxj6ijnigziKQVn4CwKKBJWV1vkNSjrzGxoC2K56oZToja1pRd` | received 14,036,378 = floor(44,669,841,200,994 × 34,913,368 / 111,109,472,208,157) |
| redeem all A (payer, holding all but the burned unit) | `5btGC4BuGmfvMsEWCRFmra9jDxNeAf9FFcoMBKwoS3ZruqeJLXTT3rms1PQPHTvdtLfXkPagdKRBbVH5a3pGcdAZ` | received 20,876,989; A left at sold 1 / sol 1 (the burned unit); vault 811,130 = rent + accrual 160,889 + 1 |
| **`close_pair`** (keeper) | **`yz16UprnRW4seW9PQ5WVrVtZyB2mZSWfmJheCyapiLNWPthg3pLp1PwiscoiLGcUz7czhhbVzgJ6cJGUCv7s6kB`** | 33,771 CU; Pair closed; both supplies burned (0 / 0); developer wallet +160,889; creator +8,432,800 (Pair and both token-vault rents, including the pre-created account's); vault 650,240 = rent; the 1-lamport residue to the burn pools |

## R2 checkpoints

| | checkpoint | verdict | evidence |
|---|---|---|---|
| R2-1 | pair_curve upgraded through the vault with the hardened script; its four refusals fire; deployed bytes = the devnet build of `fa8627a4` | **PASS** | `27ZQn9AT…`, `r2-squads-*.{log,json}`, dump sha256 `1ab6b1c9…` |
| R2-2 | a pre-created vault token account does not block `init_pair` (R2 H-3) | **PASS** | `26Qn8w9q…`, `52bM6PEY…` |
| R2-3 | the trade that meets the condition commits the pair; later sells and buys are refused (R2 L-2) | **PASS** | `4mkLixEZ…`, `r2-pair3-*-after-commit-dry.json` |
| R2-4 | a pre-funded WSOL pool vault does not block graduation; the excess joins the pool (R2 H-1) | **PASS** | `56ateEY6…`, `46uhtuzd…` |
| R2-5 | graduate and register in separate transactions; both pools registered (R2 L-3) | **PASS** | `46uhtuzd…`, `hB6baNZk…`, `53Hgvikh…`, `4eU4HWhD…` |
| R2-6 | trades pay nobody but the vault; the developer share is claimed permissionlessly and exactly once (R1 H-2) | **PASS** | vault balances in `r2-pair3-trade-*`, `1UCWQfb8…` |
| R2-7 | the keeper seeds the first oracle observation of never-traded pools (R2 L-4) | **PASS** | `3BJ9y9fN…`, `3Z8PWYGq…` |
| R2-8 | one burn_receipts crank per side on the pair pools, receipts posted | **PASS** (A burned; B cranked below the rule's floor — the pool is too small to spend) | `2vP8pqb1…`, `52YTyu22…`; `r2-pcr{a,b}-burns.json` |
| R2-9 | void → fee-free pro-rata redemption, order-independent; a burned raw unit does not block `close_pair`; close pays the accrual (R2 M-1, L-1) | **PASS** | `5zQoeEcn…`, three redemptions, `3zBiM3pq…`, `yz16Uprn…` |

## R2 SOL spent (devnet)

Start (18:30) 3.167 SOL across deployer / payer / keeper / squads-a / squads-b / devfee; end (19:25) 2.385 → **≈ 0.78 SOL spent**: 0.105
program extension (20,600 B), ≈ 0.51 into pair 3's curves (0.142 now in the two pools, 0.30 to Raydium's create-pool fee, the rest
burn-pool fees and rents), ≈ 0.12 rents and burn-pool reserves (four mints, four TokenConfigs, fee-PDA reserves 4 × 0.02, Pair 3,
reading accounts), the 0.0025 pre-fund, ≈ 0.02 transaction fees and TWAP trades. Pair 4's Pair and token-vault rents came back to the
creator at close; the ≈ 1.857 SOL upgrade buffer came back to squads-a.
