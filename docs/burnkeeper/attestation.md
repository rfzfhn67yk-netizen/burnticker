# Third-party attestation — the off-chain side (2026-10-09)

Who, other than the keeper, says the feed read what the keeper says it read — and what a stranger can check without trusting us.
LAUNCHPAD-PATH §2 (trust ladder), §11 (Kalshi), §14 (selectors over resolution oracles), §17.4 (independent attestation before
strangers launch). Code: `src/lib/burnKeeper/attesters/`, `scripts/burnkeeper-attest-*.mts`, tests `test/burnKeeperAttest*.test.ts`.

**One fact first.** Switchboard Technology Labs announced on 2026-09-19 (X) that every Switchboard implementation was deprecated and
all oracle services ended on **2026-09-25** (reported by solanacompass, KuCoin News, TechFlow, CryptoTicker; "all implemented versions
are deprecated as of today"). Checked from this machine on 2026-10-09: `crossbar.switchboard.xyz` no longer resolves, the mainnet
gateway times out, `switchboard.xyz` serves nothing, the last npm release is 3.10.6 (2026-07-30). The on-chain programs and default
queues still exist on devnet and mainnet (getAccountInfo), with nobody feeding them. The Switchboard attester below is therefore built
and tested against the pinned SDK with a fake, and documented as the shape an oracle network plugs into — it cannot be the live second
signer for $DEFICIT today. The quorum-2 gate in the keeper is network-agnostic; **the open decision is who signer two is** (§6).

## 1. The attestation matrix

| Source kind | Example | Attester that applies | What a skeptic verifies | What stays trusted |
|---|---|---|---|---|
| First-party machine-readable API (tier 2) | Treasury Debt to the Penny (`$DEFICIT`), BLS, NOAA, LL2, JPL, Wikimedia | **Oracle network** running the exact job (URL + JSON path) — the Switchboard module; until a network is live, **a second operator** publishing the same reading under its own key (§6) | The job JSON ↔ feed hash on the account (`FeedHash.compute(queue, jobs)`), the result slot, each oracle's submission and that the oracles are on the queue; the memo's `now=` equals the source row (`curl` in every receipt) | The source itself; the oracle set's honesty (confidential runtimes constrain, do not prove); with a second operator: that operator |
| CFTC event contract (tier 1 in §14) | Kalshi settled `result` / `settlement_value` | **None independent yet.** Kalshi exposes settlement only through its own keyless API (no chain, no signature). Attest the API read the same way as a first-party API (oracle job on `GET /markets?series_ticker=…&status=settled`, or the second operator); cross-check the series' `settlement_source` | The settled market JSON (public, keyless), the series' `settlement_sources` primary document | Kalshi's adjudication; Kalshi's API availability (a delisted/voided series needs the declared fallback) |
| Prediction market with on-chain resolution | Polymarket (UMA → Gnosis CTF on Polygon) | **`polymarketOnchain.ts`**: `payoutNumerators[]` / `payoutDenominator` on `0x4D97…6045` by three `eth_call`s | The exact `eth_call` bytes (printed by the script as a `curl`); any Polygon node gives the same answer; `payoutDenominator > 0` = resolved, the single slot with the whole payout = the outcome | UMA's optimistic-oracle result (disputes resolve in UMA's DVM); the Polygon RPC you chose (use two) |
| Page-scraped (tier 5) | Box Office Mojo weekend #1 gross; Billboard Hot 100 #1 | **zkTLS (Reclaim) prototype** — `zktls.ts`: a Reclaim attestor proxies the TLS session and signs the claim (URL, method, regex, extracted values) | The claim identifier recomputed (`keccak256(provider\nparameters\ncanonical(context))`), the signer recovered from the EIP-191 signature and found in Reclaim's attestor registry, the URL and regex are the published ones, the value sits inside the signed context — all done by hand in `verifyReclaimProof` with viem, no Reclaim SDK | **One** attestor (Reclaim's), its registry, Reclaim's TEE claims (not checked here), the page's editorial number, the regex's selection (fails closed on a redesign) |

"Verified" above means recomputable from public bytes. Everything in the last column is a named party or document we point at.
No row is "trust us".

## 2. $DEFICIT: keeper + Switchboard, quorum 2 — the exact configuration

The job (printed by `scripts/burnkeeper-attest-switchboard.mts job`, recomputed in the tests from the pinned SDK):

```json
{ "tasks": [
  { "httpTask":      { "url": "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&sort=-record_date&page[size]=1" } },
  { "jsonParseTask": { "path": "$.data[0].tot_pub_debt_out_amt" } } ] }
```

