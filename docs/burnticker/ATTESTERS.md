# Bring your own attester

Owner-approved 2026-10-10 (night). Every Burnticker coin's readings are signed by **attesters**: ed25519 keys listed in the coin's
on-chain `TokenConfig`. Today each coin has one — the platform keeper's data key (quorum 1). This page is the path for a community
to put **its own key** on a coin, run the reader on its own machine from the public repository, and check every reading the keeper
writes. No program change is involved: the program already holds up to 5 attesters and a quorum up to 3.

Read "What is not built" before proposing anything: adding a key **raises the quorum for good**.

## What an attester signs

For each UTC day on which a coin's rule counted units, the keeper attests the coin's **unit counter**: 1 plus every unit its
receipts have carried so far. The program verifies this exact message (`src/lib/burnReceipts/attestation.ts`):

```
BURNRECEIPTS-v3|<cluster genesis>|<program id>|<mint>|bt.units:<TICKER>|prev=<previous reading date>|<YYYY-MM-DD>|<counter>|src=<sha256 of the counter source URL>|proof=<32 zero bytes, hex>
```

The counter source URL (`burnticker://<TICKER>/units/<date>?events=<event ids>`) names the receipts counted into that day, so its
hash on chain (`Reading.source_url_hash`) commits to the events, not only to the number. A reading counts once **quorum** distinct
attesters' signatures over that message are in the same transaction (an Ed25519SigVerify instruction before `submit_reading`).

### Pair results (winner takes the burn, 2026-10-11)

For a rivalry pair, each result period also gets one PairResult: the winner (the coin whose rule the result fires) or a draw, signed
over one shared message. Since round 3 (after the pair-forward re-check): both coins of a pair carry **one attester set and quorum** —
same keys, same order; the program refuses to pair them otherwise (`PairAttestersDiffer`) — and **every** result, win or draw, needs a
quorum of each coin's set, which is the same set of signatures. Repeated submissions are signature-checked too. Plainly: whoever holds that
common quorum decides every result; on Burnticker that is the operator's keeper alone at quorum 1. The message (`pairResultMessage`, `attestPairResult` in
`src/lib/burnReceipts/pairs.ts`):

```
BURNRECEIPTS-PAIR-v1|<cluster genesis>|<program id>|<mint_lo>|<mint_hi>|<YYYY-MM-DD>|winner=<mint|draw>|src=<sha256 of the source URL>|proof=<hex>
```

One Ed25519SigVerify instruction carries every signature before `submit_pair_result`; a key counts for whichever coin's set holds it (on
devnet the keeper key is both coins' attester). Two notes for anyone checking or running this:

- **Its event is a plain log.** `PairResultSubmitted` is written with `emit!`, not `emit_cpi!`: read it from the transaction's
  "Program data:" log lines written inside burn_receipts' own invocation (the SDK's `logEventsFrom` does), not from an inner
  instruction. The PairResult account `["pair_result", mint_lo, mint_hi, date]` is the durable record.
- **Transaction size.** A win carries both coins' readings for the date: one signature plus both readings fits a legacy transaction, and
  so does a draw; a quorum of two or more needs a v0 transaction with an address lookup table.
- **Rotating a paired coin's attesters.** `propose_attesters` works as for any coin (48 h timelock), but a PAIRED coin applies the change
  only through `apply_paired_attester_change`: a quorum of the PARTNER's attesters signs
  `BURNRECEIPTS-PAIR-ATTESTER-CHANGE-v1|<genesis>|<program>|<mint>|<partner>|set=<sha256 of the pending set>|eta=<pending eta>`
  (`pairAttesterChangeMessage`, `pairSetHash`), packed in one Ed25519SigVerify instruction in the same transaction;
  `apply_attester_change` refuses a paired coin (`PairedAttesterChange`). Since program round 4 (re-check P3-2; built, deployed with the
  end sinks) the one apply sets the new set on BOTH coins at once and records it on both PairLinks, so a pair is never on two sets; until
  that upgrade the runbook rule holds: change a paired coin's set only together with its partner's. The keeper never rotates attesters on its own: a rotation is the operator's (Squads vault)
  decision, run by hand with the admin CLI.

