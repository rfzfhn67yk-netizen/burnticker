# External burn targets: where the liquidity is, and the AMM v4 decision (2026-10-13)

Follow-up to EXTERNAL-BURN.md after the coordinator's mainnet read (BONK and WIF have no usable CPMM pool). Read-only measurement, nothing
signed or sent.

## 1. Deepest SOL pool per venue (mainnet, 2026-10-13)

Source: DexScreener `token-pairs/v1/solana/<mint>` (pools, TVL, SOL side) and the public mainnet RPC (owner program of each pool; fees read
from the pool or its config: AMM v4 `swapFeeNumerator/Denominator` @176/@184, CPMM AmmConfig trade fee + creator fee when on, Whirlpool
`fee_rate` @45). Meteora and Raydium CLMM fees are tiered or dynamic and were not decoded. Only {token, WSOL} pools; the deepest one per
program. "SOL side" is the pool's WSOL reserve; the round-5 floor is 50 SOL.

| token | venue | deepest SOL pool | TVL USD | SOL side | fee |
|---|---|---|---|---|---|
| WIF | Raydium AMM v4 | `EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx` | 5,885,542 | 27,631 | 0.25% |
| WIF | Orca Whirlpool | `D6NdKrKNQPmRZCCnG1GqXtF7MMoHB7qR6GU5TkG59Qz1` | 156,224 | 317 | 0.04% |
| WIF | Raydium CLMM | `4mMDQ5kG9fFrBSQeedErsUoTBhY5KKnsKWGvenXRTwSy` | 8,214 | 44 | tier |
| WIF | Meteora DLMM | `8Ve9KtGNtLRxCQNAVfkHEP5GRZHjdj6BjB1RQFZewG6V` | 6,971 | 28 | dynamic |
| WIF | Raydium CPMM | `FSYNx6cdFajxDJswDg38bJ2tU3AMZ4eo64LRhSouuCj3` | 330 | 2 | 0.5% |
| BONK | Orca Whirlpool | `5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9` | 348,440 | 899 | 0.05% |
| BONK | Meteora DLMM | `AtcGozT6i1GR3wJAjVwRwmt7qbHqZrBUqKs2DcMAKoVe` | 198,097 | 253 | dynamic |
| BONK | Raydium CLMM | `GtKKKs3yaPdHbQd2aZS4SfWhy8zQ988BJGnKNndLxYsN` | 35,880 | 132 | tier |
| BONK | Meteora DAMM v1 | `278P6iwdEeX5tUFMGxmi2tii3EAho4iHzfiroKLKCQKj` | 22,772 | 107 | dynamic |
| BONK | Raydium AMM v4 | `HVNwzt7Pxfu76KHCMQPTLuTCLTm6WnQ1esLv4eizseSv` | 18,622 | 87 | 0.25% |
| BONK | Raydium CPMM | `DTPk5qoWmAsDnoRtRejaj7p5ZHUf7JP4JdvXNwTbdP2B` | 90 | 0 | 0.3% |
| POPCAT | Raydium AMM v4 | `FRhB8L7Y9Qq41qZXYLtC2nw8An1RJfLLxRF2x9RwLLMo` | 3,574,432 | 16,783 | 0.25% |
| POPCAT | Meteora DLMM | `GJCD53zyMypX3xuP7Y1vaTmQEnY99HfJgz5kSwNJnkkB` | 9,573 | 83 | dynamic |
| POPCAT | Orca Whirlpool | `AHTTzwf3GmVMJdxWM8v2MSxyjZj8rQR6hyAC3g9477Yj` | 16,783 | 17 | 0.05% |
| POPCAT | Raydium CPMM | `3WYho5XjXfAzGsXdwdkFHw84rH6kCGCQnSYg6wHqypQo` | 182 | 1 | 0.25% |
| PENGU | Orca Whirlpool | `FAqh648xeeaTqL7du49sztp9nfj5PjRQrfvaMccyd9cz` | 3,496,828 | 11,486 | 0.3% |
| PENGU | PumpSwap | `9qKxzRejsV6Bp2zkefXWCbGvg61c3hHei7ShXJ4FythA` | 1,456,823 | 6,850 | tiered |
| PENGU | Meteora DLMM | `A3N64gxHQL8b2cQ75JM3nVqoRFYWmntaEUFfDmhYe1Nv` | 76,673 | 146 | dynamic |
| PENGU | Raydium CPMM | `Ha4SGpJP9mBNcmvYDFCJD7bGbmHTx6mpzcC9XuqsikHJ` | 17,517 | 82 | 1% |
| PENGU | Raydium CLMM | `4r2AGQRjuLpGL9o1vuW1mkcVHvE4DTi7YZJhqGHj2qeR` | 36,954 | 66 | tier |
| FARTCOIN | Raydium AMM v4 | `Bzc9NZfMqkXR6fz1DBph7BDf9BroyEf6pnzESP7v5iiw` | 7,948,910 | 37,319 | 0.25% |
| FARTCOIN | Orca Whirlpool | `Tuy6gMupGQN7wCZ8rVP1EuLRYB132VSo9Smy4AJvQgn` | 1,109,601 | 2,109 | 0.16% |
| FARTCOIN | Meteora DLMM | `6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA` | 138,307 | 149 | dynamic |
| FARTCOIN | Raydium CPMM | `6rmm9FDkWmnQ4tdXSvQNdJrZxnuNywBLYoNf1UXpwRFm` | 1,089 | 5 | 0.5% |
| MEW | Raydium AMM v4 | `879F697iuDJGMevRkRcnW21fcXiAeLJK1ffsw2ATebce` | 9,148,096 | 43,117 | 0.25% |
| MEW | Meteora DAMM v1 | `8thu7Di1C2QgBrtGkL4favcJtKPQUUuiseodpyfZjq9e` | 29,676 | 143 | dynamic |
| TRUMP | Orca Whirlpool | `Ckp1kwZqosaLU1h3zWtuaMBubyWM7LX3cxYezRVin7p2` | 237,840 | 508 | 0.05% |
| TRUMP | Raydium CLMM | `GQsPr4RJk9AZkkfWHud7v4MtotcxhaYzZHdsPCg9vNvW` | 65,933 | 69 | tier |
| TRUMP | Raydium CPMM | `HKuJrP5tYQLbEUdjKwjgnHs2957QKjR2iWhJKTtMa1xs` | 4,066 | 19 | 0.25% |
| TRUMP | Raydium AMM v4 | `uCk125EJf7iCjz43aSdzuyMAT5eii6c5zKVxEnGnosa` | 2,659 | 12 | 0.25% |