| | devnet | mainnet-beta |
|---|---|---|
| job sha256 (prost canonical) | `b6ddb2ea59f7d0df3c054c767e0bf85255cd8e44c6f7f3d43238b72934b18625` | same |
| queue | `EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7` | `A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w` |
| program | `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2` | `SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv` |
| feed hash `FeedHash.compute(queue, [job])` | `cf7642613b1d611d69f4b4ff760e792734ff48f204cfd19d428b2a4cdc922fb9` | `b56707d200ad10801bfe738ba9312cfa8dc639a37b7473c4d0b3284ff9b37a23` |
| v2 canonical quote account (`orac1e…`) | `3ZanDQohmEpKVCWMKqMXcbDfJVwRSXH5f6ASkgwDWTLE` | `5j2QZaPmVwLXVJqPSVYEjg3NwmjSZgVMVKuGXurYB9jz` |

Feed config for a classic PullFeed (`create-feed`): `maxVariance 0` (one source, exact figure), `minResponses 1`, `minSampleSize 1` on
devnet / `3` on mainnet (three oracles must return the same row), `maxStaleness 1000` slots (≈ 7 min; the feed is pulled right before
the burn). The keeper then runs with:

```sh
BURNKEEPER_ATTESTER=switchboard:<feedPubkey>            # the PullFeed created above (or, with v2, the quote account once a JS decoder exists)
BURNKEEPER_ATTESTER_FEED_HASH=cf7642…2fb9               # the account must carry THIS feed hash, or the attester is refused
BURNKEEPER_ATTESTER_TOLERANCE_BPS=0                     # default: the Treasury figure is exact — a cent of difference is a disagreement
BURNKEEPER_ATTESTER_MAX_AGE_MIN=1440                    # default: Treasury posts once a business day
BURNKEEPER_ATTESTER_MAX_STALENESS_SLOTS=                # optional slot ceiling (needs the chain's current slot; the keeper passes it)
```

What the cycle does with it (`cycle.ts`, one declared change): at the single point per leg where something NEW would be signed — the
swap in buyback mode, the settle-and-burn in vault mode — it asks the gate (`attesters/gate.ts`). The gate reads the attester, applies
`compareAttested` (tolerance, age, slot) to the keeper's recorded figure for the date, records an agreement in the ledger's status table
(`attested|DEBT|treasury.debt_to_penny|<date>`) so it survives restarts, and when the attester's current value belongs to a newer
Treasury day it records THAT day and holds the older one unless it was attested earlier. A hold is `fail()` — backed off 15 s → 1 h,
the date stays planned, both figures in the log line `[attest] <date>: HELD — switchboard:<feed>: DISAGREES — attested X, keeper Y,
difference D beyond N bps`. Resolving and adopting transactions already sent is never gated. Dry runs report `waiting` and write nothing.
Without `BURNKEEPER_ATTESTER` the cycle is byte-for-byte the quorum-1 behaviour (tested).

## 3. What a verifier checks on a Switchboard feed

1. **The job is the published one**: `FeedHash.compute(queue, [job JSON above])` equals the account's `feedHash` (the script's `job`
   prints it; `attesters/switchboard.ts` pins it; the test recomputes it from `@switchboard-xyz/common@5.8.5`).
2. **The result**: `result.value` (i128 × 1e18 → `40305316210829.72`), `result.slot`, `result.minSlot…maxSlot`; the memo's `now=` must
   equal it. `scripts/burnkeeper-attest-switchboard.mts verify --feed <pk> --expect <memo now=>` does exactly this over RPC only.
3. **The oracles**: `submissions[]` whose `slot ≥ result.minSlot` are the samples behind the value; each `oracle` must be an oracle
   account on the queue (the queue account lists them). Signatures are checked by the Switchboard program when the update lands
   (classic: secp256k1 over the feed hash + value + slot; v2 managed: Ed25519 instructions beside the `verified_update`) — the account
   content is the on-chain record that the check passed; a verifier re-reads it, not the signatures.
4. **Freshness**: `lastUpdateTimestamp` and the slot distance to now (`verify` prints `nowSlot`).

Costs (when a network runs): account rent ≈ 0.02–0.03 SOL for a classic PullFeed (refundable on close); per update ≈ 20,000–100,000
lamports of oracle fee plus the transaction's ~5,000 lamports (3 signatures ≈ 0.0001 SOL at the quoted range); devnet free apart from
airdrops. Limits: HTTP job responses are capped in size and time by the oracle runtime; `maxStaleness` is in slots; a classic feed stores
32 submissions; v2 quote accounts have no stable JS account decoder yet (SDK note), so `readSwitchboardFeed` reads classic PullFeeds.

## 4. zkTLS prototype (Reclaim) — honest boundaries

- `scripts/burnkeeper-attest-zktls.mts verify <proof.json>` verifies **by hand**: identifier recomputation (RFC 8785 canonical context),
  EIP-191 signer recovery (viem), attestor registry membership (`https://api.reclaimprotocol.org/api/attestors`; `--offline` uses the
  three addresses pinned on 2026-10-09), URL pin for bundles, age ceiling. Exercised on Reclaim's own published sample proof
  (`test/fixtures/reclaim-sample-proof.json`): signer `0x2448…9072`, in the live registry → `ok: true`; six tamperings refused (test).
