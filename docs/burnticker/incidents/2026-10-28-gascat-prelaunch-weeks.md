# Postmortem: 22 $GASCAT results from before the launch were attested on chain

| | |
|---|---|
| Incident date (UTC) | 2026-10-28 06:18 |
| Known since (UTC / Denver) | 2026-10-28 13:45 / 2026-10-28 07:45 |
| Postmortem published | 2026-10-29 |
| Category (INCIDENTS.md) | 1 wrong burn (pending: the units burn at graduation) · 3 audit red |
| Status | mitigated |
| Coins affected | $GASCAT (mint 2L3bZbzkYgJ4eU64ed7YvchrxEnzQXQt2gvxq1CLburn) |

## What happened

Gas Cat burns part of its pool for every nickel the weekly US gasoline figure moves, and only for weeks after its launch. The keeper did not understand weekly periods. On its first read of the feed for the coin it recorded 44 weeks from January to October 2026 as results, 22 of them with units, and then failed on the first of them every cycle for seven hours. The fix for the periods went live with publish 131, but the 22 receipts were already in the registry as planned, and the first cycle on the fixed code attested their 53 units on chain in one reading. The program keeps them. The keeper should have recorded nothing for those weeks, and when it had, it should have refused to attest them.

## Impact

- Receipts affected: $GASCAT 2026-W10, W11, W12, W13, W15, W17, W18, W19, W23 to W31, W33, W37, W38, W39 and W41 (22 receipts, 53 units), counted into reading 2026-10-28, transaction 53dYPJNvXjYk…UDk7iV6 (the receipts API links the full signature on each of the 22 rows). The other 22 weeks were recorded with no units and were never attested.
- Lamports: nothing has been spent. The units are pending on the program: when the coin graduates and its first crank runs, it spends pool × (1 − 0.95^53) ≈ 93.4 percent of the fee pool that is spendable at that moment. The fee pool held 0.02 SOL on 2026-10-29, all of it the reserve the program keeps.
- Not affected: no burn has run, no holder's tokens were touched, no trade was made, no rule text changed, no other coin recorded a wrong result. The operator's 5 SOL seed of the curve was disclosed at launch and is unchanged.

## Timeline (UTC, Denver in brackets)

- 2026-10-28 00:16 (10-27 18:16) — $GASCAT launched on the eia.gasoline weekly feed.
- 2026-10-28 06:18 (00:18) — the keeper's first read of the feed for the coin; 44 weekly receipts written; the cycle failed on "not a settlement time: 2026-W10".
- 2026-10-28 06:22 to 13:37 (00:22 to 07:37) — every cycle failed the same way; keeper-stale alerts each hour; Healthchecks down and up emails.
- 2026-10-28 13:37 (07:37) — publish 131 live: weekly and quarterly periods understood, the launch cut judged by the period's first day; the keeper restarted.
- 2026-10-28 13:39 (07:39) — the first cycle on the fixed code attested the 22 planned receipts (unit counter 54).
- 2026-10-28 13:45 (07:45) — the operator's assistant found the attestation and the incident was recorded in the private handoff.
- 2026-10-28 14:03 (08:03) — the hourly audit went red: 44 receipts without a recorded reading (the readings exist; the fixed launch cut now hides them from the recompute).
- 2026-10-29 (morning) — this entry, the disclosure note on the 44 receipts, and the code in publish 132.

## Root cause

Two gaps, one behind the other.

1. src/lib/burnticker/launchCut.ts judged a reading as after the launch by comparing its period text with the launch timestamp. A week ("2026-W10") sorts after any "2026-10-27T…" string, so every week of the feed counted as after the launch and was planned. src/lib/burnticker/multiKeeper.ts receiptDay then had no rule for turning a week into a day and threw, which failed the cycle. Fixed in publish 131 (periodStart.ts: a week or quarter counts when its first day is after the launch).
2. The attestation step took every planned receipt as given. Nothing between the registry and the chain asked again whether a receipt was from before the launch. The rows planned before the fix were attested by the fixed code.

## What we changed

- Publish 131 (public commit 91c8ed31): weekly and quarterly periods in the keeper, the memo and the launch cut.
- Publish 132: the keeper voids a planned receipt from before a coin's launch instead of attesting it (multiKeeper.ts submitCounterReadings, registry voidReceipt); the audit and the coin page flag a pre-launch receipt unless its note begins "Settled before this coin launched." (launchCut.ts receiptBeforeLaunch, tokenPage.ts); the receipts API reports it as `preLaunch: true` and leaves it out of the recorded-results count and the badge (API 1.21.0); tests in test/burntickerPreLaunchReceipts.test.ts.
- The 44 Gas Cat receipts carry the disclosure note (set on the host by the operator; the receipts API shows it on each row).

## What we did not change, and why

- The reading on chain. The program refuses a second reading for the same date and a later lower value earns zero units without cancelling earlier ones. There is no instruction that removes units, by design.
- The coin. It keeps running on its rule from here. The pending units burn Gas Cat with Gas Cat's own fees at graduation; no one else's money is involved.

## Check it yourself

- The reading: the transaction above carries the memo `bt.units:GASCAT|prev=2026-10-27|2026-10-28|54|…`.
- The receipts: `curl -s https://burnticker.com/api/burnticker/v1/tokens/2L3bZbzkYgJ4eU64ed7YvchrxEnzQXQt2gvxq1CLburn` lists each of the 44 receipts with `preLaunch: true` and the note.
- The audit: https://burnticker.com/burnticker/trust shows the hourly audit; it reports the 44 as mismatches until publish 132 and the note are both in place, and clean after.
