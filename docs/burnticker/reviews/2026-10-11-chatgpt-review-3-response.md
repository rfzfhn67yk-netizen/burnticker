# Response to the third ChatGPT/Codex review: code review + live UX review (2026-10-11)

Both reports are published unedited:

- [2026-10-11-chatgpt-pr-review-3.md](2026-10-11-chatgpt-pr-review-3.md) is the code review. It is scoped to `782e31ec..191d3b3b` and has one finding, F1 (P2).
- [2026-10-11-chatgpt-ux-review-3.md](2026-10-11-chatgpt-ux-review-3.md) is the live UX review: ten practical changes.

The fixes are on branch `burnticker/website-4`, cut from `e875c72a` on `fix/price-integrity-and-engine-correctness`. The tree had
moved on since the reviewed commit: website-2 and website-3 were merged, adding the launch gate, the shared empty states, the
current-status object and the readiness states. So we checked every observation against the current code before changing anything.
Nothing here touches `programs/**`, token economics, settlement rules or permissions.

## Code review: F1

| Finding | Disposition | Test(s) | Commits | Remaining limitation |
|---|---|---|---|---|
| **F1** [P2]: an unreadable ProgramData account became "upgrade authority none (chain)"; the same model turned a failed mainnet lookup into "not deployed on mainnet yet" | **confirmed, fixed** | We reproduced it first against the unmodified `currentStatus.ts`. The Program read succeeded, then the second read threw `503 ProgramData RPC unavailable`. The old output was `auth null, source "chain"`, and the mainnet line was "not deployed on mainnet yet". New output: `source "unavailable"` and "mainnet deployment unknown (the chain read failed)". The regression tests are in `test/burntickerWebsite2.test.ts`, block "F1 (ChatGPT code review 3, 2026-10-11)". They cover eight unavailable shapes: the second read throws; the ProgramData account is missing; there is no value array; a foreign owner; the wrong account type; truncated bytes; an option tag other than 0/1; Some with its key cut off. Two more tests cover a decoded None ("no upgrade authority (immutable; read from chain)") and a decoded Some. Further tests: a failed mainnet lookup gives deployment `null` / "unknown" and is never "not deployed"; a successful empty read gives "not deployed"; a devnet read that fails before the Program accounts gives "unavailable", shown with the dated verified-build record. | `f1609293`, `101c946e`, `826ab9ec` | We also found a second defect while writing the tests: `upgradeAuthorityOf` decoded a truncated Some as None. The decoder now returns `undefined` (not decodable) for it. `authoritySource` is now `chain`, `verified-build` or `unavailable`, and renderers use the one wording function `upgradeAuthorityText`, which lives in a client-safe module. The verified-build fallback is labelled as a record, with its date. |

## UX review: the ten changes

| # | Change | Disposition | Commit |
|---|---|---|---|
| 1 | F1 in the shared current-status model and renderers | **fixed** (above) | `f1609293`, `101c946e` |
| 2 | Shorten Home; the primary action is "Inspect the devnet receipt"; remove "Door 2" | **fixed.** The real receipt and its action follow the closed-launch line. The eleven guardrails sit behind a disclosure under a two-sentence summary, and the door numbers are gone. At 390 × 844, the status line is at 254 px and the action at 665–714 px (the report measured about 1,588 px), with no horizontal overflow. | `d6ec62e4` |
| 3 | Hide zero-result filters on Coins; combine empty Rivalries/Seasons navigation | **fixed.** With no coin and no pair, Coins shows one explanation and one evidence link. It names that as a host fact, separate from program deployment. Seasons shows one box instead of three empty sections. Leagues already put its labelled example before the league links. | `e1dcc5cf` |
| 4 | Raw host diagnostics behind details; label missing status groups | **fixed.** One `HostDiagnostics` disclosure ("operator details") is used on the coins, coin, pair and trust pages. A host without a program id no longer says "burn_receipts program: not deployed", which was wrong: the devnet programs are deployed. When `status.json` is missing, every group it feeds says "unavailable". The current-status panel says it is the configuration record and does not show whether burns are being processed. | `9e15344c` |
| 5 | Consolidate Trust/Operator; remove conflicting wallet/bounty placeholders | **fixed.** The current summary gains a "Money:" line (25 bps of curve volume and 20% of post-graduation LP SOL fees to the operator; the other 80% and the token side to burn pools), and the long disclosures sit behind one evidence disclosure. Stale prose in `operator.json` ("every mainnet wallet is created on launch week") is replaced. The signed statement reads "address configured; statement not signed", because it is not signed yet. The bounty now shows "recorded funding: 5 SOL (2026-10-11)", "funding transaction: not recorded here" and "live balance: … / unavailable" as separate lines. `trust.ts` said the 20% LP share is paid to "the Squads vault"; the treasury is the developer fee wallet, and that is corrected. | `773d503b` |
| 6 | Sports/Derby independence and rule-winner wording | **fixed.** "A second independent operator agrees" becomes a second publisher: a source check, not a second signer, while one operator attester signs every reading (quorum 1). The pair sentence names the coin whose rule fires, "not the team that won". "Nobody is paid" becomes "Nothing is paid to holders", because the operator is paid fees. The locked rule sentences in `rules.ts` are untouched. | `6e7dfe90` |
| 7 | Reorder the verifier and fix the anchored mobile heading | **fixed.** The outcome and the three layers come first; the picker, signature and RPC fields sit under "Check another receipt". For `?demo=1` the verifier renders above the checklist, so the checklist loading above it can no longer push the anchor away. `scroll-mt-24` is set. At 390 px, `#verify` lands at 96 px. | `bc14022a` |
| 8 | Collapse the external $DEFICIT empty sections; link the internal rehearsal proof | **fixed.** One pre-launch summary links the devnet receipt and keeps the rehearsal's 1% separate from the proposed 2%; no launch date and no buy action. The footer no longer says "Launched on Burnticker". The report's note on the Not-Burnticker list is also done: an unavailable program check now says "registration is unknown". | `cee850b1`, `997207c0` |
| 9 | Plan-specific launch summary before the wallet | **deferred.** Creator launches stay closed; this is a separate pass. | — |
| 10 | Replace the front-loaded glossary with context help | **fixed.** Each term carries its sentence at first use (`<abbr title>`): burns, receipt, reading signer, burn budget, automation. The trust page's word list sits beside its evidence. | `054a93b6` |

Already true when checked: the leagues directory showed its explanation and example before the 25 league links (item 3). The status
page already said `status.json` could not be read (item 4), but it left the tables below blank.

Tests for items 2–10: `test/burntickerWebsite4.test.ts`. The suite, `tsc` and `scripts/ops/publish-public-repo.sh --check` pass at the branch tip.
