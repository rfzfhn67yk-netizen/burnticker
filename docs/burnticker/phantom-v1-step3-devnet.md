# Phantom v1, step 3: the devnet proof with the real extension

This is the owner's checklist for step 3 of the Phantom v1 work (scope: `docs/burnticker/phantom-v1-scope-2026-10-19.md`). Steps 0 to 2
are on branch `burnticker/phantom-v1-ready`. Step 3 is the one thing code cannot do: a real Phantom extension signing a real launch as a
version-1 transaction on devnet.

## What Phantom told us

Phantom support (ticket 438485, Rory, 2026-10-20) said to use Phantom extension 26.33.1 or later. That build reached full rollout with
Solana version-1 support on 15 October. They also said to choose version 1 from what the connected wallet advertises, not from the
version number. The signing card does exactly that: it uses version 1 only when the connected account lists the
`solana:signTransaction` feature, the account is on this launch's chain (`solana:devnet` here, `solana:mainnet` on the live site), and
that feature advertises version 1. Any other wallet gets version 0 with the lookup table, as it does today.

## Before you start

The devnet copy has to be running a release built from `burnticker/phantom-v1-ready`. Claude builds that release and restarts the
devnet copy. You do not need to restart anything. Ask Claude to do it, and wait for the message saying the devnet copy is up on the new
release.

## The checklist

1. **Check the Phantom version.** In the Phantom extension, open Settings, then About. The version must be 26.33.1 or later. If it is
   older, update the extension from the browser's extension store and check again.
2. **Switch Phantom to devnet.** In Phantom's settings, open Developer Settings and turn on Testnet Mode, then choose Solana Devnet.
   Use a throwaway devnet wallet with a little devnet SOL in it (a devnet faucet is enough). Never use a wallet that holds real funds.
3. **Open the devnet copy.** In a terminal on your Mac, start the tunnel and leave it running:

   ```
   ssh -N -L 3100:127.0.0.1:3100 root@<host>
   ```

   `<host>` is the Burnticker host's private network address. It is kept out of this file because this file is published with the
   public tree; Claude gives you the exact command in chat when the devnet copy is ready.

   Then open http://localhost:3100/burnticker/launch in the same browser that has Phantom.
4. **Launch a small coin.** Connect Phantom, fill in a draft with a throwaway name and ticker, and go through the review to the signing
   card.
5. **Read the readiness line before you sign.** The signing card should say: "This wallet signs version-1 transactions, so each step is
   sent as one. No lookup table is needed."
   - If it says "This wallet signs version-0 transactions..." instead, or shows the extra line starting "Phantom 26.33.1 or later signs
     these launches as version-1 transactions", stop here. Phantom is not advertising version 1 for this account on devnet. Note the
     Phantom version and send Claude a screenshot of the card.
6. **Approve the prompts.** Phantom asks once per step. Approve each one. The card shows each step as it confirms.
7. **If something is refused,** open the browser's developer console (right-click the page, Inspect, Console) and copy the warning that
   starts with "[burnticker launch] the wallet's transaction was refused". It holds only public transaction bytes, never a key. Send
   it to Claude together with the card's error sentence.

## What to send back

- The coin's mint address (on the coin page, or the card's completion card).
- The launch signature: the signature of the step that created the coin (the card lists each step's signature, and each links to the
  explorer).
- The Phantom version from Settings, About.
- Anything the card or the console said that looked wrong.

## How to confirm on chain that the transaction is version 1

Claude can do this from the signature, but here is how it works. Ask a devnet RPC node for the transaction and allow version 1:

```
curl -s https://api.devnet.solana.com -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "getTransaction",
  "params": ["<the launch signature>", { "encoding": "json", "commitment": "confirmed", "maxSupportedTransactionVersion": 1 }]
}'
```

In the answer, `result.version` should be `1`, `result.transaction.message` should have a `transactionConfig` block (the compute-unit
limit and the loaded-accounts size the card set), and there should be no `addressTableLookups`. `meta.err` should be `null`. The
fixture `test/fixtures/burnticker/v1-ledger-devnet.json` shows the full shape of a real version-1 transaction read from devnet this way.

A reader still pinned to `maxSupportedTransactionVersion: 0` gets error -32015 ("Transaction version (1) is not supported by the
requesting client") for the same signature. The same fixture keeps that answer under `errorWhenAskedForVersion0`.

## After the proof

Deploying this to mainnet waits for this devnet proof. Once the launch above lands as version 1 and the coin page shows it, Claude
prepares the sample for Phantom (the devnet signature, the compute and size readings, and the exact `supportedTransactionVersions` the
extension reported) and the mainnet release is a separate decision for the owner.
