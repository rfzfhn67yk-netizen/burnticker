# Response to the second ChatGPT/Codex review (2026-10-11)

The report is published unedited in [2026-10-11-chatgpt-pr-review-2.md](2026-10-11-chatgpt-pr-review-2.md). It reviewed public commit
`07b7b4f5` (PR #1 head), which is monorepo commit ≈ `9a337d44`–`73a657ae`. The fixes are on branch `burnticker/chatgpt-review-2-fixes`,
cut from `73a657ae` on `fix/price-integrity-and-engine-correctness`. We checked every finding against that code and did not take any
finding as given. For each code finding we wrote the regression test first and ran it against the unmodified code. Each time the
core test **failed** in the way the report describes. We then fixed the code and ran the full suite. Tests that pass on both versions
are kept as guards, and the table says which.

F5 is not fixed on this branch. It is exactly pair-forward re-check RN-1/RN-2, which the pair program's round 3
(`burnticker/pair-forward-r3`) fixes in `programs/**`. This round did not touch `programs/**` or `src/lib/burnReceipts/**`.

## Findings

| Finding | Disposition | Test(s) — failing first | Commit | Remaining limitation |
|---|---|---|---|---|
| **F1** [P1] the reading fence ran before planning, so a cold standby counted the leader's receipts again | **confirmed, fixed** | `test/burntickerTrustOps.test.ts` "5c · review 2 F1 …". The tests compare a failover with the same two days run by one keeper, through the production orchestration (`KeeperOps.cycle`), with a standby whose pending set is empty. Four tests: "single coin … (the report's 63 → 125)", "an active pair (the attest-only pass) …", "a wind-down (end receipts planned inside the execution pass) …", "fail closed: a TokenConfig that cannot be read holds the cycle's sends …". Before the fix the counters were **63 → 125** (the report's number exactly), **3 → 5** for the pair and **25 → 45** for the wind-down; the fail-closed test had no fence result at all. | `99d67485` | The fence now runs inside `runCycle`, after planning and before the first attestation: before the active-pair attest-only pass, and again before a coin's freshly planned end-of-rule receipts are attested. Any hold turns the rest of the cycle into a dry run. A TokenConfig that cannot be read now holds. `scripts/burnticker-keeper.mts` calls `KeeperOps.cycle`, the same function the tests call. The adoption still matches on unit totals per reading, not on event ids (runbook, failure modes). |
| **F2** [P1] the 7-day cut dropped graduated pairs with an unlocked side before the retry and the 30-day `burn_lp` | **confirmed, fixed** | `test/pairCurveClient.test.ts` "review 2 F2 — …" drives `crankPairCurves` against a fake RPC. Day 8: the pair is scanned, `lock_lp` is retried and the unlocked-side alert is raised. Day 31, with Raydium's lock refusing: `burn_lp` is attempted. Day 40, LP locked but a pool unregistered: `register_pair_pool` is attempted. A fully complete old pair ages out. Before the fix the first three returned **scanned 0**. The complete-pair test passes on both versions. | `03a8287c` | An old Graduated pair is kept while any work is outstanding: an unlocked side, an unregistered pool, a missing FeeKeyRecord, or a developer accrual over the claim threshold (`graduatedPairWorkOutstanding`). If the work check cannot read a pair, the pair is kept. This costs up to four account reads per old pair per cycle, until the pair is complete. |
| **F3** [P2] launch confirmation trusted account-key presence | **confirmed, fixed** | `test/burntickerCodexReview.test.ts` "F3 (review 2) — a launch confirmation authenticates initialize_token, the on-chain TokenConfig and the venue, not account-key presence" (9 tests). Refused: the report's fixture (a genuinely signed SystemProgram zero-lamport self-transfer, with burn_receipts as an unused key); a wrong discriminator; initialize_token for another mint; a TokenConfig that is absent, not the program's, or locks another rule hash; a LaunchLab draft without the LaunchLab create; a pair-curve draft carrying init_pair alone, the other side's initialize_token, or an incomplete pair venue. Accepted: a correct LaunchLab launch (legacy and v0 messages) and a correct pair-curve side-A transaction. Through the API, a refused confirmation leaves the draft's status, baseline and launch tx unchanged. Before the fix, 8 of 9 failed: the report's fixture returned `{"ok":true}`, and the forged API confirm took the draft live. The correct pair-curve case passes on both versions. | `4f76c5e3` | The verifier now decodes the top-level burn_receipts instruction: initialize_token's discriminator from the IDL, the mint slot = the draft mint, the creator slot = the draft creator. It reads the TokenConfig: owned by the program, this mint and creator, `rules_sha256` = the draft's. For LaunchLab, the same transaction must carry `initialize_v2` (payer = creator, recorded creator = burn pool, platform, base mint), with registration policy 0. For the pair curve, policy 2 and the Pair account on chain naming both mints, the creator and this side's rule hash; before init_pair lands the answer is 409. Not checked: initialize_v2's numeric arguments, the Pair's status and terms, and initialize_token reached by CPI (refused). A host without program ids refuses (503). |
| **F4** [P2] a landed send was forgotten when its confirmation failed | **confirmed, fixed** | `test/burntickerSignCard.test.ts` "an ambiguous confirmation keeps the sent transaction and recovers it (review-2 F4)". Nine tests cover: persisted before the send; adopted once confirmed with **no second create**; rebuilt only after proven expiry and absence; no rebuild while the blockhash is live or the status is only "processed"; failed on an on-chain error; the pure reconciliation; reload with the stored record; a confirm transport throw; the card's sentences. All nine failed before the fix; the duplicate-create test sent 2 transactions where 0 were expected. Added later: "reload WITHOUT the plan (the launch page's recovery notice) …". | `e3f5a7b4`, `c7cd095e` | Each signed step is written to sessionStorage before `sendRaw`, under the key `burnticker.signplan.<mints>` (`{ v, mints, confirmed, recorded, pending { step, signature, tx, blockhash, lastValidBlockHeight, sentAt }, failed, confirms, steps }`). The card shows confirmed / "Sent; confirmation unavailable — signature …" / did not take effect / not sent, and never "Nothing was sent" after a send. `confirmPlan` transport errors are caught, and `busy` is cleared in `finally`. After a reload, the launch page's notice settles the stored transaction from storage alone and records the drafts. It cannot rebuild a step that did not take effect, because the mint keys are never stored; it says to start again from the review. The status lookup relies on the RPC keeping signature history (`searchTransactionHistory`). |
| **F5** [P1] the 30-day unlink evidence could unlink a healthy open pair | **confirmed (= RN-1/RN-2); deferred to pair round 3** | `programs/burn-receipts/programs/pair_curve/tests/review_pair_r2.rs` (`rn1_…`), handled on `burnticker/pair-forward-r3` | — | The keeper's `pairUnlink` sending stays OFF by default. As the report says, that only stops our keeper, not the permissionless instruction. Creator launches are gated off (`BURNTICKER_CREATOR_LAUNCHES_ENABLED`) and the pair curve is behind its own flag until round 3 lands. The run log the report found missing (`docs/burnkeeper/devnet-pair-forward-r2-run-log.md`) is on the round-3 branch and arrives with it. |
| **F6** [P2] pair entry points described the loser burning | **confirmed, fixed** | `test/burntickerTemplates.test.ts` (3 tests). A named fixture ($BRONCOS vs $CHIEFS, Denver beats the Rams): `pairWinnerOf` names $CHIEFS, and the keeper marks $CHIEFS "won/confirmed" and $BRONCOS "lost/forwarded", with the pair_forwards row going to $CHIEFS. Coin vs Coin: the side whose coin did better fires. Every surface carries the one sentence. Before the fix, the old text was present: the landing page's "neither pool can pay the other side" and three reversed template examples (Coin vs Coin "did worse burns", election pair "who loses the race burns", bracket "losing side … burns"). | `53402b68` | One sentence, `describe.ts` `PAIR_BURN_SENTENCE`: "Winner takes the burn: fees from both coins burn the coin whose rule the result fires (the winner); the losing coin's share goes to the winner's burn pool, never to a holder." It appears on the templates gallery (`pairLine`), the landing page, the review card (`PAIR_REVIEW_LINE`), Burn Derby and both pair pages. A matchup on two separate results is two separate coins, and its template says so. |

