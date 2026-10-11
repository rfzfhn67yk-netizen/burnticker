# Burnticker

**Coins that burn on real-world results — with receipts.** Launch one. Follow the season.

Burnticker is an open launchpad for memecoins whose supply burns when a settled real-world result says so. Every burn leaves a receipt
that anyone can recompute from the source. The receipt is the product; nothing is ever won — things are only burned.

**The engine.** A creator writes the result in one sentence. It can come from a first-party data feed (Treasury, BLS, ESPN, NWS and
others, each cross-read by a second publisher) or from the on-chain payout of an adjudicated Polymarket market; prediction markets are
otherwise for discovery. The creator maps outcomes to burns and launches on Raydium LaunchLab under Burnticker's platform config. The
rule is hashed on chain at create and can never change. A keeper reads the settled result, signs it, and cranks `crank_buyback` on the
`burn_receipts` program. The coin's fee pool buys the coin on its own pool and burns everything it receives, writing a memo that names
the event, the source, the reading, the amounts and the rule hash. The rule is enforced by a program, not a promise.

**The show.** Team coins across MLB, NBA, NHL and NFL and rivalry pairs, scored by the same receipts. A season is a scoreboard of
burns, one per league and season; when a season ends, the coin with the most receipts is its league's champion, a stat and never a
recipient. The token page recomputes every receipt from the
source. The audit script does it for every token and exits non-zero on a mismatch, and the trust page shows the result.

**Guardrails.** Settled on primary sources · signed readings (one attester at launch; second attester scheduled, not live) · program-run burns · receipts anyone can recompute · open source ·
three blind AI reviews, not a firm audit · creators earn nothing · no team buy · the platform never buys any coin · all LP burned · rules locked at launch.

**Operated by one independent operator (United States).** This repository is the public, buildable copy of everything the platform runs: the on-chain
program, the keeper, the platform, the sites, the deploy files, the docs, the tests. It is carved out of a private monorepo by an
explicit allowlist (`config/public-repo.allowlist`); the operator's unrelated trading software never leaves that monorepo, and the
scan that enforces it is here too (`config/public-repo.denypatterns`, `scripts/ops/publish-public-repo.sh`). The trust page
(`/burnticker/trust`, data in `config/burnticker/transparency.json`) lists every wallet, every power, the decision log, the incident
log, the changelog, the known limitations — and that this code was written with AI assistance and reviewed by AI tooling and a
public bounty, **not audited by a security firm**.

Nothing here is investment advice. A memecoin can go to zero. The rule says what supply does, not what price does.

## What is where

```
programs/burn-receipts/     the Anchor program: initialize_token, submit_reading (N-of-M ed25519 attesters), crank_buyback /
                            crank_vault / crank_no_units, register_pool, the 48 h timelocked attester and cap changes, renounces.
                            scripts/powers-register.mjs generates docs/burn-receipts/powers-register.{json,md} from the IDL.
src/lib/burnReceipts/       the TypeScript client of the program (accounts, PDAs, instructions, memo, math, IDL coder)
src/lib/burnKeeper/         the $DEFICIT keeper: Treasury feed, rules, plan, cycle, LaunchLab builders, attesters (zkTLS, Polymarket
                            on-chain; the Switchboard attester is built against a pinned SDK of a service that has shut down)
src/lib/burnticker/         the platform: rules (selector + mapping), units, receipts, catalogue of first-party
                            sources, prediction-market discovery adapters (one for a US prediction exchange: not used; its terms do
                            not permit it), append-only registry (SQLite triggers), multi-token keeper, token pages, fees, trust page,
                            audit
src/app/burnticker/         the Next.js pages: index, launch wizard, token page, trust page
src/app/api/burnticker/     the API routes the pages call
src/lib/ownTokens.ts        THE REFUSE LIST reader the operator's trading bots use — they refuse every platform coin by mint and ticker
config/own-tokens.json      the list itself
config/burnticker/          sources.json (the first-party catalogue), refuse.json, transparency.json, fixtures/
config/burnkeeper/          the $DEFICIT rule file
scripts/                    burnticker-keeper.mts, burnticker-audit.mts, burnticker-platform-config.mts (dry run only),
                            burn-keeper.mts ($DEFICIT), burnkeeper-launch.mts, burnkeeper-keygen.mjs, attester runners
site/                       the static sites and brand assets (see Licence)
deploy/                     the Caddyfile and the systemd unit for the $DEFICIT keeper
docs/                       burn-receipts/ (program + powers register), burnkeeper/ (fees, attestation, devnet), burnticker/
                            (README, deploy, incidents, decisions, CHANGELOG, reviews/, transparency), launch/ (X drafts)
test/                       node:test suites on real fixtures; nothing touches a network
```

## How to verify a receipt

