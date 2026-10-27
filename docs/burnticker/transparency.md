# Burnticker — transparency: what is public, where, and how the owner publishes it

The owner, 2026-10-09: "make sure everything is transparent. i dont want to hide anything." This is the checklist. Everything below
is either public already (in the monorepo paths named, and in the public repository once it exists) or marked as an owner step.

## 1. What is public, and where

| What | Where in this monorepo | In the public repo | On the trust page |
|---|---|---|---|
| The on-chain program (source, tests, generator scripts) | `programs/burn-receipts/` | same path | program id / hash / verify steps once deployed |
| The Powers Register (every instruction, signer, timelock, sunset; what does not exist) | `docs/burn-receipts/powers-register.{json,md}` | same path | rendered as the register table |
| The program's TypeScript client | `src/lib/burnReceipts/` | same path | — |
| The $DEFICIT keeper and the multi-token keeper | `src/lib/burnKeeper/`, `src/lib/burnticker/`, `scripts/burn-keeper.mts`, `scripts/burnticker-*.mts`, `scripts/burnkeeper-*` | same paths | — |
| The platform pages and API routes | `src/app/burnticker/`, `src/app/api/burnticker/` | same paths | this page is one of them |
| The fee design and the live comparison | `src/lib/burnticker/fees.ts`, `docs/burnkeeper/fees.md` | same paths | "Platform config — live vs designed" |
| The developer fee wallet's ledger | read from chain | — | "Developer fee wallet and ledger" |
| The refuse list the operator's trading bots obey | `src/lib/ownTokens.ts`, `config/own-tokens.json` | same paths (the only files from the trading side that leave) | "Who runs this" |
| Who runs this (one independent operator, identity held privately; also runs trading bots, which refuse platform coins) | `src/lib/burnticker/fees.ts` (`OPERATOR_LINE`), `config/burnticker/transparency.json` | same paths | "Who runs this" |
| How it was built (AI-assisted; bounty; one line: no security firm has audited the code) | `config/burnticker/transparency.json` | same path | "How this was built" |
| Every wallet (ops, deployer, keeper, dev fee, platform admin, Squads vault + 3 members, $DEFICIT mint pubkey, trading wallets) | `config/burnticker/transparency.json` → `wallets` (TODO until set; env vars fill some) | same path | "Every wallet" |
| The decision log (dated, append-only) | `docs/burnticker/decisions.md` | same path | "Decision log" |
| The changelog (every publish and deploy, with commit + program hash) | `docs/burnticker/CHANGELOG.md` | same path + root `CHANGELOG.md` | "Changelog" |
| The incident log (append-only) | `docs/burnticker/incidents/LOG.md` | same path | "Incident log" |
| The incident policy (what counts, 48-hour public postmortem, where, who signs) and its template | `docs/burnticker/INCIDENTS.md`, `docs/burnticker/incidents/TEMPLATE.md` | same paths | "Incident policy" |
| The daily registry snapshots (canonical JSONL of the whole ledger, pinned to Arweave; sha256 + transaction id per day) and their verifier | `src/lib/burnticker/ops/snapshot.ts`, `scripts/burnticker-verify-snapshot.mts` | same paths; the bytes on Arweave | "Registry snapshots on Arweave"; `GET /api/burnticker/v1/snapshots` |
| The keeper's live status (heartbeat, role, every source's state, open alert kinds, wind-downs, the latest snapshot, programs) | `src/lib/burnticker/ops/status.ts`, `site/burnticker/status/` | same paths | linked: `https://status.burnticker.com/` |
| Keeper redundancy (leader / standby, signed takeover notes) and what it does not guarantee | `src/lib/burnticker/ops/leaderLock.ts`, `readingFence.ts`, `docs/burnticker/runbook.md` | same paths | "Keepers — which one is active" |
| Bring-your-own-attester guide and tools | `docs/burnticker/ATTESTERS.md`, `scripts/burnticker-attester.mts` | same paths | "Attesters per coin" |
| The launch-day load test, its numbers, and the caching plan | `docs/burnticker/LOADTEST.md`, `scripts/ops/loadtest.sh` | same paths | — |
| Known limitations (quorum 1, Switchboard shutdown, Kalshi off-chain read, one-shot markets, no burn-pool cap (since 2026-10-25), devnet rehearsal not done, program not deployed, …) | `config/burnticker/transparency.json` → `limitations` | same path | "Known limitations" |
| Policies (no deletions on X, corrections in-thread with the receipt, no paid promotion, the platform buys no coin except one test coin, nothing announced as coming later, …) | `config/burnticker/transparency.json` → `policies` | same path | "Policies" |
| The public audit (every receipt recomputed) | `scripts/burnticker-audit.mts` → `audit.json` in the site dir | same script | "Public audit" |
| Sites and brand | `site/deficit`, `site/burnticker`, `site/brand-concepts` | same paths (brand assets published, not licensed for reuse) | — |
| Deploy files | `deploy/caddy/Caddyfile`, `deploy/systemd/mct-burnkeeper.service` | same paths | — |
| Tests and fixtures | `test/burn*`, `test/burnticker*`, the four fixtures they read | same paths | — |
| The carve-out itself (allowlist, leak patterns, script, overlay) | `config/public-repo.allowlist`, `config/public-repo.denypatterns`, `config/public-repo/overlay/`, `scripts/ops/publish-public-repo.sh`, `scripts/ops/public-repo-lib.mjs` | same paths | "Who runs this" names the repo |
| Public README, LICENSE (MIT; brand assets excluded), SECURITY.md (bounty terms placeholder) | `config/public-repo/overlay/` | repo root | — |
| The sceptic's checklist (money flows per instruction, powers, locks, gaps, build hashes) and the browser receipt verifier | `src/lib/burnticker/trustpack/`, `docs/burnticker/CHECK-THIS-YOURSELF.md` | same paths | linked: `/burnticker/check` |
| The verified build (program hashes, how to reproduce, the registry step) | `scripts/ops/verified-build.sh`, `config/burnticker/verified-build.json`, `docs/burnticker/VERIFIED-BUILD.md` | same paths | `/burnticker/check` § build |
| The developer fee ledger by month and the expenses it pays | read from chain; `config/burnticker/expenses.json` | same path | linked: `/burnticker/fees/ledger` |
| The operator, every operator wallet per cluster, the signed statement, the never-buys monitor | `config/burnticker/operator.json`, `src/lib/burnticker/trustpack/neverBuys.ts` | same paths | linked: `/burnticker/operator` |
| Cross-links (site, repository, X, program ids, Squads vault, wallets) | `public/.well-known/burnticker.json`, `site/burnticker/.well-known/burnticker.json` | same paths | `/.well-known/burnticker.json` |
| Every open owner step and placeholder | `docs/burnticker/TODO-OWNER.md` | same path | — |