- `prove bom.weekend.top --period 2026W40` needs `@reclaimprotocol/zk-fetch` (not a dependency: attestor-core, snarkjs, native
  modules — install it in a scratch checkout) and `RECLAIM_APP_ID` / `RECLAIM_APP_SECRET` from https://dev.reclaimprotocol.org (New
  application → copy both). Read by name, never printed, never written into the bundle (tested with a fake SDK). No proof of the Box
  Office Mojo page was generated here — no credentials on this machine; the regex is tested on the saved rank-1 row
  (`test/fixtures/bom-weekend-2026W40-row1.html`: "Verity", $32,031,011, weekend 2026W40).
- Cryptographically verified: that a registered attestor signed this exact claim. Trusted: that attestor (ONE party), its registry,
  the page, the regex. A zkTLS attestation is a second signer, not a consensus; for a tier-5 feed that is the ceiling until two
  independent attestor networks exist. The TEE attestation Reclaim can attach (`teeAttestation`, GCP Confidential Space) is not checked
  by this prototype — listed, not claimed.

## 5. Polymarket — the chain is the resolution

`scripts/burnkeeper-attest-polymarket.mts read 253591` (gamma id, slug or condition id) → read live on 2026-10-09 at Polygon block
95,264,243: condition `0xdd22…0917` ("Will Donald Trump win the 2024 US Presidential Election?"), `outcomeSlotCount 2`,
`payoutDenominator 1`, `payoutNumerators [1, 0]` → `outcome 0 = Yes`; the script prints the `curl` that reproduces the denominator call.
The reader tries `1rpc.io/matic`, `polygon-rpc.com`, `publicnode`, `drpc` in order (only the first answered unauthenticated eth_calls
from here; gamma's `outcomePrices` are never used for the result). For a selector rule (§14) the receipt carries the condition id, the
block number and the payout vector; `onVoid` maps a split payout (`outcome: null`, e.g. `1/2, 1/2`).

## 6. Who is signer two for $DEFICIT — the decision this leaves open

Switchboard was the plan for "an oracle network that runs any HTTP job"; it is gone. Pyth and RedStone (its recommended successors)
publish price feeds, not arbitrary HTTP jobs. Realistic second signers now, in order of independence:

1. **A second operator** running the same keeper read on another machine/key and publishing `{feed, recordDate, value, observedAt}`
   signed (Ed25519) at a public URL — the `Attester` interface takes a 40-line adapter; the gate, logging and ledger memory are done.
   Independence = a different person; verification = their signature + the Treasury row.
2. **Self-hosted Switchboard stack** (the oracle and Crossbar are open source) — a network of one is a second operator with more moving
   parts; only worth it if a third party runs the oracle.
3. **zkTLS of the Treasury API itself** (the attester fetches the same URL) — mechanically works today with Reclaim credentials; the
   attestor is one company, but an unrelated one. This is the cheapest truly-independent option and needs no infrastructure of ours.

The Receipts program's `attesters[] / quorum` (being built) should accept any Ed25519 pubkey as an attester so options 1 and 3 (via a
relayer key) plug in without a Switchboard-specific account check.

## 7. Runbook

```sh
R=(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs)
"${R[@]}" scripts/burnkeeper-attest-switchboard.mts job                                   # hashes, offline
"${R[@]}" scripts/burnkeeper-attest-switchboard.mts create-feed --cluster devnet          # dry run (default); --send --payer <kp.json> needs the network
"${R[@]}" scripts/burnkeeper-attest-switchboard.mts verify --feed <pk> --expect 40305316210829.72 --cluster devnet
"${R[@]}" scripts/burnkeeper-attest-zktls.mts verify test/fixtures/reclaim-sample-proof.json [--offline]
"${R[@]}" scripts/burnkeeper-attest-zktls.mts extract test/fixtures/bom-weekend-2026W40-row1.html
"${R[@]}" scripts/burnkeeper-attest-polymarket.mts read 253591
"${R[@]}" --test test/burnKeeperAttestGate.test.ts test/burnKeeperAttestSwitchboard.test.ts test/burnKeeperAttestZkTls.test.ts test/burnKeeperAttestPolymarket.test.ts
```

Dependencies added (pinned, exact): `@switchboard-xyz/on-demand@3.10.6`, `@switchboard-xyz/common@5.8.5` (+ their tree: Anchor 0.31.1,
spl-token, axios…; loaded lazily — the keeper imports nothing of it unless `BURNKEEPER_ATTESTER` is set). `viem` (already present) does
the zkTLS hashing/recovery; Polymarket uses raw JSON-RPC.
