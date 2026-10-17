# How the keepers execute burns — program vs legacy (2026-10-10)

Both keepers — the $DEFICIT keeper (`scripts/burn-keeper.mts`) and the Burnticker multi-token keeper (`scripts/burnticker-keeper.mts`) —
now drive the on-chain **burn_receipts** program (`docs/burn-receipts/README.md`) instead of swapping and burning from their own wallets.
The keeper attests the public number and pays transaction fees; the program holds the burn pool (the fee PDA), computes every amount,
swaps, burns and writes the memo in one instruction. **Status: engineering build. Fake-program tests and a localnet end-to-end pass; nothing
has run on devnet or mainnet** (see "What is left for the devnet rehearsal").

| File | Role |
|---|---|
| `src/lib/burnKeeper/programPort.ts` | the `ProgramPort` interface and its views — types only, no imports (the public SDK names it through `FakeBurnProgram`) |
| `src/lib/burnKeeper/programChain.ts` | the executor (`executeProgramPending`, re-exporting the port types), wait reasons, the mode switch (`executionModeFromEnv`, `legacyRefusal`, `configRefusal`). Imports no transaction builder. |
| `src/lib/burnKeeper/programAdapter.ts` | `solanaProgramPort` — the **only** file on the keeper side that builds, signs or decodes program transactions (over `src/lib/burnReceipts`). Client changes land here as an adapter swap. |
| `src/lib/burnKeeper/fakeProgram.ts` | `FakeProgram` — the program in memory (the program's own math mirror), used by the tests and by Burnticker pages before a deployment |
| `src/lib/burnticker/program.ts` | the `BurnProgramClient` interface, `FakeBurnProgram`, the **unit-counter** mapping for event rules (in the public SDK's closure) |
| `src/lib/burnticker/programClient.ts` | `ProgramBurnClient` — the real client (per-token ports from the adapter; read-only without a key); kept out of the SDK closure |
| `src/lib/burnticker/multiKeeper.ts` | the Burnticker executor (day aggregation → counter readings → cranks), registry rows take the program's facts |

## 1. The mode switch ($DEFICIT keeper)

`BURNKEEPER_EXECUTION=program | legacy`. Default: **program when `BURNTICKER_PROGRAM_ID` is set**, legacy otherwise. Any other value is
refused at start.

- **program** — needs `BURNTICKER_PROGRAM_ID`, `BURNKEEPER_RPC_URL` (or `--devnet`), `BURNKEEPER_MINT`, the keeper key
  (`BURNKEEPER_SIGNER_PATH`). Refuses to start when the mint has no TokenConfig (initialize_token first), and refuses every cycle when the
  config's `rules_sha256` ≠ the rule file's sha256, its mode ≠ the file's mode, its memo prefix ≠ the file's, or its value decimals ≠ 2
  (Treasury cents). A ledger that already holds legacy burns is refused (program execution needs a fresh `BURNKEEPER_DB`; the ledger
  identity's `vault` is `program:<program id>:<fee PDA>`, so a legacy ledger cannot be reused by accident).
- **legacy** — the keeper's own legs (cycle.ts + solanaChain.ts): vault-mode burns from `BURNKEEPER_VAULT`, or the **DEPRECATED** Jupiter
  buyback from the keeper's own SOL. Logged as deprecated at start. It **refuses to run** (programChain.ts `legacyRefusal`) when, in buyback
  mode, (a) the mint has a TokenConfig under `BURNTICKER_PROGRAM_ID`, (b) the LaunchLab creator is the program's fee PDA, (c) the LaunchLab
  creator is any off-curve (program) address, or (d) `BURNKEEPER_CLAIM_CREATOR_FEES=1` is set — the creator fees belong to the fee PDA and only
  `crank_buyback` can spend them. Legacy is for vault-mode-only and dev tokens. `--announce-rules` is a legacy step (in program mode the sha is
  in the TokenConfig and in every memo the program writes).

The Burnticker keeper has no legacy leg: with `BURNTICKER_PROGRAM_ID` + `BURNTICKER_RPC_URL` it uses `ProgramBurnClient` with the key at
`BURNTICKER_SIGNER_PATH` (default `~/.config/meme-coin-trader/signer-burnticker.enc.json`; the treasury's key file names are refused;
mainnet needs `BURNTICKER_MAINNET=1`); otherwise the `FakeBurnProgram` (nothing sent; the log and pages say FAKE). The app server builds a
**read-only** `ProgramBurnClient` (no key on that host) when both env vars are set.

## 2. The exact per-day sequence (program execution, $DEFICIT)

Every cycle (the loop wakes at the Treasury poll times, on retries, and at least every 15 min):

1. **Poll and plan** the Treasury feed into the ledger exactly as before (`ingest`): readings rows for every validated date, a burns row for
   every date the off-chain rule counts units on.
2. **Read the TokenConfig** (`config()`); refuse on a mismatch (above).
3. **Attest** every ledger reading with a date after the config's `last_record_date`, oldest first (the first one becomes the program's
   baseline when the config has none):
   - resolve any earlier `submit_reading` signature for the date first (landed → adopted; may still land → wait; failed/expired → go on);
   - check the quorum: the config's attesters ∩ the keys this keeper holds must be ≥ `quorum` — otherwise the reading is **held as
     quorum-short** (nothing signed) and the status page says so;
   - the optional off-chain second attester (`BURNKEEPER_ATTESTER`) still gates burn days;
   - build the canonical message
     `BURNRECEIPTS-v3|<cluster genesis>|<program id>|<mint>|<feed id>|prev=<previous on-chain date or none>|<YYYY-MM-DD>|<value, 2 decimals>|src=<sha256 hex>|proof=<64 zeros>`
     (the genesis is the TokenConfig's `cluster_genesis`; on devnet/mainnet the adapter refuses to sign if it differs from the RPC's,
     and it never signs a mainnet-bound message off mainnet — review-3 I-1: local validators run the `--features localnet` build)
     where `src` is sha256 of the **exact** row URL `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&filter=record_date:eq:<YYYY-MM-DD>`
     (`feeds/treasury.ts rowUrl`), sign it with the keeper's ed25519 key(s), pack `[ComputeBudget, Ed25519SigVerify (ONE shared message,
     one entry per key), submit_reading]` — a legacy transaction (966 / 1,076 / 1,186 bytes for 1 / 2 / 3 keys), or v0 through a lookup
     table if it ever would not fit. A process signs with at most `maxLocalAttesters` keys (default 1; quorum ≤ 3);
   - **simulate** → write the signature to the ledger (`signatures.kind = reading`, the signed message as its memo; `program_readings`
     row `sent`) → send → confirm by polling (rebroadcast every 4 s) → read the Reading account back: `program_readings` records the kind and
     the units **the program** counted. `QuorumNotMet` in simulation = quorum short; any other refusal = an error with backoff.
4. **Feed the pool** (buyback, only when a burn day is pending, best-effort, never fatal): `claim_launchlab_creator_fee` when LaunchLab's
   `[fee PDA, WSOL]` creator-fee vault exists (curve fees → the fee PDA's WSOL ATA); `collect_creator_fee_permissionless` once graduated
   (creatorFees.ts plan: pool_creator must be the fee PDA). Each is simulated first; notes go to the log and the status page.
5. **check_pool_health** once per cycle (buyback, pool registered); the TokenConfig's `pool_untradeable_since` is shown.
6. **Adopt** pending burn days the chain already processed (cranking is permissionless; a lost confirmation): the crank transaction is the
   ledger's landed signature or the newest `crank_*` transaction on the Reading PDA. A burn day whose date never reached the program and
   is now older than the last on-chain reading is marked skipped (dates only move forward; the next reading's delta absorbed it).
7. **Crank** in order (up to 30 per cycle): `planCrank` picks `crank_no_units` / `crank_vault` / `crank_buyback` for the next reading in
   line; resolve earlier crank signatures for the date (landed → adopt; may still land → wait — **nothing new is signed** while one could
   still land); sign only now; **simulate**:
   - `TwapUnavailable`, `TwapDeviation`, `PoolNotTradable`, `EmptyReserves`, and "no pool registered" → a **WAIT**: the burns row stays
     `planned` with `wait_reason`, no error, no attempt counted, retried every 10 min;
   - any other refusal → an error with the usual backoff (15 s doubling to 1 h);
   - otherwise write the signature ahead (`signatures.kind = crank`, the row → `sending`) → send → confirm → read the Reading account:
     the row records `chain_outcome`, `chain_units`, `pool_lamports` (the basis), `pool_actual_lamports`, `rule_spend_lamports`,
     `carried_in/out_lamports`, `spend_lamports`, `got_raw`, `burn_raw`, `owed_raw`, `short_out_raw`, `swap_pool` and the memo **the
     program wrote** (from the transaction's logs). burned / short → `confirmed`; below-floor / no-units → `skipped` (with the program's
     reason); exhausted → `exhausted`.
   - **Partial days** are the program's own: `SpendCapBound` (one crank spends ≤ 2 % of the pool's WSOL reserve; the rest is carried
     into the next crank — `carried_out_lamports > 0`) and `BurnPoolCapBound` (`pool_actual_lamports > pool_lamports`, the 25 SOL pre-audit
     cap). Both are recorded and shown as "partial", never as errors.
8. **Publish**: status.json gains `execution: "program"` and a `program` block — attesters (keys, kinds, which the keeper holds), quorum,
   the last reading's transaction, a held reading and why, the queue (last on-chain date, crank cursor, burn days not yet attested /
   waiting for a crank, carried spend, waits, partial days), pool registration and health, program totals, the last claim notes. The burns
   table verifies program days against the program's own fixed-point rule spend (`src/lib/burnReceipts/math.ts`) and the memo.

`data/PAUSE-burnkeeper` holds readings and cranks (polling and publishing go on). Dry run attests and cranks nothing.

## 3. What the keeper signs — and what it cannot do

The keeper key signs exactly two things: the **attestation** (an ed25519 signature over the canonical message above — its only power is
to be one of the config's attesters) and, as fee payer, the **transactions** `submit_reading`, `crank_*`, `claim_launchlab_creator_fee`,
`collect_creator_fee_permissionless`, `check_pool_health`. It holds no funds of the token: the fee PDA has no withdraw path, the crank
computes every amount, `min_out` and the TWAP guard are the program's, and the memo is written by the program. The keeper's ledger
records what landed; it never fixes an amount in advance.

**Anyone else** can: crank any reading in line (all `crank_*` are permissionless — the keeper adopts it), `register_pool` after
graduation, `check_pool_health`, `replace_pool` after 7 days of recorded untradeability, claim or collect creator fees into the fee PDA,
deposit SOL into the fee PDA, and recompute every reading, rule spend and memo from the accounts and the Treasury row. Nobody can submit a
reading without the attesters' quorum, and nobody can move the fee PDA's SOL except `crank_buyback`.

## 4. Burnticker: event rules on the program — the unit counter

The program's reading model is one value per UTC date with `units = floor(delta / unit_value)` and one fraction (or token count) per
unit. Burnticker rules read settled events; the keeper's unit engine computes each receipt's units from the published rule. Each
Burnticker TokenConfig is therefore initialised (`counterRule`) with `value_decimals 0`, `unit_value 1`, carry none, `max_abs_delta 1,000,000`,
feed id `bt.units:<TICKER>`, memo prefix = the ticker, `rules_sha256` = the registry's rule hash, the fraction in bps (or tokens per unit
and the vault allocation), and the attested value is a **counter**:

    value(D) = 1 + every unit the token's settled receipts carried through reading date D      (the program refuses 0)

- A Kalshi day is read only after the UTC day is over plus a 1 h grace **and** after the selector was fetched following the day's end;
  catalogue feeds (one period per reading) are read at once. All of a day's receipts are counted into one reading → **one crank**.
- The baseline reading is the day before launch, value 1. A receipt that arrives late (its day already on chain) is counted into the next
  reading.
- The signed `src` hash commits to the exact receipts counted: sha256 of `burnticker://<TICKER>/units/<YYYY-MM-DD>?events=<id,id,…>`.
- Registry rows: each receipt records the `reading_date` it was counted into (written once; a trigger refuses a second assignment). The
  **lead** receipt of a reading carries the program's amounts (pool, rule spend, carried spend, spent, got, burned, shortfall) and the
  program's memo; the others carry the same signature and memo with zero amounts, so totals count each burn once.
