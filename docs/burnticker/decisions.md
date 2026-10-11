# Burnticker decision log

Append-only. One `## YYYY-MM-DD — title` heading per decision, in the order they were taken; a reversal is a new entry that names
the one it reverses. Facts only — what was decided, by whom, and why where a reason was given. Rendered verbatim on /burnticker/trust.
Source for the 2026-10-09 entries: the owner's working notes of that day (LAUNCHPAD-PATH §13–§21).

## 2026-10-09 — Name: Burnticker

The platform is named Burnticker. Checked that day: @burnticker free on X; burnticker.com/.xyz/.io/.so/.wtf free (RDAP). Runners-up
were Burnwire and Burnpress. The owner creates the X account and registers the domain; nothing is created by automation.

## 2026-10-09 — Open event space: selectors over resolution oracles replace the curated feed list

A rule is a selector plus an outcome→burn mapping, locked at launch and applied to markets that do not exist yet
(oracle · series/market · filter · binary|scalar · onYes/onNo or unit/perUnit/baseline/direction · onVoid=skip). Kalshi's public,
keyless API is the primary oracle — settled and finalized results and settlement values only, never prices; the series' settlement
source URL goes in the receipt; back-tests run on Kalshi's own settled history; the live market-implied chance of the next burn is
shown for display only. Polymarket (UMA) is stubbed as oracle #2. First-party feeds (Treasury, BLS, NOAA, LL2, JPL, Wikimedia) are
tier 2 for things no market covers. Refused regardless of oracle: deaths, violence, terror, casualty counts, named private
individuals. Elections are allowed. The event-contract disclosure goes on every oracle-backed page. Left open that day: Kalshi API
terms; legal posture (no lawyer, by decision); who the second attester is before strangers launch.

## 2026-10-09 — Fees: creators earn no cash; the developer takes 25 bps of curve volume

Human creators earn no cash from trading fees: LaunchLab's creator-fee slot always pays the token's burn pool, 100%, not
creator-configurable. The developer (Burnticker) slice is 25 bps of curve volume through the platform-fee slot, paid to the public
developer wallet. $DEFICIT launches under Burnticker's own platform config, not Raydium's default.

## 2026-10-09 — LP: all graduation LP is burned, for every coin

Platform config `lp-platform-pct 0`, not creator-configurable. Consequence: the developer's post-graduation take is 0; the burn pool
still receives Raydium's fixed CPMM creator fee (4.75 bps per SOL after the 5% protocol share). Verified dials: curve = Raydium 25 +
Burnticker 25 + burn pool 50 = 100 bps (docs/burnkeeper/fees.md).

## 2026-10-09 — Clean-platform standard ("no suspicion of me being corrupt")

Every power the operator holds is removed, locked behind a public timelock/multisig, or listed in a public Powers Register with the
reason it exists and the date it goes away. Specifically: no privileged access to any coin (no mint/freeze authority after create,
no withdraw or sweep on burn pools, no admin override of readings, no pause that can trap funds); immutable rules and code (rule hash
on chain at create, reproducible build with the hash published, upgrade authority behind a 48 h timelocked multisig at launch and
renounced after audit, platform-config admin behind the same, fee bps read live from chain on every page); economics in the open
(one labelled developer wallet with a public ledger, zero team allocation, every operator wallet that touches a platform coin
listed, bots refuse platform coins, seed deposits are gifts, no referral kickbacks or hidden fees or creator cash); independent
attestation (readings signed and posted before any burn, second attester and quorum 2 before strangers launch, every page recomputes
every burn, mismatch = red + public alarm); no history edits (append-only ledger, public incident log, corrections in public with the
receipt); marketing hygiene (no paid promotion, no price talk, no countdowns, disclaimer on every surface, no amplifying
return-marketing, a named operator with a contact address); and the Powers Register page generated from the program IDL and the
platform config — if it is not on the register, it cannot be done.

## 2026-10-09 — Decisions batch ("yes to all")

$DEFICIT: fractionPerUnit 1%; a 3 SOL seed to the burn pool, a disclosed gift; no team buy; launch on a weekday 08–09 Denver;
metadata name/symbol DEFICIT, description = rule sentence + disclaimer + rules hash. Platform: refuse list as above; elections
allowed; anonymous creators allowed with the creator wallet always shown; one-shot markets allowed; pre-audit cap 25 SOL per burn
pool with the excess queued, on the register with a sunset. Custody: Squads 2-of-3 (owner hardware key, owner second key, a trusted
third), 48 h timelock on fee changes and upgrades. Operator line: a contact address (the real name and state were removed on 2026-10-10 — exposure; see that entry) (which
one: TODO). A use-of-fees statement on the trust page (attesters, hosting, audit, operator; the platform never buys back any coin).
Sequencing: launch at level 1 (quorum 1), attester #2 within 14 days with the due date on the register; hosting on one VPS behind
Caddy with Cloudflare DNS; a devnet rehearsal the first weekday morning after the program merges. No platform coin until at least
ten coins have launched.

