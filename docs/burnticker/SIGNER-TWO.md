# A second reading signer

Written 2026-10-12 for item 3 of the platform list. Today one key, the keeper's data key, signs every reading at quorum 1. This page
looks at two ways to add a second signer and says which one is built. The Reclaim part comes from Reclaim's public documentation and
from the prototype already in this repository (`src/lib/burnKeeper/attesters/zktls.ts`). No account was made and no key was created.

## Option A: a zkTLS relayer (Reclaim)

**What Reclaim proves.** Reclaim's zkFetch makes an HTTPS request through one of Reclaim's attestors. The attestor signs a claim that
says a request to a given address returned a response, and that a given value was taken from it. Reclaim's docs describe it as a fetch
whose response cannot be faked afterwards.

**What our program needs signed.** A Burnticker reading is not one value from one web page. The signed message (see
[ATTESTERS.md](ATTESTERS.md)) carries the coin's unit counter for a day. That counter is 1 plus every unit the coin's receipts have
carried so far. It is worked out from many source readings, the coin's locked rule and the keeper's planning engine. The message also
carries the hash of a source address that lists the receipts counted that day. A Reclaim claim covers one HTTPS response. It cannot say
what the counter is.

**The keys do not match.** Reclaim's attestors sign with secp256k1 keys, the Ethereum kind, in the EIP-191 format. The burn_receipts
program only counts ed25519 signatures, checked by Solana's Ed25519SigVerify instruction. A Reclaim attestor therefore cannot be listed
as an attester. Something of ours would have to take the proof, check it, run the same engine as the keeper and then sign the message with
its own ed25519 key. That relayer is option B with one more input. The trust moves to the relayer's key, and Reclaim's attestors are
added to the chain of trust. On 2026-10-09 Reclaim's public registry listed three attestor addresses, and all three are run by Reclaim.

**Does it fit the message?** Yes. The message has a `proof=` field of 32 bytes, so the hash of a Reclaim proof could go there with no
format change. The program already has a kind tag for a zkTLS relayer (kind 1). Every signer of a reading signs the same bytes, so the
keeper and any other signer would have to agree on that proof hash too.

**Cost.** zkFetch needs an API key from Reclaim's developer portal, which means an account. Its install guide says it uses native
modules. The pages read here do not publish a price or a rate limit. One proof would be needed for each source read that feeds a
reading.

**Liveness.** A reading would wait whenever Reclaim's attestors or the developer portal are down, on top of the source itself. With
three attestors run by one company, that is one more outside service that can stop readings. A stop is late, never lost, but it is a
stop.

**Verdict.** Not as signer two. Reclaim cannot sign the message the program checks. A relayer that can sign it is a second operator
host anyway. A Reclaim proof is worth adding later as evidence for one source read, carried in `proof=`, once a second signer exists to
check it.

## Option B: a second operator host (built)

A small separate machine runs `scripts/burnticker-signer.mts` with its own key. For each reading the keeper asks it to co-sign. It reads
the coin's rules and the primary source itself. It works out the unit counter with the keeper's own engine, builds the exact message and
compares it byte for byte with the one the keeper sent. It signs only when the two are equal. The keeper then puts both signatures in one
Ed25519SigVerify instruction before `submit_reading`. When the two disagree, the keeper raises an alert and sends no reading. The signer
also refuses to sign a second, different message for a coin and day it has already signed.

What is not built yet:

- The signer cannot yet check rivalry-pair coins or pair results. It answers that it cannot check them, and the keeper then sends
  nothing that needs its signature. Pair coins stay at quorum 1 until it can.
- It does not check Burn Derby coins, Kalshi coins or the end-of-rule clock days. Those are the same limits as the public reader
  (`burnticker-attester.mts read`).
- No second host, no key and no proposal exist yet. The owner's steps are in [the rollout](SIGNER-TWO-ROLLOUT.md).