- **Not expressible on the current program:** a rule that pays **different** fractions (or token counts) per outcome — e.g. onYes 2 %,
  onNo 1 %. `programExpressible` says why; the launch bundle lists it as pending and the keeper holds such receipts (never fakes them).
  Expressing it needs per-outcome readings (a program change).

## 5. What runs where

| Path | Fakes (`npm test`) | Localnet (`BURN_RECEIPTS_LOCALNET=1`, `test/burnReceiptsLocalnet.test.ts`) |
|---|---|---|
| readings attested in order, units counted by the program | ✔ (`burnKeeperProgram.test.ts`) | ✔ (vault + buyback) |
| quorum short (held, nothing signed) / `QuorumNotMet` | ✔ | ✔ (2-of-2 with one key held → quorum-short) |
| quorum 2–3 with all keys held locally: shared-message reading fits a legacy transaction, every key counted | ✔ (2 and 3) | ✔ (quorum 2, two local keys, vault crank burns) |
| admin CLI (`scripts/burnreceipts-admin.mts`): initialize_token dry run (pinned sha, resulting TokenConfig) and send | — | ✔ |
| `WsolBalanceMismatch` → wait; stray lamport on the fee WSOL account synced into the pool; Reading records its pool | ✔ | SyncNative rides in every buyback crank plan |
| dead pool: daily check_pool_health keeps the spell continuous; day 30 → below-floor with the target carried | ✔ | — (LiteSVM `review2.rs` covers the program) |
| crank_vault with shortfall, memo = `memoFromChain` | ✔ | ✔ |
| crank_buyback burned, rule spend / carried spend / caps recorded | ✔ (spend cap, burn-pool cap, below floor) | defers — see next row |
| crank deferred `TwapUnavailable` → wait, no error, no SOL moved | ✔ | ✔ (a fresh pool has no 600 s of oracle history; the swap path itself is covered by the LiteSVM suite) |
| no pool registered → wait; register_pool; check_pool_health | ✔ | ✔ |
| creator-fee claims best-effort (throwing / notes / WSOL counted) | ✔ | ✔ (no LaunchLab on localnet → note, crank goes on) |
| write-ahead crank survives a dropped send; expired re-signed; stranger's crank adopted | ✔ | — |
| crank_no_units for an out-of-line zero-unit reading | ✔ | — |
| Burnticker counter: day aggregation, lead/follower rows, vault, floor, quorum, not-expressible | ✔ (`burntickerKeeper.test.ts`, `burntickerPairs.test.ts`) | — |