## 2026-10-09 — Audit: no paid audit; two independent AI reviews plus a public bounty

Two adversarial reviews (a fresh Claude agent given code only, not the builder's conclusions; ChatGPT with the same pre-registered
checklist) plus free tooling (cargo-audit, clippy pedantic, anchor verify, Trident/fuzz where feasible, Sec3 X-ray free tier).
Findings are fixed and both reports are published in full on the trust page. The Powers Register says plainly: reviewed by AI
tooling and public bounty — not independently audited by a security firm. The 25 SOL pre-audit cap stays until an independent
audit or a dated sunset the owner sets. A bug bounty of 5–10 SOL, paid from fees, is published with the reports.

## 2026-10-09 — Switchboard is gone; attester #2 becomes zkTLS and/or a second human operator

Found that evening: Switchboard Technology Labs ended all oracle services on 2026-09-25 (crossbar and gateways down; programs on
chain but unfed). The Switchboard attester is built against the pinned SDK and cannot run live. Replacement for "Switchboard within
14 days": signer two = a Reclaim zkTLS proof of the source API response posted by a relayer key (the `prove` step is ready; needs
Reclaim app credentials), and/or a second human operator running the reader on another machine against the Attester interface. The
program's attester model is generic ed25519 keys with a quorum. Verified live that day: Reclaim's sample proof verifies against the
live attestor registry; Polymarket on-chain resolution reads work on Polygon.

## 2026-10-09 — Total transparency ("i dont want to hide anything")

Beyond the clean-platform standard: (a) the program, keeper, platform and sites are open source in a public repository, carved out
of the private monorepo by an allowlist sync — the trading code never leaves — and every deploy is tagged with the program hash;
(b) the trust page carries every operator wallet (ops, deployer, keeper, developer fee, Squads members, the mint keypair's public
key), the fact that the operator also runs trading bots and that those bots refuse platform coins with a link to the code, that
the code was written with AI assistance and reviewed by AI and a bounty rather than a firm, both review reports in full, this
decision log, the incident log, the Switchboard failure and the current attester status, and a changelog of every deploy; (c) on X,
no deletions — corrections in-thread with the receipt; (d) nothing is announced as coming later: if it is not built, the page says it is
not built.

## 2026-10-09 — Public-repo carve-out and this page

Built the same night: `scripts/ops/publish-public-repo.sh` with an explicit allowlist (`config/public-repo.allowlist`) and a
leak-pattern file (`config/public-repo.denypatterns`); the check mode fails on any copied file that imports from outside the
allowlist or matches a pattern. Three small modules were split so the keeper and the routes import no private code: the same-origin
check (`src/lib/sameOrigin.ts`), the keeper's key-file reader (`src/lib/burnKeeper/keyfile.ts`, same encrypted format as before)
and the keeper's Jupiter client (`src/lib/burnKeeper/jupiterSwap.ts`). The trust page gained the sections this log sits in; their
data is `config/burnticker/transparency.json`. The repository itself is not created yet (owner step).

## 2026-10-10 — $DEFICIT burns 2 % of the burn pool per $1B unit (was 1 %)

Owner: *"maybe we do 2% since that's the target for inflation."* The rule file `config/burnkeeper/deficit.rules.json` now carries
`fractionPerUnit` 0.02 (statement: `1 - 0.98^units`); its sha256 is `78f4c327552e42080ffe18830785fada399a882d0347793f881c7a8d35d2be58`.
Why 2 and not more: total burned over the coin's life equals fee income plus the seed at any fraction — the fraction only sets the
buffer (≈ 9 days of inflow at 2 % with ~6 units/day, versus ≈ 17 at 1 % and ≈ 2 at 10 %) and how strongly a big debt day out-burns a
small one. The devnet rehearsal coin stays at 1 % (`deficit.devnet.rules.json`); it was launched with that hash. Immutable once the
mainnet token is initialised.

## 2026-10-10 (late) — the operator's name and state leave every public surface

Owner decision ("too much exposure"). The operator line, the whitepaper, the operator page and `.well-known`, the README, the licence,
the incident template, the GTM drafts and the post generator now say "one independent operator (United States) — contact:
contact@burnticker.com"; security reports go to security@burnticker.com. The signed operator statement binds the developer-fee
wallet to "the operator of burnticker.com" rather than to a person. The identity is held privately until a legal entity exists;
the entity, when formed, becomes the named party on /burnticker/operator. Nothing else about the trust pack changes: the wallets,
the never-buys monitor, the reviews, the bounty and the verified build are unchanged. Tests pin the absence of the name on the
operator line and in generated posts.
