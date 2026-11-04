# Devnet run log — pair-forward round 3, 2026-10-11 13:15 → 18:02 Denver

Run by Claude (agent) on the Mac, worktree `mct-wt-LPLOCK`, branch `burnticker/pair-forward-r3`. Devnet only (genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`); throwaway devnet keys in `~/.config/meme-coin-trader/devnet/`. The keeper key
`D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn` is the one attester (quorum 1) of every coin here. Evidence:
`docs/burnkeeper/evidence/devnet-pair-forward-r3/`. Explorer: `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

## U — both programs upgraded through the Squads vault (source a3a968e5; devnet bytes identical at bc056558)

burn_receipts program data extended by 20,480 bytes first: `2MYn6KNwRrk8WchnSHPAYU3wnGGqrj7EAbodD6uegytxkZP3M4SMaeLjCNgQQs8YpFriBYN7fdbiV18AZoQphnMX`.
Buffers `Ac8H87RGdRw3zknmY4XUduSae6iEBFzAvAAp8qcFbGQM` (burn_receipts) and `GrftFP6FkHq7rxW6MXpDzk9yF1DQriETPMxP1FnfxgDa` (pair_curve),
authority handed to the vault; dry runs (`dry-br.json`, `dry-pc.json`) matched the table and the local build.

| vault tx | program | proposal | approvals (squads-a, squads-b) | execute |
|---|---|---|---|---|
| 17 | burn_receipts | `3X45kZiF35MxCuPQCk9hRXgXdDcPNkKWakAWbzD3xMZqttU12Wd6XzW1PwySr653pzqpgKXFfutmnoYGWGgHtKqA` | `582PrS6oYRSpMvwBCbv6xZKBXD8CEjQSrbsFEf97Ngs3B2wSTMhQETUf7rTkMz6ymwgNpBbqrWTzMX6xPEfd9YYX`, `4VN7SoJaJKbjTahPSwpmC24L2y3Rm4Pvto3FZiYAF7BYdMK7mkuWerg9vdpNYTakQcZ31M4aHgYctCpspn6R5jzr` | `2CfxBP4Hd5FPwNcPLHxpTLBoRXHR4RnGRuzXjGNC9pzpmHL1QeCAgTQtvgDreoviBrDyXz9yXgYsEpM3tMgHNVgW` |
| 18 | pair_curve | `gbFuWRwFwshdD4PeYH9FrCapKyKQpAuAWiyWW8GKYDMeg6ACwbYpqrTew3ys6ZE6bPKbDKmbSupPwAPXQJdqFks` | `4sBxarej68xqDUVevZcZzxyraDxL3jhcyBRV5KxNij1rKcEEBuuZ52obnhx75gaUcFMqaMQvg5h6wDhqa2UiPC4g`, `Xvggno8K7ozZuXjKAdbs7ppR6esCmVXsweM48uZxqNh2193EL5mmg7QxyBF7qqpEQwGSL6e5KFwaaP8BPvnSiJS` | `3oeaphznm9D1GyXHMGJuCFf9VnTGWXZfKgMmYoTA1BrWE4FxNFQ7kdut6z5RdGE3v1wqTFjhGNoAGVxmR7U1jLQr` |

`verified-build.sh --onchain devnet`: MATCH, burn_receipts `90bd47e6…4b35`, pair_curve `ae947d59…bf42` (`onchain-verify.log`). Spill
rent returned to the payer: `vVMrMTr5CVRz38Mx5hSdeB4DpaW5h1DwmG5KcZMmoMoDCW4H83Y3umaQ6EHKE56SSzJqkpyeyBr7vSWddK8mt6d`.

## P8 — an Open pair: read before link, linked, never unlinked (RN-1 / RN-2)

Pair 8 `7GYFPpKqHP5hJp4Vu2K1Ys8RRggdY12XREhoK9kXajmq`, 60-day curve, coins `CGp4Qa9wrBD3MfJfPafpxaWiSSwtu8XHwLGbxXg6FboA` /
`H3KnEmyvaWFuQofo5ZmkcuPHefMCnhYjzXFVHB7PZLCy` (rules `config/burnkeeper/paircurve-devnet-8{a,b}.rules.json`; tickers PCVA/PCVB reuse
pair 2's, devnet only, different mints). Init: `4fWWNXjaJaYTgW4L8h3c2pQbBH13Rgvb6mb4TpaiafSVrwYkv1BWeLF541Wz8GxTd182ce9xBwsfxTehYv8S863M`,
`SM3Jj7kpUxD6KPPexUAxv9ro9RN6K5bZ6nmw7QVpy5uSrghA9fUFsiP6mLJy8sm4XmL2C2WAtBEygNJ1oVdXuNE`, init_pair
`Rzw4GZEEQs5y5VskgqMtUS3yAoft6rjCZe7eYnGGRsssx61C6WRYiuZVMDfshDnobeX46VtfZrgRiBSvNhzJ8Tm`.

| step | file | result |
|---|---|---|
| coin A reads 2026-10-11 BEFORE link_pair | `pair8-reading-A-20261011-before-link.json` | sent |
| link_pair after that reading (r2 refused: PairHasReadings) | `pair8-link-pair-after-reading.json` | sent; both PAIRED, `pair_after_date` 20261011 (`pair8-pair-status-*.json`) |
| a result for the period read before the link | `pair8-result-20261011-unpaired-refused-dry.json` | refused 6099 PairPeriodUnpaired |
| unlink_pair without evidence | `pair8-unlink-no-evidence-refused-dry.json` | refused 6093 PairStillLive |
| unlink_pair with the Open Pair | `pair8-unlink-open-pair-refused-dry.json` | refused 6093 PairStillLive |

There is no time-based unlink evidence any more, so an Open pair is refused at any age; "day 30" needs no clock. Re-link after unlink:
pair 7 (unlinked in round 2 on Voided evidence) — link_pair refused 6098 PairTerminal (`pair7-relink-after-unlink-refused-dry.json`).

## P6 — the pair-6 forward on the round-3 program, period 2026-10-12 (UTC), 18:00–18:02 Denver

| step | signature | result |
|---|---|---|
| B reads 2026-10-12 (11 units) | `X8X2qJPDYTkSzR6dMtnQRgc4id5B3qHTACEaWH8tS1vJMxyqrXxGUpXqdET3b5j29LmssHiVGuAh5E81KxUi2qC` | ok |
| win for A before A has read (dry) | — | refused 6090 PairResultNotServable |
| A reads 2026-10-12 (3 units) | `2m4qyXomyDrfEFPMWz8GoByhPLitDqrDsemkXuSSyCBiyRvRxuTntKLJYmZy7EAfPfCUCNKoYiT1kM6QZwn4Bx5A` | ok |
| result: A wins (one common-set signature) | `pnqsynZbBpe5nwSa9uvezwhwnxE5MR5Pz9fcyqAvTdNwKrXbMC3TNqsE8qGkbMZnvM2JJM1PNFR93F7yXY3suSw` | ok |
| B's crank plans and sends the forward | `2NX8e73qYpjQJdDyrDjepEji8qQBuN9U1esf6faaeC67txcF8v3fxfzSzMyjViSTPGvqYm3K3gEThfSPvdfd2MCN` | memo `PCLB|forward|from=6jxEWF78rtBs|to=7dNGQuvijwxF|period=2026-10-12|lamports=44549246|v1` |
| A's crank burns | `qcDG2BD66Ywv3v2TdDwBkjKx2t8o4JYB3wyMojF3RSp25SuH1r56dTnk38p5TXmgAmaQounpm3c7pPmMNVynXj2` | units 3, spent 1,804,270, burned 2,579,448.694185 $PCLA |
| B's crank | — | idle (`pair6-crank-B-idle.json`) |

Launch-gate smoke test: `verify-platform-pins --cluster devnet --mint CxX5PH8A…` exit 0 (`verify-platform-pins-devnet-lplock.json`).