## 6. What is left for the devnet rehearsal

- **Deploy** burn_receipts to devnet (`anchor build -- --features devnet`), `initialize_token` for the rehearsal mint with the keeper's
  devnet key as the only attester (quorum 1), and run the keeper with `BURNKEEPER_EXECUTION=program`; fill `devnet-run.md` §4.
- **The swap path on a real validator**: localnet cannot fast-forward 600 s of CPMM oracle history, so `crank_buyback` actually buying
  has only run in LiteSVM. On devnet, trade the pool for ≥ 10–20 min after `register_pool` and confirm the first burned crank records the
  Reading's facts and a green verify block.
- **LaunchLab**: `claim_launchlab_creator_fee` against the real devnet LaunchLab (only a stand-in has run), and whether LaunchLab's
  migration sets `pool_creator` = the fee PDA, creates the pool at its platform's `cpConfigId` PDA and locks/burns the LP — all three
  are required by `register_pool` since the second blind review (localnet preloads LaunchLab's pool + platform accounts to stand in).
- **Client changes from the second blind review** (2026-10-10) are LANDED in `programAdapter.ts` / `fakeProgram.ts`: SyncNative in
  every buyback crank plan and the client's deferrable errors (incl. `WsolBalanceMismatch`) as `retryableErrors`; one shared-message
  Ed25519 instruction per reading, transactions sized by `buildSizedTransaction` (legacy ≤ 1,232 bytes, else v0 + `lookupTable`); the
  v3 message with the cluster genesis; memos from the program's own Memo CPI; `ProgramReadingView.pool`; quorum ≤ 3. The keeper still
  signs with ONE key per process by default (`maxLocalAttesters`), until an off-machine attester exists.
- **Burnticker on devnet**: a counter token end to end (initialize_token from the launch bundle → a settled Kalshi day → reading → crank),
  and a decision on rules with per-outcome fractions (program change or launch-time refusal, which is what happens today).

## Burn dispersal (owner decision 2026-10-13; built, not deployed)

A reading's crank spends at most 2 % of the pool's WSOL reserve and carries the rest (`carried_spend_lamports`). The program's new
permissionless `crank_carried(max_spend_lamports)` (round 5, `instructions/crank_carried.rs`; refused while a reading waits for its own
crank) spends a piece of that carried amount without a new reading. Both keepers drain it the same way (`src/lib/burnticker/dispersal.ts`
plans, `src/lib/burnticker/dispersalKeeper.ts` executes):

- pieces of at most min(2 % of the reserve, 1.227 % of the reserve: a ≤ 2.5 % constant-product move), an even split of the carried amount;
- at random times (seeded) at least 20 minutes apart inside a 6-hour window; what does not fit rolls into the next window until zero; a new
  reading's carried spend joins the plan (the rest of the window is re-planned from the chain's carried amount);