The end of a coin's rule (program round 4, LAUNCHPAD-PATH §45; deployed on devnet and mainnet on 2026-10-12, kept in round 5) is signed the same way: a quorum of the coin's
own attesters signs one message, once per coin, and only a coin launched with an end sink can end on chain (`attestRuleEnd`,
`ruleEndMessage` in `src/lib/burnReceipts/endSink.ts`):

```
BURNRECEIPTS-END-v1|<cluster genesis>|<program id>|<mint>|<YYYY-MM-DD>|outcome=resolved|void|src=<sha256 of the source URL>|proof=<hex>
```

Plainly: whoever holds the coin's quorum decides when its rule ended and whether it ended with a result. After a resolved end the
program accepts no reading dated later, and anyone can move what is left to the end sink the program picks (`forward_on_end`).

- **What a win needs on chain.** The two coins paired to each other, a date on or after the pairing day (`PairDateBeforePairing`) and after
  `pair_after_date` (periods read before the pairing stay unpaired: `PairPeriodUnpaired`), both
  coins' readings for the date (the keeper attests a flat 0-unit winner reading first when needed) and the loser's still unprocessed —
  else `PairResultNotServable`. There is no pool condition: against a side without a verified pool the forward moves 0 lamports and the
  fuel stays in the loser's pool (its own later burns spend it). A lost period never burns the losing coin unless no forward lands within
  72 hours, in which case it burns as a plain period and a PairForwardMissing event is published. A draw is signed only when the period truly was a draw; the keeper never substitutes one for a win.

## 1. Run the reader on your own machine

```sh
git clone https://github.com/<org>/burnticker && cd burnticker && npm ci
R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }
R scripts/burnticker-attester.mts read <mint> <YYYY-MM-DD> --site https://burnticker.com --rpc https://api.mainnet-beta.solana.com --cluster mainnet --program <burn_receipts id>
```

What `read` does, in order:

1. Fetches the coin's `rules.json` and launch time from the site and checks that the text hashes to the site's rules hash — and, with
   `--rpc`, to the `rules_sha256` the program pinned in the coin's `TokenConfig` at launch (a different file is refused).
2. **Re-reads the source itself**, through the same adapter the keeper uses (catalogue feeds: Treasury, BLS, FRED, NOAA, …; the
   Polymarket payout vector on Polygon). Nothing from our server is used for the numbers unless you pass `--readings-from-site`,
   and then the output says "NOT independent".
3. Runs the keeper's own planning engine (`multiKeeper.planToken`) in a scratch registry and prints the counter for that day, the
   previous reading date, the receipts counted into it, the source URL and its hash, and the exact message above.
4. With `--key <file>`, signs the message and prints your public key and the signature (base64).
5. With `--rpc`, compares your value, previous date, units and source hash against the program's `Reading` account for that day and
   exits 1 on any difference. **This needs no key and no permission** — anyone can watch every reading this way today.

Offline, without the site: `--rules <rules.json> --ticker <T> --baseline <ISO launch time>`.

Not supported by `read` yet (it refuses with the reason): rivalry-pair coins (their event burns wait on the pair's pool registration,
chain state the tool does not replay), Burn Derby coins (boundary snapshots the keeper samples), Kalshi coins (Kalshi is not a
settlement input), and the end-of-rule wind-down clock days (date-based: `sha256("clock|<date>|<rules sha256>")` is their proof).

## 2. Make a key

```sh
BURNTICKER_ATTESTER_PASSPHRASE='<long passphrase>' R scripts/burnticker-attester.mts keygen --out ~/.config/burnticker-attester/<coin>.json
```

The key is written outside any repository (refused inside one), mode 600, encrypted with the passphrase (AES-256-GCM + scrypt, the
keeper's own format) when one is set; `<file>.address` holds the public key. It signs readings only: it holds no funds, pays no fees,
and has no power over any pool. Keep it on a machine you control; a key that signs a false reading is visible on chain forever.

## 3. Propose → 48 hours → apply

The attester set of a coin changes only through `propose_attesters`, signed by the coin's **config authority** (the platform's
Squads 2-of-3 vault; `status` prints it) — and never once the authority has renounced. Every proposal waits **48 hours in public**
(`AttesterChangeProposed` on chain); after that **anyone** may apply it.