Reading: no CPMM pool of these seven passes the 50 SOL floor except PENGU's (82 SOL, 1 % fee, at the bound). AMM v4 would admit WIF,
POPCAT, FARTCOIN, MEW and (thinly, 87 SOL) BONK. BONK, PENGU and TRUMP are really Orca Whirlpool coins. (Full output of the script
also lists small PumpSwap / unknown-program pools.)

## 2. AMM v4 as a second target-pool kind: built (round 5 proper, after the coordinator's go)

The first answer was "not by just adding a swap", for four reasons; each is now handled (EXTERNAL-BURN.md has the design):

1. **No manipulation-resistant price on AMM v4** (no observation ring; any reference recorded from the pool can be forged with a Jito
   bundle: push, record, push back; on WIF's pool a 10 % push costs about 7 SOL per forged point, which pays once the 25 SOL cap sunsets and
   a crank can spend 2 % of the reserve). → **Pyth** is the price guard for both pool kinds: Full-verification PriceUpdateV2 accounts,
   feed pinned at pin time, ≤ 60 s, confidence ≤ 1 %, pool spot within the rule's deviation of the Pyth ratio (two-sided), min-out from
   Pyth. The LiteSVM suite runs push / crank / push back against the real raydium-amm program: refused.
2. **Reserves are not just the vaults.** → only swap-only pools (status 6) are admitted; reserves = vault − need_take_pnl (the program's
   own `calc_total_without_take_pnl_no_orderbook`).
3. **The swap path.** → `swap_base_in_v2` (instruction 16, 8 accounts, no market accounts), confirmed live on mainnet 2026-10-13: 22 of 22
   AMM v4 instructions in the last 40 transactions on WIF's pool were tag 16 (8 accounts; example
   `Eep7sZM7PK6g…` (a transaction signature, shortened), slot 456446693). Live mainnet AmmInfo
   (WIF, POPCAT, BONK, MEW, FARTCOIN): 752 bytes, status 6, nonce 254, swap fee 25/10000, offsets as read from source.
4. **A fixture.** → raydium-amm built from source at d26944bfb76fb5fa8f91e5d440c2050ed358ef81
   (`programs/burn-receipts/scripts/build-amm-v4-fixture.sh` → `fixtures/raydium_amm.so`), loaded at the mainnet id, with a
   harness-written swap-only AmmInfo and real token-account vaults.

Pyth sponsored feeds on mainnet (push oracle pythWSnswVUd…, shard 0), read 2026-10-13: SOL `7UVimffx…` 17 s, WIF `6B23K3tk…` 56 s,
BONK `DBE3N8uN…` 39 s, FARTCOIN `2t8eUbYK…` 56 s, MEW `EF6U755B…` 17 s, TRUMP `9vNb2tQo…` 17 s, all Full; POPCAT `6UxPR2nX…` and PENGU
`27zzC5wX…` about 55 days stale (those two need a keeper-posted update, not built).

## 3. Orca Whirlpool and Meteora: not this round; what each would need

- **Orca Whirlpool** (BONK, PENGU, TRUMP's deepest): concentrated liquidity. The swap needs the whirlpool, both vaults, three tick-array
  accounts chosen from the current tick (they change as the price moves, so they cannot be pinned; they must be derived and checked
  in-program), and the oracle account. Reserves cannot be read from vaults: the 2 % cap must be expressed as a price-impact bound via
  `sqrt_price_limit`, and the guard needs Pyth (Whirlpool's oracle account is not a TWAP). Fee tiers per pool (0.04–1 %).
- **Meteora DLMM:** bin-based; swap needs the lb_pair, reserves, bin-array accounts around the active bin (moving), the oracle (bin
  history, not a usable TWAP) and an event authority. Same issues as Orca: no vault-reserve cap, Pyth guard, dynamic fee (base + variable
  fee that rises with volatility; the ≤ 1 % bound must be checked on the live fee at crank time).
- **Meteora DAMM v1/v2:** constant product (closer to CPMM). v2 has a fee scheduler and dynamic fee; v1 routes through vault programs.
  Reserves from vaults are feasible; still no on-chain TWAP, so Pyth again.

Common to all three: the Pyth guard is now built (round 5) and would be reused; each still needs its own reader and swap CPI, a price-limit form of the 2 % cap, and its own fixture.