- each piece is its own transaction, written ahead of its send, with its own receipt (the program's `carried` memo, kept in the
  registry's / ledger's status table `dispersal:<mint>`); the page line reads "spent X of Y SOL for the reading of <date>; remainder being spent";
- `bt-burn-behind` (pushed as "Burnticker burn behind") once per reading not fully spent 24 hours after it landed.

The platform keeper runs it every cycle (60 s); the $DEFICIT keeper wakes at the next piece's time.

| Env | Meaning |
|---|---|
| `BURNTICKER_DISPERSAL=1` | turn dispersal on in both keepers. Leave unset until `crank_carried` is deployed (the deployed program rejects the instruction). |
| `BURNTICKER_PRIVATE_SEND_URL` | optional: a Jito block-engine (or equivalent JSON-RPC `sendTransaction`) endpoint; every program-port send and rebroadcast goes there instead of the RPC. Logged as scheme and host only. Unset: sends go through the RPC as before. |

## Mint addresses that end in burn (owner decision 2026-10-14)

Every coin made on the platform gets a mint address whose last four characters are `burn` or `BURN`. This was opt-in for a few hours
on the evening of 2026-10-14 (owner: "the wait for the vanity address is a killer"); since that night it is **mandatory again, with no
wait** (owner: "the BURN vanity address is mandatory. Save them like pump.fun does so they launch instantly."). Coins made before that
day ($DEFICIT, REHEARSAL, $PHINFLWIN) keep their plain addresses and are never described as ending in burn.

