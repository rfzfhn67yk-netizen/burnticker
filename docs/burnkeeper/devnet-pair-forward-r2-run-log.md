# Devnet run log — pair-forward round 2 (blind-review fixes), 2026-10-11 11:25–11:58 Denver

Run by Claude (agent) on the Mac, worktree `mct-wt-LPLOCK`, branch `burnticker/pair-forward-r2`. Devnet only: every CLI checks the
RPC's genesis hash, `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Keys are the throwaway devnet keys in
`~/.config/meme-coin-trader/devnet/`. Evidence: `docs/burnkeeper/evidence/devnet-pair-forward-r2/` (committed in round 3, re-check
RI-3; the files are the CLI outputs exactly as written that afternoon). Explorer: `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

## U — two upgrades of both programs through the Squads vault

Round 2 shipped twice within the hour: first at source `bfe3bfd6`, then at `6fc15f00` (a win is servable without the pools, the
servability change). Each proposal was dry-run first (`dry-br*.json`, `dry-pc*.json`: buffer, table and local build agreed); the
hashes are the VERIFIED-BUILD.md rows of each source. Multisig `GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w`, vault
`A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD`, 60 s time lock, spill = squads-a.

| vault tx | program | buffer | proposal | approvals (squads-a, squads-b) | execute |
|---|---|---|---|---|---|
| 13 | burn_receipts (`bfe3bfd6`) | `9ScFTQ8JdvhKZ7zjpEVLyQ8GyU7erN9UooU2Xqi7MYFm` | `4dkiWUj7ateSAr6BNQPEp8qweGe4t4J5MYQnqNLoMVrRigcWGzLb92Yv4Tt2nm77SNi3HzFoFSsQHeYNvfYaJSGD` | `xeFxje1QhLu76UTBsyZLk8AwXXJHdfi67VtdaucpPNpPscuYhqvipQsDtD9S5GsmRdhpoHqDC69UppLQ8AbX31K`, `48Mn93wAzk2GAMmAhyxBpEEJHrwEkDbGUSoCsmT1RXZYxqPUMbmiWTf8Zyb7j3YtaUVjkMZ5dhibPexLGPVexs89` | `5EzPTeqekS56uUW2Xcwqs5XQNmFdABavqUPUubuxTYcx957QkWHqrJxiBrb6VtZonfGCVC3NhE6TKVWEVxtQ9E4q` |
| 14 | pair_curve (`bfe3bfd6`) | `5Q54LQyborbFNisVj9HyDhzWwExJjtic7ookVZadAbpA` | `3vYT2sRTP6e2VKYYLC6KyvLg2nBtdzT6S1pbtmAhAjFm82xVJiYthjXbSGuAVQjwknmFTuy4jKwon1BBiipe6odw` | `5mTZ1PCs5zpPXJLmJhDepsxcckHowk9BtAWFpvmxLJw1Q2bmsPm5ActQcmiJXHLoNpMumiwUZQHiuh2qDXsnYdjF`, `64aG5SYsfKFBqcf4urnw4UjY9xLSWXMua6YJVghYx3VpPBmykJrw9mMEEzRdsNwHvU5A7BNzrrAUTsa6hTc5CfwW` | `5chbpMY9yFWrM5NXM7rHF8oP2VLLeZ1psdoMogvjHeacH2E1P1guhkutVrsXvd4S4ZLiPMwJygVtpoG5f2GAFYUk` |
| 15 | burn_receipts (`6fc15f00`) | `HkSsJCUr8CPn4jZsmZweR5GJoKaT2TzJAgGJhQjhfS8v` | `3tJBa19UnWaRfMKDk6E2z2g5CB1KnR18dtrSMQoVsWBwtfv6ChkuJh5FS6zvcPxtETGjRJKMdNAvTCvSmJRnLCo4` | `BRqVJxATHzFM8S1gNN7sqB8YyFtSeFMGBEfJMNKS5F26SKFiq5WCpqCQ5JD75jvYEMisVdkcwYXguuwZmZ52oEw`, `2fVZumnczQsoHgu4oiUnYwRphFxUJMvaJGhTCHASJGAzZynHV8sCk2Yo8xqP5F5S6Z5UEJB4hPvXK8Ujw2nXJyKr` | `2mHDh6hqzyQ4C62JTSPabUUZLFWSKdakB37orT3GyM7vW6igPQ2nd6w4TwyEAtAodzoK6YfvyQ2F7qLQkpsuiJ32` |
| 16 | pair_curve (`6fc15f00`) | `fRA7xYPH1Ss8RxkUdeYXz2QBgtuXSxpvkoJS4Uhu44c` | `cUwU1mur43R5LEqCRTX4oEKFiBhMsa4HFnDW1N9igt85JTkpVs2thgxiDoz6kAST1PUHLDAbAD3H5DCuw7htYqS` | `3QWsQstePNyQ5hm56WNCZksMwJmju6pP2LgB1HdnWdWswN6R18w2LogRexYkBZqLvYRDofwnhhtc44FtorUeHuu6`, `Dp4KDMeBocZFBhyR9vXjmND11CttfKrGDwQBktjjGWa8UGLvgXYbKnYfb7vjofKi4TJJmXeiUnnGUCvt9pjkyJT` | `BD3A35pn4s7cELuhBpvB31MoDAGQxK9gJd4c1jgQW3AQw246yfZzxTTS2bUVvuRPo9X3zPk3NPjHWNJDvDTscq7` |

After tx 16, `verified-build.sh --onchain devnet` reported MATCH: burn_receipts devnet
`5a2d16004ec70c6cbcc1e3f9877b9784b141d8717f5b5e23bbba57fb4d62bf87`, pair_curve devnet
`96b8d79cd46bd6b0d8d6069656f1ab2fdddca47b82e6e2e1e6607dff6e4ef178` (the VERIFIED-BUILD.md table at `6fc15f00`). The tx 13 / 14 hashes
are in its history paragraph. The spill rent came back to squads-a and was returned to the payer:
`5uSGJRZ6G9SqReerGrnJrMWyJ7CngaKksDsBkymJAZr4WsPdUs7voSGrifMdrLBvGjFEWhKgWHLdLXZPiHFbHLC` (after 13/14),
`3iWNZW68982nbzYATFhVi8aLL9Knm8FiwibpMat4PFoxE4PqWNy8no9NWmeE7TLnzsPbj2U5MPUtdPrP7VbLUyGZ` (after 15/16).

## P6 — pair 6 against the round-2 program (dry runs: simulations, nothing sent)

Pair 6 (`CUVutu3wjP74ic1RxVhgHYevAmrCLgq6aAd3d9gNLWYi`; A `7dNGQuvijwxFBw6PXUHnw2mfmTuRd2KmV6nBGrFxXb2T`, B
`6jxEWF78rtBsMCA44FYaCG4nFUjk4S15e4wAKKjgMzmN`), linked and forwarded in the morning run (devnet-pair-forward-run-log-2026-10-11.md):

| file | what | result |
|---|---|---|
| `pair6-link-pair-idempotent-dry.json` | link_pair again | ok (idempotent no-op) |
| `pair6-repeat-result-20261011-noop-dry.json` | the 2026-10-11 result again, signed | ok (no-op after the signature check, I-2) |
| `pair6-result-before-pairing-refused-dry.json` | a result dated before the pairing day | refused 6091 PairDateBeforePairing (L-2) |
| `pair6-unlink-refused-both-live-dry.json` | unlink_pair with both pools verified | refused 6093 PairStillLive |

## P7 — pair 7: init → link → unlink refused → void → unlink on the Voided evidence

Pair 7 exists only to exercise unlink_pair on real evidence. Coins $PCUA `BNGzZPs8aBuqE53o4yGQ6ZzXUxvvGRzVbcZZrLUKbvnS` / $PCUB
`2JL9MaSpsPw7B2L1Hj8gmRxiS41Rno1RN4eo4qpyMDQh` (`config/burnkeeper/paircurve-devnet-7{a,b}.rules.json`).

| step | signature | result |
|---|---|---|
| first init attempt, `--deadline-secs 60` (`pair7-init-attempt1-deadline-too-short.json`) | mints + configs `2hauQ5JKvM1XvJPH8nExuJ3VAyTPAYAQhaqsGRmXL5UsbYvc5ZX9ddyLGptSR1vL2nDSe4m38fh2ZsJZMwkxc5UM`, `2dTM65neDW2FvJfp81TCw8P3HLpovThGrTDx61onLeqgWS5H9SUx4v9Bn8QRwzK6rU5Kwu2YTyi5dMNyy2MLyQR` | init_pair refused `InvalidParams` with the 60 s deadline; those two mints are orphans |
| init with fresh mints, 150 s deadline (`pair7-init.json`) | `2vhess4GJLDvZ8acz9kMCBrqC8gSmuD6ANEM9d22yhFLE9SKvHCMpc5XZSNY9eTnZ2gyNMGT5Gzto8T8c1NBMa5c`, `2YmKoHNFu6fmu4Qrmb1re8yq658GG9qZNTipyuZXR34D9wuwkpwFqULKQc1FtWh1N7HQ7PUnighG2C3wgL3nhoTV`, init_pair `4qMWFcFxMWjF1Kkoubt714Npp2RNzL6bW37yThjGAVjRtQzj4Crije8VRQKPTJP2RyZXn69c9HPKj5hwwiWbJoLK` | Pair `JBV62vGicfGNpCqvEFLgDjdbh2PoJyJKMUgye5swtN9q`, Open |
| link_pair (`pair7-link-pair.json`) | `2hBp1LxMYDtLPsJ2XrsvsRdUXyfsgjAf6Mo5poZLKTh1KxqvWpXkfMjaiTdMLrWZyJWT1HuXnHeg53qgHPbjC5ZT` | both PAIRED |
| unlink before the void (`pair7-unlink-before-void-refused-dry.json`) | — (simulation) | refused 6093 PairStillLive |
| void_pair after the deadline (`pair7-void.json`) | `HLrRAnf8nFfzRfwzaxAz73M7N7XPpU23ZYrvxHLTvZEqaSFjcani3p7pgZBh8dJbcvyHo3dNd3WMHWCDhBnXeEY` | Voided |
| unlink_pair with the Pair (`pair7-unlink-pair.json`) | `4qE1SQWgTKWEZHfEyJyCHQK3yPRfr8bEnE6GyhZBGBb9u6oytwFjb8ErN2YWfr6v5KQCLe8z3QU5z534a3mY3N2W` | PairUnlinked reason 0 (Voided); both PairLinks closed to the fee PDAs |

The pair-6 forward re-run for the next period (2026-10-12 UTC) was scheduled after this run and stopped when the re-check arrived;
round 3 runs it against the round-3 program (docs/burnkeeper/devnet-pair-forward-r3-run-log.md).