## Live-site UX audit (§2): the "cut first" items

All in `c2efc9de` (glossary `a897606b`). Test: `test/burntickerReview2Ux.test.ts`.

| Cut | Disposition |
|---|---|
| Remove "Launch the first one" and the duplicate closed-launch CTA | **fixed.** There is now one availability state (`creatorLaunches.ts`). Server pages read it from the env, client pages from the catalogue's `launches.creators`, and unknown counts as closed. The launch CTAs on the coins page, the league pages, the templates' "Start from this", "Launch one like this" on coin and pair pages, the rivalries page and the landing page's Launch door, nav button and sub-line render only while creator launches are open. The app's nav still has "Launch"; that page states that launches are closed. |
| Point every $DEFICIT link to the same served page | **fixed.** `DEFICIT_SITE` (deficit.burnticker.com) is used until $DEFICIT is registered on this host; `deficitHref(true)` gives the coin page after that. The nav, the launch page and the landing page use it. `/burnticker/t/DEFICIT` explains that the coin is not registered here and links the served page. |
| Replace the zero-row green audit claim | **fixed.** `auditBadgeView` reads "No receipts available to check on this host", in a neutral colour, on the coins page and the static index. |
| "Creator launches are closed. This host currently shows devnet information." above the entry choices | **fixed.** The landing page shows it, with the cluster taken from the catalogue, and so does the coins page header. |
| One sentence of mechanics and one evidence link; guardrail list below the evidence | **deferred** to the next launch-UX pass. The guardrail list stays in the hero, in the order the tests pin. Its attester item now states the present fact. |
| Hide empty launch controls on league pages; "No team-coin receipts for this season yet. This page tracks processed coin receipts, not every game." | **fixed** |
| "No wallet is needed to read results or receipts." beside the scoreboard | **fixed.** It appears on the coins, leagues, rivalries, Derby and both pair pages, on the landing page and on the closed launch page. |
| Normalize provider team names | **fixed.** The display name drops the alias table's disambiguating letter and does not repeat a city that equals the nickname ("Chicago Cubs", "Athletics"). The alias table itself (matching) is unchanged. |
| Trust: present facts, not a schedule; host vs chain vs compiled; register; systemd; one-shot | **fixed** (the contradictions). The Program section now has three labels: this host's wiring, the chain deployment from `verified-build.json`, and the compiled id. The attester line reads "One operator attester is configured; no independent second attester is live." The program's shipped Powers Register (`burn-receipts.powers-register/v1`) was never recognised, which is why the "placeholder until … ships" label showed; it is now mapped. systemd reads "units supplied; installation on this host not verified". The one-shot limitation states the onEnd schedule. The full three-block restructure with history behind links is **deferred** (top-ten 8, the partial half). |
| Fee ledger: remove "Nothing on this page comes from our own records" | **fixed.** Each block names its source: chain reads, the keeper's records, or operator-entered expenses. |
| Status page: drop "the trust page and the receipts are unaffected" | **fixed.** It now reads "status.json could not be read (…). Current automation status is unavailable." The outage fallback page no longer says "unaffected" either. |
| Operator page: move signing commands to operator docs | **fixed.** The steps are in `docs/burnticker/runbook.md` ("Signing the operator statement"). The "not signed yet" fact and the text to be signed stay on the page. |
| A labelled, verifiable rehearsal receipt on the host | **deferred.** It needs a rehearsal receipt whose program, mint and source this host can verify. Until then the page shows no receipt, and does not show a fabricated one. |
| Glossary at first use (top-ten 10) | **fixed** (`a897606b`). `glossary.ts` gives one sentence each for burn, receipt, burn pool, attester, locked LP, Fee Key, graduation ("moved to trading pool"; the coins tab is renamed), wind-down and keeper ("automation"). They appear as tooltips and one-line notes on the landing hero, the coins page, the trust page header and both pair pages. All are lint-clean. |

