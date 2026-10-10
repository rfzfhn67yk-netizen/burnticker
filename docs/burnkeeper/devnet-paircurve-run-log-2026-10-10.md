# Devnet rehearsal run log — pair_curve, 2026-10-10 (Saturday evening)

Run by Claude (agent) on the Mac, worktree `mct-wt-PAIRCURVE`, branch `burnticker/pair-curve`. Devnet only: every command carried
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