```sh
R scripts/burnticker-attester.mts status  <mint> --rpc <url> --cluster mainnet --program <id>     # keys, kinds, joined, senior-from, quorum, pending change + ETA
R scripts/burnticker-attester.mts propose <mint> --add <your pubkey> --rpc <url> ...               # checks the program's rules; prints the UNSIGNED instruction
R scripts/burnticker-attester.mts apply   <mint> --payer <your pubkey> --rpc <url> ...             # after the ETA: the permissionless apply instruction, unsigned
```

`propose` never signs. Send its output (the instruction and the checks) to security@burnticker.com or open an issue on the public
repository; the operator puts it to the Squads vault as a vault transaction, two of three members approve, and the 48-hour clock
starts on chain. The tool only *prints* instructions — the admin CLI (`scripts/burnreceipts-admin.mts`) has no attester commands, so
these are built here with the same client (`src/lib/burnReceipts/instructions.ts`).

## 4. The program's rules (seniority and quorum)

Mirrored in `checkProposal` (`src/lib/burnticker/attesters/byo.ts`) from `programs/burn-receipts/.../instructions/admin.rs`, so a
proposal is checked before anyone is asked to sign it:

- 1–5 distinct keys; kind 0 (operator — any person or group running the reader), 1 (zkTLS relayer) or 2 (oracle). The kind is a
  label for readers; the program checks only signatures and the quorum.
- The quorum is 1–3, never more than the set, and **can never be lowered**.
- A proposal keeps at least `quorum` of the current keys.
- It adds **fewer new keys than the new quorum** — so no quorum can ever be made of new keys alone. At quorum 1 this means adding
  one key requires raising the quorum to 2.
- When it adds keys, at least `quorum` of the kept keys must have been in the set for **7 days** (seniority). A new key's seniority
  starts when the change is applied. The fastest path for two changes in a row is therefore 48 h + 7 days + 48 h, every step public.

The trust page shows, per coin, the number of attesters, the first characters of each key, when it joined and from when it is senior
(from the registry; the chain is the authority — `status` reads it).

## What is not built (read before proposing)

- **The keeper now collects a second signer's signature, and no second signer is running yet.** Built 2026-10-12: with
  `BURNTICKER_COSIGNER_URL` set, both keepers send each reading to a signer service (`scripts/burnticker-signer.mts`,
  [SIGNER-TWO.md](SIGNER-TWO.md)) that re-reads the source on its own host and signs only when its bytes match. The keeper puts that
  signature in the same Ed25519SigVerify instruction, and a disagreement holds the reading with an alert. It is tested on the in-memory
  program and on a local validator, and not yet on devnet. It is wired for the operator's own second host. A community key would run the
  same service, and the keeper takes one second signer today. Adding a key still raises the quorum to 2 for good, so a coin with your key
  waits for every reading you do not co-sign. Late, never lost. **The operator will not put a proposal that adds a key to the vault until
  that key's signer has co-signed in shadow and the change is tested on devnet.** Until then, use `read --rpc` as an independent watchdog:
  it needs no key on the coin and catches a wrong reading the day it lands. The rollout for the operator's own second signer is in
  [SIGNER-TWO-ROLLOUT.md](SIGNER-TWO-ROLLOUT.md).
- The signer does not check rivalry-pair coins, pair results, Burn Derby coins or the end-of-rule clock days yet. For those it answers
  that it cannot check, and a coin that needs its signature waits.
- The keeper's own key and the standby keeper's key (runbook "Keeper redundancy") are added the same way, under the same rules.

## If your reading and the chain disagree

`read --rpc` exits 1 and prints which field differs. Check first that you read the same day (`--prev <date>` if the keeper folded a
late settlement into a later day: the chain's `prev` is printed). If the difference stands, report it: security@burnticker.com, with
the command and its output. A confirmed difference is an incident under [INCIDENTS.md](INCIDENTS.md) (category 1 or 2) with a public
postmortem within 48 hours.