## Explanation mismatches (§3)

| # | Mismatch | Disposition |
|---|---|---|
| 1 | Pair direction | **fixed:** F6, `53402b68` |
| 2 | Availability | **fixed:** one shared state, `c2efc9de` |
| 3 | Proof scope | **fixed in part.** The zero-receipt badge is neutral. The audit sub-line keeps "source only" / "source + chain". The trust Program section separates this host, the chain read-back and the compiled value. A "rehearsal" label waits for a verifiable rehearsal receipt (above). |
| 4 | Income provenance | **fixed:** per-block provenance on the fee ledger |
| 5 | Host vs chain vs design | **fixed** for the Program section and the Powers Register. Other designed-vs-live tables already carried both columns. |
| 6 | Rule ends | **fixed.** The one-shot limitation now states the onEnd schedule (drain / 28-day wind-down / retired-coin sweep). |
| 7 | Sources (stale ESPN settlement labels; coverage from fixtures read as availability) | **deferred** to the next launch-UX pass. The landing tape is marked "example lines". Relabelling each line with its actual primary and independent-check method needs the per-league source map, and the coverage endpoint's description change is an API-contract edit. |
| 8 | Security reports | **fixed.** The README lists all eleven report files, latest disposition first, with the embedded re-check noted. `transparency.json` adds the missing `paircurve-recheck` and the new `chatgpt-adversarial-2`. |
| 9 | Launch cost, permission and recovery | **recovery fixed** (F4). The **pre-wallet cost / network / transaction-count summary (top-ten 9) is deferred** to the next launch-UX pass. Creator launches stay gated off until it lands. |
| 10 | Ops data absence | **fixed:** the status and fallback pages say unavailable or unknown, never "unaffected" |