What a creator reads (the launch review, the sign card, the trust page, the operator page and the whitepaper's custody section):

> Every coin made here gets an address that ends in burn. This site prepares those mint keys ahead of time, keeps them encrypted, hands
> each one to its creator once at launch and deletes it 24 hours later if that launch does not happen. Until the coin is created the
> key only decides the address; it cannot move anything. The creator's wallet still signs the launch, and the key is never used for
> anything but creating that one mint. When no prepared key is ready, the creator's browser finds one instead, and that key never
> leaves the browser. Other launchpads prepare addresses the same way.

- **The mint key bank** (`src/lib/burnticker/mintBank.ts`) is a SQLite file on the Burnticker host (`BURNTICKER_MINT_BANK_PATH`, default
  `data/burnticker-mintbank.db`, mode 0600, owned by the app user, never copied off the host: `data/` is outside the public tree and the
  deploy excludes it). Each secret is sealed with AES-256-GCM under `BURNTICKER_MINT_BANK_KEY` (32 bytes, base64), with the row's public
  key bound in. A bank without the key, with the wrong key, or holding an unsealed secret is refused; there is no plaintext fallback.
  Rows: `pubkey`, `ciphertext`, `created_at`, `taken_at`, `taken_for` (the ticker), `mint_created_at`.
- **The grinder** (`scripts/burnticker-mint-bank.mts`, unit `mct-burnticker-mintbank`) runs the same search as the browser
  (`runGrindWorker`) on worker threads, every core but one, and keeps up to `BURNTICKER_MINT_BANK_SIZE` keys (default 300), refilling
  once fewer than `BURNTICKER_MINT_BANK_LOW` (default 100) are ready. `--once --fill N` adds N keys and exits; `--status` prints the
  counts; `--bench [SECONDS]` measures the rate without opening the bank. It prints public keys and counts only. Each minute it marks
  taken keys whose mint the registry shows launched (their sealed secret is wiped), deletes keys taken more than 24 hours ago that never
  launched (never recycled, so no address is offered to two creators), and records `bt-mint-bank-low` in the registry's alerts when the
  bank has been below LOW for more than an hour (the keeper pushes it, `push.ts` kind `mint-bank-low`).
- **The launch route** (`src/app/api/burnticker/launch/route.ts`): a request with no `mint` takes one key per coin (two for a pair) in
  one write transaction, builds the bundle with it and returns the secret in the bundle (`mintSecretKey`; `mintSecretKeys` on the pair
  curve), once, and only over HTTPS (Caddy's `X-Forwarded-Proto`, or a local development host). A refused request deletes the keys it
  took. A `launched` call marks the key created. No key ready, no bank on the host, or plain HTTP: `503` with code `mint-bank-empty`.
- **The launch page** sends no `mint`, checks the returned secret before anything is signed (`withServerKey`: it derives the bundle's
  mint and ends in burn), and keeps `walletReturnProblem` and `groundMintProblem` as before. On `mint-bank-empty` it runs the browser
  search for that launch (`withMintSource`, Web Workers in `src/app/burnticker/launch/vanity.worker.ts`), with the progress panel above
  Launch, and sends only the public keys it found (`mint`, `pair.mint`), which the route requires to end in burn (`mint-not-burn`
  otherwise). There is no switch and no plain address.
- **Operator launches** grind the mint first, outside the repository:

      node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/burnticker-grind-mint.mts --out ~/keys/<ticker>-mint.json

  It prints the public key only and writes a solana-keygen JSON file (mode 600, never over an existing file). The Solana CLI does the
  same with `solana-keygen grind --ends-with burn:1 --ends-with BURN:1`. Then pass the file as `--mint-keypair` to
  `scripts/burnkeeper-launch.mts` (a plain mint is warned in a dry run and refused for `--send` without `--allow-plain-mint`) and as
  `--mint` (or `--mint-keypair`) to `scripts/burnreceipts-admin.mts initialize-token` (warned, never refused, so older coins still work).
- **Cost:** one hit per 58^4 / 2 ≈ 5.66 million keys. On the 10-core Apple M5: Node's native Ed25519 on 9 to 10 workers ≈ 190,000
  to 224,000 keys a second (≈ 25 to 30 s per address; the bank service measured 223,707 a second on 9 workers on 2026-10-14); the pure-JavaScript fallback ≈ 42,000 a second on 10 workers (≈ 2 to 3 minutes).