Every burn writes a memo on chain, from the program (`programs/burn-receipts/programs/burn_receipts/src/memo.rs`): v2 for a buyback,
`<PREFIX>|<date>|src=|prev=|now=|delta=|units=|pool=|spent=|got=|burn=|swap=|rules=sha256:<12>|v2`, and v1 for a vault burn. The
platform also publishes a per-event receipt line on each token page, `BT|TICKER|id|oracle=|market=|result=|settled=|src=|value=|…|v3`
(`src/lib/burnticker/receipt.ts`); the current program does not write that one on chain. To check a burn yourself:

1. Open the transaction on an explorer and read the memo.
2. Fetch the rule: the token page serves `rules.json`; `sha256` of its canonical bytes must equal the `rules=` field
   (`src/lib/burnticker/rules.ts`, `rulesSha256`).
3. Fetch the source named in `src=` (the first-party API, or the on-chain Polymarket payout) and confirm the reading (`prev=` /
   `now=` in the memo; `result=` / `value=` on the page's v3 receipt).
4. Recompute the units from the rule and the reading (`src/lib/burnticker/units.ts`), then the spend:
   `spent = pool × (1 − (1 − f)^units)` with the integer formula in `src/lib/burnKeeper/rules.ts` (`buybackSpend`).
5. Confirm from the transaction's token balances that every token the fee PDA received was burned.

`npm run audit` does steps 2–5 for every receipt of every token and exits non-zero on any mismatch.

## How to run

Node 22.6+ (TypeScript runs natively; no build step for the keeper). `npm install`, then:

```sh
npm test                 # the suites, on fixtures
npm run typecheck        # tsc over src, scripts and tests
npm run keeper -- --once --dry-run            # the multi-token keeper: read, plan, log; sign nothing
npm run keeper:deficit -- --once --dry-run    # the $DEFICIT keeper
npm run audit            # recompute every receipt; exit 1 on a mismatch
npm run powers-register  # fail if the committed Powers Register is stale against the IDL
npm run dev              # the Next app on http://localhost:3000/burnticker
```

Environment variable names are listed in `docs/burnticker/deploy.md` and `deploy/systemd/mct-burnkeeper.service`. The keeper's key is
read from a file OUTSIDE the repository (`src/lib/burnKeeper/keyfile.ts`; make one with `npm run keygen`); mainnet is refused unless
two independent variables agree. The systemd unit references a host wrapper (`scripts/service/run-burnkeeper.sh`) that only loads the
host's environment and passphrase before running `scripts/burn-keeper.mts`; it is not part of this tree — the command it runs is.

### The program

`programs/burn-receipts/` builds with Anchor (`anchor build`; `rust-toolchain.toml` pins the toolchain). `programs/burn-receipts/
scripts/sync-idl.mjs` copies the IDL into `src/lib/burnReceipts/idl.ts`; `powers-register.mjs --check` fails if the register does not
describe every instruction and signer. `test/burnReceiptsLocalnet.test.ts` runs the client end to end on a local validator when
`BURN_RECEIPTS_LOCALNET=1` and the built `.so` files exist. A deployed program is verified against a tagged commit of this
repository with `solana-verify` / `anchor verify`; `CHANGELOG.md` records the commit and program hash of every publish.

## How to audit this platform

- **Powers**: `docs/burn-receipts/powers-register.md` — every instruction, who may call it, what it can and cannot do, timelock,
  sunset. Generated from the IDL; `npm run powers-register` proves it is current. "What does not exist" is the section to read first.
- **Money**: `docs/burnkeeper/fees.md` and `src/lib/burnticker/fees.ts` — the designed split; the trust page compares it with the
  live `PlatformConfig` decoded from chain and lists the developer wallet's full ledger from chain.
- **Readings**: settled results only; prices are never read into a rule (`src/lib/burnticker/oracle/polymarket.ts`; the
  US prediction exchange's adapter in `oracle/` is not used — its terms do not permit it — and stays behind a flag that is off; tests in
  `test/burntickerOracle.test.ts`). The registry refuses updates and deletes at the SQL level (`src/lib/burnticker/registry.ts`).
- **Operator**: `config/burnticker/transparency.json` and `docs/burnticker/decisions.md`.
- **Reviews and bounty**: `docs/burnticker/reviews/` and `SECURITY.md`.

## Licence

Code: [MIT](LICENSE), © 2026 Burnticker.

**Brand assets are not licensed for reuse.** The names Burnticker and $DEFICIT, the wordmarks, avatars, headers, Open Graph images,
favicons and the brand concept files under `site/burnticker/brand/`, `site/deficit/` (image and SVG files) and `site/brand-concepts/`
are published so the platform's identity can be verified, not copied. Fork the code; do not present a fork as Burnticker.