## The failing release check (`test/burntickerTrustOps.test.ts:512`, "migrated into the folder")

**Explained; the fix is an owner step in the public repository.** The monorepo tracks only `docs/burnticker/INCIDENTS.md`. The public tree
is published from a Mac (case-insensitive filesystem, `core.ignorecase` on), so the old lowercase `docs/burnticker/incidents.md` stayed
in the public repository's index while the file on disk took the new name. Every fresh clone then checks out the old name, and the
test fails there. `scripts/ops/public-repo-lib.mjs` (`ab7e49b6`) now warns about any case-only rename between the public index and the
published tree, and prints the exact fix: `git -C ../burnticker-public mv -f docs/burnticker/incidents.md
docs/burnticker/INCIDENTS.md`, followed by a commit there. The test stays as written, because it is right.

## Also found while fixing (not review findings; open)

- A single-coin launch transaction with the real initialize_token plus the real SDK `initialize_v2` compiles to 1,254 bytes as a
  legacy message, which is over the 1,232-byte limit. The F3 fixtures sign the message bytes instead. The real single-coin flow may need
  a v0 message with a lookup table, or a split. This must be resolved before creator launches open.
- `ProgramBurnClient.initializeToken` never passes `launchlabPlatform`, although `instructions.ts` documents it as required for buyback
  policy 0.
- `docs/burnticker/VERIFIED-BUILD.md` links `docs/burnkeeper/devnet-pair-forward-r2-run-log.md`, which exists only on the round-3 branch
  (see F5).

## Also in this round

The bounty wallet `HATDNP3M…HJv2u` was funded by the owner with 5 SOL on 2026-10-11 (`718226a4`). SECURITY.md, `transparency.json`,
the check page's open item and the owner to-do list are updated. The balance is read live from chain and is never hard-coded.

## What was run

- Full TypeScript suite: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs --test 'test/**/*.test.ts'`.
- `npm run typecheck`: no errors in changed code. The only error is the pre-existing `src/app/layout.tsx` `LayoutProps`, a type Next
  generates that is absent in a fresh worktree.
- `sh scripts/ops/publish-public-repo.sh --check` ends with `CHECK PASSED` (and prints the case-only rename warning above).
- No Rust was changed or run here. No transaction was sent, and nothing was pushed, merged, published or deployed.