What never leaves the monorepo: the trading platform (its library directories, its runner and collector scripts, the arms, their
signers, the host wrappers that read the keychain and the host's environment file). The leak patterns name its directories;
that file is published but never scanned against itself. The allowlist is the
only way a file gets out; the leak scan is the second gate.

## 2. How the carve-out works (and what was split to make it clean)

`sh scripts/ops/publish-public-repo.sh --check` lists the tracked files the allowlist matches, verifies that every local import of
every copied code file resolves inside that set, scans every copied text file against `config/public-repo.denypatterns`, and writes
nothing. Without `--check` it empties the target (default `../burnticker-public`, keeping `.git` and `node_modules`), copies the
files at the same paths, lays the overlay on top, and writes a `package.json` whose dependencies are exactly the packages the
copied files import (versions from the monorepo; a tooling-only package the monorepo gets transitively is pinned from
`node_modules` and noted). `--tag` first appends a dated entry with the monorepo commit, the program hash (when a built `.so`
exists on this host), the IDL sha256 and the allowlist sha256 to `docs/burnticker/CHANGELOG.md`. `--verify` type-checks and runs
the tests inside the public tree (`--link-node-modules` symlinks the monorepo's for a local check; the real repo runs `npm install`).

Three small modules were split out on 2026-10-09 so the public code imports nothing private:

| Public file | Was imported from | Now |
|---|---|---|
| `src/lib/sameOrigin.ts` (`isSameOrigin`) | `src/lib/ownerAction.ts` (which imports the private trusted-host module) | the two Burnticker routes import the new module; `ownerAction.ts` re-exports it, one implementation |
| `src/lib/burnKeeper/keyfile.ts` (`loadKeypair`, `encryptSecretKey`, `decryptSecretKey`) | `scripts/keypair-signer.mjs` (the trading signer, which imports the live validator and reconciler) and `scripts/solrr-keygen.mjs` | the keeper, the launch CLI and the keygen use the new module; same encrypted file format, same refusals |
| `src/lib/burnKeeper/jupiterSwap.ts` (`usdPrice`, `buildSwapTransaction`) | `src/lib/jupiter.ts` (the app's Jupiter client with its cache, which imports the app's fetch wrapper and action-PIN store) | the keeper's buyback leg uses the new client; the same lite-API request shape; still checked by `src/lib/live/validateSwap.ts`, which IS published (it imports only web3.js) |

The trust page no longer reads the trading treasury's environment variable for its team-wallet list; wallets come from
`config/burnticker/transparency.json` and the platform's own variables.

## 3. Owner steps

1. **Fill the TODOs** in `config/burnticker/transparency.json` (`wallets[].pubkey`, `howBuilt.bounty.contact`, `publicRepo.url` after
   step 3) and `OPERATOR_CONTACT_TODO` in `src/lib/burnticker/fees.ts`. Finalise `config/public-repo/overlay/SECURITY.md` (tiers,
   contact, remove the placeholder line). `npm test` keeps the file honest (every wallet role present, no "coming soon").
2. **Dry run**: `sh scripts/ops/publish-public-repo.sh --check --list`. Read the list once in full. Fix anything the leak scan
   reports; never widen an exemption without a comment saying why.
3. **Create the organisation and repository on GitHub** (by hand, in the browser): organisation `burnticker` (or the name chosen),
   repository `burnticker`, public, empty (no README, no licence — the publish provides both). Enable branch protection on `main`
   and signed commits if you use them. Nothing in this monorepo does this step.
4. **Publish**: `sh scripts/ops/publish-public-repo.sh --tag --verify` (the first time add `--link-node-modules` for the local
   check, or run `npm install` in `../burnticker-public` first). Then, in `../burnticker-public`:
   `git init -b main && git add -A && git commit -m "Burnticker: first public publish (see CHANGELOG.md)" && git remote add origin
   git@github.com:<org>/burnticker.git && git push -u origin main`. Commit the monorepo too (the `--tag` entry in
   `docs/burnticker/CHANGELOG.md`), so the trust page shows the same entry the public root does.
5. **Set the URL**: put the repository URL into `config/burnticker/transparency.json` → `publicRepo.url`; republish (steps 2 and 4).
   The trust page then links every path it names to the public file.
6. **Every later publish** is the same `--check`, then `--tag --verify`, then `git add -A && git commit && git push` in the public
   tree. Never edit a file inside `../burnticker-public` by hand — it is emptied on the next publish; edit the monorepo.
7. **Each deploy of the program or the keeper**: append a hand-written entry to `docs/burnticker/CHANGELOG.md` with the program id,
   the deployed hash and the deploy transaction; publish.
8. **Reviews**: commit `docs/burnticker/reviews/checklist.md` BEFORE either review starts; add each report as delivered; update
   `howBuilt.reviews[].status/reportPath` and the bounty status in `transparency.json`; publish.

## 4. Privacy — what the site records about the people using it

Burnticker uses no third-party analytics, sets no tracking cookie and runs no fingerprinting. Two first-party records exist in the
registry's own database (`src/lib/burnticker/productStore.ts`):

- **Search misses** (`search_miss_counts`, `search_miss_days`). A search on the launch page that found no card is logged by the
  server. A search that showed cards that nobody used before the next search or leaving the page is reported by the page. They are
  kept as counts, one row per query per UTC day:
  - the query, folded to plain lowercase words (at most 80 characters; anything that looks like a wallet address, an e-mail address
    or a long number is dropped first);
  - how many times that day it found no card, and how many times it found cards nobody used (each count stops at 500);
  - the last UTC hour it was seen.

  At most 2,000 queries are kept for one day; past that only the day's totals go up. Counts are deleted after 90 days. Rows from the
  first version (`search_misses`, one row per miss) are kept as they were and no longer written.

  There is no IP address, no user or session id, no wallet and no cookie.
- **Time to launch** (`launch_timings`). When a creator asks for a launch bundle, the page sends how long each wizard step took.
  The steps are: entered the search, chose a card, reached the create screen, reached the review, pressed Launch. They are stored
  with the draft as seconds per step, never as clock times. They are sent with the bundle request only.

The summary (p50 / p90 per step, misses by query) is admin-only: `GET /api/burnticker/v1/ops/search-misses` answers only on the
operator's own network with the action PIN. A weekly markdown rollup comes from `scripts/burnticker-search-misses.mts`. Both exist to
find the searches the product cannot answer yet and the steps where people get stuck.
