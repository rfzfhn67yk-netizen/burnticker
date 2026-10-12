# Response to the fourth ChatGPT/Codex re-check (2026-10-11)

The report is published unedited: [2026-10-11-chatgpt-recheck-4.md](2026-10-11-chatgpt-recheck-4.md). It was run against the audit
view [PR #1](https://github.com/rfzfhn67yk-netizen/burnticker/pull/1) at `6a2d9047`, priority scope `191d3b3b..6a2d9047`. It confirms
one new P2 (F1), re-closes the earlier findings in the exercised cases, and keeps three things open: the oversized single launch
transaction, the pre-wallet summary, and the Rust suites it could not run (no cargo). Nothing below touches token economics,
settlement rules or permissions.

## F1: a malformed RPC answer became "NOT registered"

| Finding | Disposition | Evidence |
|---|---|---|
| **F1** [P2]: `jsonRpc` checked neither the HTTP status nor the JSON-RPC envelope, and `readRegistration` took `r?.value ?? null`, so a 503 JSON body, a `200 {}` or a result without `value` decoded as "no account" and the page could say "NOT registered with the burn_receipts program". The false negative entered the 60-second memo. | **confirmed, fixed** | `src/lib/burnticker/trustpack/receiptCheck.ts` `jsonRpc`: 429 and 5xx are retried then thrown; any other non-OK status throws; a non-JSON body throws; a body without a `result` member throws (`result: null` is still a real answer — `getTransaction` needs it). `src/lib/burnticker/mintRegistration.ts` `readRegistration` accepts only an explicit getAccountInfo `value`: `null` → not-registered, `{owner, data:[base64,"base64"]}` → decoded, anything else → unavailable with its reason. Tests in `test/burntickerNetworks.test.ts`, block "F1": HTTP 503 JSON; HTTP 200 `{}`; result with context but no value; empty body; HTTP 403 carrying a well-formed body (not trusted); an account without owner/data; the explicit-null and real-TokenConfig controls; and the two-network case through the served verifier (mainnet `value: null`, devnet HTTP 503 → registration `unknown`, "Unable to verify", the headline never says "NOT registered", and the answer is not memoised: a second paste within the window re-reads the chain). All real `Response` objects through the production `jsonRpc`. |

Because `jsonRpc` is shared, the same hardening now applies to the browser receipt verifier, the Trust page's chain reads and the
current-status program reads: a non-answer is an error there too, caught by each caller's existing unavailable path.

## The Rust suites the report could not run

The report could check the Rust fixes only in source. We ran the program harness (`programs/burn-receipts/scripts/test.sh`: builds
the test-only fixtures and the `--features test-pins` build, then the LiteSVM suites of both programs) on 2026-10-11, Rust `cargo
1.99.0`, exit 0. Per test binary, `ok` means 0 failed and 0 ignored:

| Program | Suite | Result |
|---|---|---|
| burn_receipts | unit tests (src/lib.rs) | ok, 11 passed |
| burn_receipts | tests/governance.rs | ok, 6 passed |
| burn_receipts | tests/integration.rs | ok, 22 passed |
| burn_receipts | tests/launchlab.rs | ok, 5 passed |
| burn_receipts | **tests/lock_fees.rs** (LP-lock RL-2/RL-3/L-1–L-3) | **ok, 13 passed** |
| burn_receipts | tests/pairs.rs | ok, 24 passed |
| burn_receipts | tests/platform.rs | ok, 6 passed |
| burn_receipts | tests/recheck3.rs | ok, 7 passed |
| burn_receipts | tests/review2.rs | ok, 16 passed |
| burn_receipts | tests/review3.rs | ok, 11 passed |
| burn_receipts | tests/review_fixes.rs | ok, 7 passed |
| burn_receipts | tests/review_lock.rs | ok, 6 passed |
| burn_receipts | tests/review_pair.rs | ok, 3 passed |
| burn_receipts | **tests/review_pair_r2.rs** (pair-forward re-check M-1, RI-1, RI-4) | **ok, 3 passed** |
| pair_curve | tests/lifecycle.rs | ok, 11 passed |
| pair_curve | tests/review_lock.rs | ok, 17 passed |
| pair_curve | **tests/review_pair_r2.rs** (F5 / RN-1 / RN-2: day-30/day-59 unlink refused, both pools register; read-before-link) | **ok, 5 passed** |
| pair_curve | tests/review_pc1.rs | ok, 2 passed |
| pair_curve | tests/review_pc2.rs | ok, 11 passed |
| pair_curve | **tests/review_pc3.rs** (deadline/void race, own-vault WSOL donation) | **ok, 9 passed** |
| pair_curve | doc tests | ok, 7 passed |

202 Rust tests, 0 failed, 0 ignored. This is the operator's run on the operator's machine, published as a record; it is not an
independent run. The harness and its fixtures are in the public tree so anyone with cargo and the Solana SBF toolchain can repeat it.

## Still open, and what is being done

| Item | Status |
|---|---|
| Oversized single launch transaction (legacy transaction, 1,258 wire bytes against the 1,232 limit) | **Fixed in code (`01accb79`, merged `4edd0c39`); not yet usable on chain.** The signing plan builds v0 transactions against one per-network address lookup table of 21 fixed accounts (`src/lib/burnticker/lookupTable.ts`: both programs and their event authorities, the LaunchLab program, global config, platform, authority and event-authority PDAs, the platform fee vault, the CPMM config, the fee-keys PDA, the operator treasury, and the system, token, Token-2022, ATA, rent, metadata, WSOL and memo accounts). Measured at the production send path (`test/burntickerLookupTable.test.ts`): single coin 1,262 → 988 bytes; single coin with the longest name, ticker and URI 1,326 → 1,052; LaunchLab pair 1,353/1,385 → 1,079/1,111 (it was also over as legacy); pair curve 833/833/716 → 807/807/566. The same test asserts the legacy construction of the same fixture is over 1,232 and that `Transaction.serialize()` throws, so a revert fails. The table's address is pinned in `LOOKUP_TABLES` (`networks.ts`) and is `null` on both networks until the operator creates and freezes the tables (`scripts/burnticker-lut.mts create / freeze / verify`); the page fetches the table before signing and refuses with "lookup table mismatch — nothing was sent" unless the address, activity, every entry at its index and a frozen (or pinned) authority all match. Two shapes still do not fit and are now refused before the wallet opens: a create combined with the creator's opening purchase (1,281 bytes) and the vault form with a purchase (1,401). Splitting the purchase into its own transaction makes it non-atomic with the create; that is an operator decision still open. Vault-mode bundles also need a signature from a PDA and could never be signed; that predates this change and is unchanged. The public `compileUnsigned` helper still returns a legacy message and reports `oversize` for a real single coin; `docs/burnticker/api.md` tells callers to compile as v0 against the table. No transaction was sent to any cluster for this work. |
| Recovery of a partially completed plan whose unsent mint keys are gone after a reload (round-2 F4 residual) | **Fixed in the same commits.** Mint keys stay unpersisted. The plan record now keeps each step's signer count and the fees paid; when something is already on chain and a remaining step needs a mint key the page no longer has, `signAndSendPlan` returns `abandoned` without building any step, so the wallet never opens and no second create is attempted (tested in `test/burntickerSignCard.test.ts`). Each step shows confirmed, sent (pending reconciliation) or abandoned; the abandoned sentence says nothing from the plan is live until the create step confirms and names the fee already spent, and the only action offered is to start a new plan. |
| Pre-wallet transaction-count / network / cost summary | **Open; in work** on the launch page (website-7). |
| Docker-reproducible build, independent attester, source licences, signed operator statement, 48-hour time lock | **Open, unchanged**, listed on the trust page; the time lock is scheduled for about 2026-10-23. |

The report's live observations (Trust loads; "3 keys, 2 controllers"; bounty live balance agrees with the record; the featured mint
reads as registered on devnet only) match what the site is meant to show. No deployment, governance change, wallet action or
production transaction was made for this response.
