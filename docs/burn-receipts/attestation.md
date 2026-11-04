# Attestation — how a reading becomes true on chain

A reading is `(record_date, value)` — for $DEFICIT, Treasury's *Debt to the Penny* `tot_pub_debt_out_amt` in cents for one
`record_date`. `submit_reading` accepts it only with a **quorum of N of M attester signatures** (M ≤ 5, N ≤ 3; fixed at init,
changeable only through the 48 h timelock: the quorum is never lowered, the set never smaller than the quorum, and one proposal keeps
≥ quorum current keys and adds fewer keys than the new quorum — so newly added keys can never sign readings on their own; since
review 3 a kept key vouches for an ADDED key only after 7 days in the set, so a chain of proposals takes ≥ 48 h + 7 days + 48 h).

## The model (implemented)

Every attester is an **ed25519 key** with an informational `kind` tag:

| kind | tag | what stands behind the key |
|---|---|---|
| 0 | `operator` | our keeper's data key; a second, independently run operator |
| 1 | `zktls-relayer` | a relayer that fetches the source inside a zkTLS session, publishes the proof, and signs only readings its proof supports |
| 2 | `oracle` | an oracle network's signing key, should one be used |

**The program verifies only signatures and the quorum.** The tag never changes verification; it tells readers (status page, Powers
Register, `TokenInitialized` event) what each key is.

Each attester signs exactly these bytes (`src/attest.rs::canonical_message`, `src/lib/burnReceipts/attestation.ts::attestationMessage`):

```
BURNRECEIPTS-v3|<cluster genesis hash>|<program id>|<mint>|<feed_id>|prev=<YYYY-MM-DD of the previous reading, or none>|<YYYY-MM-DD>|<value, exactly value_decimals places>|src=<sha256(source URL), 64 hex>|proof=<proof locator, 64 hex>
BURNRECEIPTS-v3|5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d|<program>|<mint>|treasury.debt_to_penny|prev=2026-10-07|2026-10-08|40305316210829.72|src=<sha256 of the query URL>|proof=0000…0000
```

- cluster genesis hash (review-2 F12) — fixed per program build (mainnet's for the default build, devnet's for `--features devnet`,
  a localnet tag for `--features localnet`; the client never signs a mainnet-bound message off mainnet — review-3 I-1)
  and stored on each TokenConfig as `cluster_genesis`; a signature made for a devnet rehearsal is useless on mainnet even if a
  program id and mint key were reused. Signers take it from the config (the client refuses when it differs from the RPC's genesis);
- program id + mint (review M-3) — signatures are public in every `submit_reading` transaction; binding them to one program and one
  mint makes them useless for any other token or redeploy;
- `prev` (review L-1) — the date of the reading this one follows (`none` for the baseline), so pre-signed readings cannot be
  submitted out of order or skipped;

- `feed_id` — pinned in the TokenConfig at init;
- period — the `record_date`;
- value — the integer in the feed's smallest unit, printed with the rule's decimals (cents → 2);
- `source_url_hash` — sha256 of the exact URL read (e.g.
  `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?filter=record_date:eq:2026-10-08`);
  mandatory, stored on the `Reading` and in `ReadingSubmitted`;
- `proof_hash` — the locator of a zkTLS proof of that response (e.g. the sha256 / content address of the proof file), zeros when
  there is none; stored on the `Reading` and in `ReadingSubmitted`, **not verified on chain**.

The signatures ride in `Ed25519SigVerify` instruction(s) of the same transaction; the runtime verifies them, and the program reads
them back through the instructions sysvar, requiring every offset to point into the Ed25519 instruction itself, counting each key
once, and matching the message byte for byte. Client: `attestReading()` / `submitAttestedReading()`.

**Transaction size (review-2 F4).** Every attester signs the same bytes, so the client packs ONE copy of the message and N
(pubkey, signature) entries whose message offsets all point at it (`ed25519SharedMessageInstruction`). With the 358-byte v3 message a
`submit_reading` transaction is 966 / 1,076 / 1,186 bytes for 1 / 2 / 3 signatures (limit 1,232; the old copy-per-signature layout
was 1,434 bytes at 2). Quorum 4–5 cannot fit a legacy transaction, and the quorum can never be lowered, so the program caps it at 3.
The client still falls back to a v0 transaction through an address lookup table (`createReadingLookupTable`) if a transaction would
not fit, and every test transaction is size-asserted.

Signatures from attesters on different machines: each signs `attestationMessage(config.cluster_genesis, programId, mint, feedId,
prevDate, recordDate, value, decimals, srcHash, proofHash)` and returns (publicKey, signature); whoever submits packs them with
`ed25519SharedMessageInstruction(message, signatures)` followed by `submitReadingIx`.

## Configurations

- **$DEFICIT v1 (level 2):** `attesters = [operator(keeper data key)]`, `quorum = 1`.
- **Level 2+:** `[operator(keeper), operator(second operator)]` or `[operator(keeper), zktls-relayer(relayer)]`, `quorum = 2` — a
  false reading needs two independent keys. Adding the second attester and raising the quorum is one `propose_attesters` (48 h) — and
  at quorum 1 it must be one proposal: adding a key without raising the quorum is refused (the new key alone would be a quorum).
- **Level 3:** a quorum (≤ 3) of independent operators / relayers (up to 5 keys) whose proofs are public; the keeper is just one of them.

### The zkTLS relayer path (designed; provider not chosen)

1. The relayer fetches the Treasury URL inside a zkTLS / TLS-notary session (Reclaim, TLSNotary, Opacity or similar), producing a
   proof that the response came from `api.fiscaldata.treasury.gov` and contained `record_date` and `tot_pub_debt_out_amt`.
2. It publishes the proof (any content-addressed store) and computes `proof_hash`.
3. It signs the canonical message with `src = sha256(url)` and `proof = proof_hash`; the keeper (or a second operator) verifies the
   proof off chain and signs the same message; one transaction carries both signatures and `submit_reading`.
4. Anyone verifies a reading by fetching the proof at `proof_hash`, checking it with the provider's verifier, and comparing the
   proven fields with the reading's date and value — the status page runs this check and shows it next to each burn.

Open before choosing a provider: an audited verifier and proof format, the notary/witness set, proof size and the cost per reading.
On-chain proof verification can be added later as a new attester kind without changing the reading format.

## Why there is no Switchboard attester

A Switchboard On-Demand attester kind (the program reading a PullFeed account: owner, layout checked against Switchboard's own
published struct, pinned job hash and queue, staleness, unanimity, optional date feed) was built on 2026-10-09 and then **removed
from the program the same day**, after the coordinator reported that Switchboard Technology Labs ended all oracle services on
2026-09-25 (gateways and Crossbar gone; programs still on chain but unfed). The code and its tests are in commit `f94089c5`; the
current program has no Switchboard code path, dependency or account.
