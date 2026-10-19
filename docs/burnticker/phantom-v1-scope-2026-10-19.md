# Phantom review: moving the browser launch flow to Solana v1 transactions. Scope, 2026-10-19

Scope only. No production code changed. The one artefact besides this file is a throwaway devnet spike under
`research/phantom-v1-spike/` (its own `node_modules`, never the app's), which signed nothing on mainnet, sent nothing anywhere, and
used keypairs generated in-process.

Phantom's ask (ticket 438485, agent Rory, 2026-10-19): build the whole launch transaction as v1, simulate it, let Phantom sign, then add
the mint keypair's signature without rebuilding the message; the mint key must already be a required signer in the compiled message;
set the compute unit limit and the loaded-accounts data-size limit from a generous simulation, rounding the data size up to the next
32 KiB page; v1 has no address lookup tables; detect wallet v1 support and fall back to v0.

## The short answer

Yes, it can be done without touching the Raydium SDK or the server's web3.js 1.x builders, and the spike proves the mechanics on devnet.
The LaunchLab create step, as the server builds it today, carries as a v1 transaction of 870 bytes with 17 distinct accounts and no
lookup table. A simulation with generous limits sizes it, a wallet-style signature followed by the mint's signature lands on
byte-identical message bytes, and the fully signed transaction verifies. The browser side needs `@solana/kit` 8 next to web3.js 1.x,
a new v1 signing module beside `signPlan.ts`, and every reader that pins `maxSupportedTransactionVersion: 0` on the launch signature
has to accept 1. The keeper does not need to move. Estimate: 4 to 5 working days, with the one real unknown being what Phantom's
shipped extension advertises and does with v1 today.

## 1. The SDK: conversion path, not an upgrade

**What the app actually uses.** The server never calls the SDK's high-level `createLaunchpad`. It calls the low-level instruction
builders (`initializeV2`, `buyExactInInstruction`, `createVestingAccount`) in `src/lib/burnKeeper/launch.ts`. Those return plain
web3.js `TransactionInstruction` objects: a program id, an account list with signer and writable flags, and bytes. The launch API
already flattens them to `SerializedIx` (program id, keys, data as base64) before they reach the browser, and the browser rebuilds
`TransactionInstruction`s from that in `buildStepTx`. The transaction version is decided only at that last step, in the browser.

**So the conversion is one function.** A `SerializedIx` becomes a kit `Instruction` directly (address, accounts with a role, data), or,
as the spike did, by rebuilding the web3.js instruction and passing it to `fromLegacyTransactionInstruction` from `@solana/compat`
8.5.0. No SDK code runs in the browser for a launch, so the SDK's web3.js 1.x dependency is irrelevant to the v1 build. The two
libraries coexist because kit lives under a different package name; nothing in the app's web3.js 1.x resolution changes.

**Is there a Raydium SDK that emits v1?** No. The `latest` tag is still 0.2.74-alpha, published 2026-10-08. The 2.0.0-rc.0 through
2.0.0-rc.20 and 2.0.1-rc.0 releases all depend on `@solana/web3.js ^1.75.3`; none depends on kit or web3.js 3. Even the SDK's own
transaction builders would produce legacy or v0. There is nothing to wait for on that side.

**web3.js versions, for the record.** 1.99.0 (2026-10-15) adds read-only v1 support: `VersionedTransaction.deserialize` and
`VersionedMessage.deserialize` accept the 0x81 envelope through a new `MessageV1`, and `getTransaction` accepts
`maxSupportedTransactionVersion: 1`. Building, serializing, signing and sending v1 stay unsupported there. web3.js 3 (3.1.0 on `next`,
3.0.0-rc.3 on `rc`) can build and send v1 but cannot share a resolution with the SDK's `^1.x` pin, so it would mean two copies of the
same package name. Kit 8 is the clean choice: Phantom's recipe is written against kit 8.3.0, the installed transitive copy is kit 7.1.1
(via the mobile wallet adapter), and 8.5.0 is current.

### What the spike measured (devnet, 2026-10-19)

The spike built the real devnet bundle through `prepareLaunch` (register off), converted the LaunchLab create step, and ran the whole
Phantom sequence with a throwaway creator keypair standing in for the wallet. Report: `research/phantom-v1-spike/run-2026-10-19.json`.

| Measure | Value |
| --- | --- |
| v0 with the pinned lookup table (what ships today) | 614 bytes |
| v0 without a table | 859 bytes |
| v1, no table, with config | 870 bytes (first byte 0x81) |
| distinct accounts in the create step | 17 of 64 allowed |
| required signers in the compiled v1 message | creator, then the mint |
| compute units used by initialize_v2 | 110,136 |
| compute unit limit set (used × 1.2) | ≈ 132,000 to 136,000 |
| loaded accounts data size from simulation | 2,681,927 bytes |
| limit set after rounding up to a 32 KiB page | 2,686,976 bytes (82 pages) |
| sized build simulated again | no error, same usage |
| message bytes after the wallet signature | unchanged |
| message bytes after the mint signature was added | unchanged |
| both signatures verify against the message | yes |
| web3.js 1.98.4 reading the signed v1 bytes | throws "Reached end of buffer unexpectedly" |

The devnet faucet refused the throwaway creator, so the sizing simulation was run as a funded devnet public key (the devnet keeper key,
public key only, signature verification off). The signing proof used only in-process keys. Nothing was sent.

The loaded-accounts figure is mostly program bytes (LaunchLab, Metaplex metadata, the token program), which is why it rounds to 82
pages. That is fine: the block cost model charges in pages, and headroom inside a page is free. One extra page for accounts the
create makes between simulate and send costs nothing either.

## 2. What assumes v0 or legacy today, and what changes

### `src/lib/burnticker/signPlan.ts`

- `buildStepTx` compiles with `TransactionMessage.compileToV0Message` against the verified lookup table and refuses anything over
  `PACKET_LIMIT` (1,232 bytes). A v1 step has no table, a 4,096-byte envelope, and a 64-account limit instead. New function, kit types.
- `wireSize` serialises a web3.js `VersionedTransaction`. v1: the encoded wire length from kit.
- `walletReturnProblem` deserialises the returned bytes with `VersionedMessage.deserialize`, reads `staticAccountKeys`,
  `header.numRequiredSignatures`, `recentBlockhash` and the leading `signatures` array. In v1 the signatures sit at the tail of the
  envelope and the message carries a config block, so the whole check has to be redone over kit's decoded transaction: compare
  `messageBytes` to what was handed over, then check the signature map by address. The rule stays exact: equal message bytes, our
  earlier signatures untouched, the wallet's own slot filled.
- `appendedGuardProblem` and `resolvedInstructions` resolve accounts through `getAccountKeys` with lookup tables. v1 has none, so the
  resolution is the static list. Open question for the devnet proof: whether Phantom's Lighthouse guard appends instructions to a v1
  transaction at all. If it does, the comparison is reimplemented over kit's decompiled message; if it does not, the v1 rule is
  simply "bytes equal". Note that compute-budget instructions are no-ops in v1 (they still cost 150 CU), so the "ignore compute
  budget on both sides" clause stays and our own steps keep carrying none.
- `signStepKeys` calls `tx.sign(signers)` on a web3.js object. v1: `partiallySignTransaction([mintKeyPair], decodedReturn)`, which is
  exactly the "add the mint signature without rebuilding" step the spike exercised. The mint secret is already a 64-byte key in the
  plan; `createKeyPairFromBytes` or `fromLegacyKeypair` turns it into the CryptoKey kit wants.
- `SendDeps.signTransaction`, `simulate` and `lookupTable` take or return web3.js `VersionedTransaction`s. The v1 runner needs byte
  versions: `signBytes(bytes) → bytes`, `simulateBytes(base64)`, and no table at all.
- `signAndSendPlan` lines 539 to 592: it fetches and verifies the table before any step, calls `buildStepTx`, dry-runs via
  `d.simulate`, checks `PACKET_LIMIT` on the signed bytes, and derives the step's signature from `signatures[0]`. For v1 the table read
  is skipped, the size check becomes 4,096 bytes plus the 64-account check, and the signature comes from
  `getSignatureFromTransaction`. `PendingSend.tx` (base64 bytes), `sendRaw` (web3.js `sendRawTransaction` only base64-encodes the bytes
  it is given, so it carries a v1 envelope unchanged), `confirm` by signature and the whole reconcile ladder are format-agnostic and
  stay as they are.
- `chainReadDeps` / `launchRecovery.ts:13` reads the sent transaction with `maxSupportedTransactionVersion: 0`. That must become 1, and
  web3.js has to be at least 1.99.0 to parse the answer (see the reader list below).

### `src/lib/burnticker/lookupTable.ts` and the pin

`v0WireSize`, `planSizeProblems` and `verifiedLookupTable` exist only to make a v0 step fit 1,232 bytes. A v1-capable wallet needs none
of them; keep them for the v0 fallback. `hostedLaunch.ts` lists "no lookup table pinned" as a launch blocker; with v1 that blocker
applies only when the fallback is in play, so it moves behind the wallet-capability check. `SignCard` fetches the pin from
`GET /api/burnticker/launch` on mount; harmless on the v1 path, still required on the v0 path.

### `src/app/burnticker/launch/SignCard.tsx` (the wallet signing path)

- `wallet.signTransaction` is the wallet-adapter's method. `StandardWalletAdapter` serialises the web3.js object, calls the
  wallet-standard `solana:signTransaction` feature, and then runs `VersionedTransaction.deserialize` on what comes back. With web3.js
  1.98.4 that throws on a v1 envelope (the spike shows the exact error), and with 1.99.0 it would decode but cannot serialise or sign.
  So the v1 path must call the wallet-standard feature itself with raw bytes:
  `wallet.wallet.adapter.wallet.features["solana:signTransaction"].signTransaction({ transaction: bytes, account, chain: "solana:devnet" | "solana:mainnet" })`.
  `StandardWalletAdapter` exposes the underlying wallet as `.wallet`. Adapters that are not wallet-standard (Ledger, Trezor and the
  mobile wallet adapter in `@solana/wallet-adapter-wallets`) have no such feature and take the v0 fallback.
- The readiness check `!v0?.has(0)` becomes a three-way decision: v1 when the wallet advertises 1, v0 when it advertises 0, refuse
  otherwise.
- `simulate` calls `connection.simulateTransaction(tx)` with a web3.js object. For v1 the dry run is a raw JSON-RPC
  `simulateTransaction` with `encoding: "base64"`, `sigVerify: false`, `replaceRecentBlockhash: true`, which the proxy already allows
  (`rpcProxy.ts` lists `simulateTransaction` and `sendTransaction`; the proxy passes params through, to be re-checked when the module
  is written).
- `sendRaw` and `confirm` stay. The RPC upstream behind the proxy must be on Agave 4.2.2 or newer, otherwise v1 is accepted but stored
  downgraded as v0, which breaks every reader below. Verify with the provider before mainnet.
- The operator's claim-fees page (`ClaimFees.tsx`) and the in-app swap (`swap/chain.ts`) also sign v0 through the adapter. Phantom's
  ask is about the launch flow; those stay v0 unless the review widens.

### Readers pinned to version 0 (server and keeper)

Once a launch lands as v1, every reader of that signature that passes `maxSupportedTransactionVersion: 0` gets an error instead of a
transaction. The grep found thirty-odd call sites; the ones on the launch's critical path are:

- `src/lib/burnticker/launchVerify.ts:71,116` (the "launched" confirmation reads the create transaction)
- `src/lib/burnticker/draftReconciler.ts:71,73` (signer reads during reconciliation)
- `src/lib/burnticker/launchRecovery.ts:13` (the browser's own recovery ladder)
- `src/lib/burnticker/programClient.ts:138,146` and `src/lib/burnKeeper/programAdapter.ts:135` (program event reads by signature)
- `src/lib/burnticker/trust.ts:441`, `trustpack/receiptCheck.ts:213`, `trustpack/ledger.ts:97`, `trustpack/neverBuys.ts:110`,
  `history.ts:196` (the trust pages and the curl text they print)
- `src/lib/burnticker/lifecycleDates.ts:108` (already takes the version as a variable)

The fix is mechanical (0 → 1) but each reader also has to tolerate the v1 JSON shape (`transactionConfig` present, signatures still
in `transaction.signatures`). With web3.js 1.99.0 the `Connection` readers get that for free; the raw `rpc.call` readers parse JSON
themselves and need one v1 fixture each. The trading bots' own readers (outside the platform tree) never see Burnticker launches and
can stay.

## 3. Detecting wallet v1 support, and the fallback

- The signal is the wallet-standard feature `solana:signTransaction` and its `supportedTransactionVersions` array. The type in
  `@solana/wallet-standard-features` 1.5.0 (2026-09-10) is `'legacy' | 0 | 1`; the installed 1.4.0 types stop at 0, but the value is a
  plain array that passes through at runtime. Bump to 1.5.0 so the types match.
- Test membership, never emptiness: a legacy-only wallet reports `['legacy']`. Read the feature the page will actually use
  (`solana:signTransaction`); the adapter's `supportedTransactionVersions` set prefers the sign-and-send feature when the wallet has
  one, which is not the path a launch takes. The Foundation's own guidance is the intersection across every signing feature the wallet
  exposes, which is stricter and also fine.
- Decide once per plan, before anything is built, and record the choice in the plan record so a resumed run after a reload does not
  change format mid-plan.
- Fallback: `has(1)` false and `has(0)` true keeps today's v0 path untouched, lookup-table pin included. Neither: refuse, as now.
- What Phantom advertises today is not public. Phantom has published the kit v1 recipe (kit 8.3.0, wallet-standard-features 1.5.0),
  but as of 2026-10-02 the only wallet that had announced v1 signing was Backpack, with Phantom, Solflare, Ledger and Trezor still to
  come (Solana Compass). Phantom's own versioned-transactions page still only names version 0. Ask Rory which extension version
  advertises 1 on `solana:signTransaction`; until then the fallback is what every creator would get.

## 4. Does the keeper, or any other sender, need v1?

No. The keeper (`src/lib/burnKeeper/solanaChain.ts`, `src/lib/burnReceipts/crank.ts`) signs with its own key, builds legacy or v0
through web3.js, sizes with `buildSizedTransaction` and sends through `privateSend.ts`, which is base64 JSON-RPC already. Phantom's
review covers the browser flow it signs, and the keeper's transactions fit 1,232 bytes. Moving it would mean a kit build path for no
benefit. The same holds for the pair-forward, end-sink and lock-fees chains and the scripts under `scripts/`.

Two keeper-side things do change: the readers listed above that touch a launch signature (`programAdapter.ts:135`), and the
`getTransaction` calls in any keeper check that reads a creator's launch. The keeper's reads of its own transactions can stay at 0.

## 5. Devnet proof plan (throwaway keypairs only)

Already done by the spike, repeatable from the repo root with
`BURNTICKER_END_SINKS_LIVE=1 node --import ./test/alias-hook.mjs research/phantom-v1-spike/spike.mts --simulate-as <funded devnet public key>`:

1. Build the real devnet bundle through `prepareLaunch` with a creator keypair generated in-process (register off, the existing devnet
   platform config `GvSKpe…QptE` and global config).
2. Convert the LaunchLab create step to kit instructions and compile a v1 message with a generous config (1,400,000 CU, 64 MiB loaded
   accounts). Check the mint is a required signer in the compiled message.
3. Simulate with signature verification off; read `unitsConsumed` and `loadedAccountsDataSize`; set the limits (units × 1.2, data size
   rounded up to a 32 KiB page plus one page); simulate again.
4. Have the throwaway creator sign the compiled bytes (the wallet's role), hand the encoded wire bytes across as a wallet would,
   decode them, assert the message bytes are the ones built, then add the mint signature with `partiallySignTransaction`. Assert the
   message bytes are still identical, both signatures verify, and the transaction is fully signed.
5. Simulate the fully signed bytes with signature verification on. Confirm web3.js 1.98.4 cannot deserialise them (so the shipped
   guards cannot be reused as they are).

Still to prove, in order, once the module exists:

6. The same sequence with the real Phantom extension on devnet, a throwaway devnet wallet inside Phantom, and the page's own code:
   confirm what `supportedTransactionVersions` reports, that Phantom returns a v1 envelope with only its own slot filled, and whether
   Lighthouse appends anything in v1. This needs the owner at the keyboard; the spike cannot drive the extension.
7. Send the signed v1 to devnet, confirm it, and read it back with `maxSupportedTransactionVersion: 1` through `launchVerify`,
   `draftReconciler`, `launchRecovery` and the trust readers. Confirm the create is recorded and the coin page renders.
8. A reload mid-plan: the stored `PendingSend` bytes are v1; recovery must settle them with the same answers as today.
9. The v0 fallback with the pin, unchanged, from a wallet that does not advertise 1.

Nothing in this plan touches mainnet, and no step reads a key file.

## Effort, risks, order

**Effort: 4 to 5 working days.**

| Step | Days | What |
| --- | --- | --- |
| 0 | 0.5 | web3.js 1.98.4 → 1.99.0 (inside the `^1.98.4` range), wallet-standard-features → 1.5.0, every launch-path reader to version 1 with one v1 fixture each |
| 1 | 1.5 to 2 | `@solana/kit` 8.5.0 and `@solana/compat` as app dependencies; `signPlanV1.ts` beside `signPlan.ts`: convert, build, size by simulation, byte-level wallet-return and guard checks, mint signature append, 4,096-byte and 64-account checks; unit tests mirroring `signPlan`'s |
| 2 | 1 | `SignCard`: capability detection, direct wallet-standard signing with bytes, raw base64 simulate and send through the proxy, the three-way readiness message, plan-record version pin |
| 3 | 1 | devnet proof steps 6 to 9 with the owner and the real extension; reply to Rory with the signature and the readings |
| 4 | 0.5 | runsheet and docs; confirm the mainnet RPC upstream is Agave 4.2.2 or newer |

**Risks.**

- Phantom's shipped extension may not advertise or sign v1 yet. Then the work ships behind the capability check and every creator still
  gets v0 until Phantom flips it; the review cannot complete on our side alone. Ask Rory for the version before step 3.
- Lighthouse behaviour in v1 is undocumented. If the guard rewrites the message in a way the byte comparison refuses, the launch is
  refused before send (safe, but blocked) and the comparison has to be relaxed exactly as it was for v0 in October.
- Readers: thirty call sites pinned to 0, nine on the launch path. A missed one makes a landed launch look unlanded to the site. The
  web3.js 1.99.0 bump covers the `Connection` readers; the hand-rolled JSON readers need fixtures.
- RPC upstream: an older node stores v1 as v0, so a successful send can still break every reader. Check the provider's version first.
- Client bundle: kit adds weight to the launch page. Import only the functions used; measure after step 1.
- Duplicate accounts are rejected in v1. The create step compiled without complaint (kit would have thrown), but every other step shape
  (pair curve, vault mode) needs the same compile check in tests.
- Two signing modules for one plan is drift risk. Keep one runner (`signAndSendPlan`) with a format strategy object rather than a
  second runner, so the deadline, lock, reconcile and recovery rules stay single-sourced.

**Recommended order.** Step 0 first (it is independent, low risk and needed whatever Phantom does), then step 1 with tests, then step 2,
then the devnet proof with the real extension, then the reply to Rory. Keep the v0 path and the lookup-table pin in place throughout;
nothing is removed until Phantom's extension is confirmed to advertise 1 on mainnet.

## Sources read

- Phantom recipe: https://docs.phantom.com/recipes/transactions/send-solana-v1-transaction (kit 8.3.0, wallet-standard-features 1.5.0;
  simulate with signature verification off before signing; `maxSupportedTransactionVersion: 1` on reads)
- Solana upgrade page: https://solana.com/upgrades/larger-transaction-sizes (4,096 bytes; 64 inline accounts; no lookup tables;
  limits default to zero in v1; 32 KiB page rounding; base64 required over 1,232 bytes; mainnet active since epoch 1035 on
  2026-09-15; kit ≥ 8.0.0 or web3.js ≥ 3.0.2 to build, web3.js 1.99.0 read only; Agave RPC ≥ 4.2.2)
- Solana news, v1 and the lookup-table trade-off: https://solana.com/news/transaction-v1-and-the-alt-trade-off
- Foundation examples: https://github.com/solana-foundation/transaction-v1-examples (`ts/kit/src/send-decode.ts`:
  `createTransactionMessage({ version: 1 })`, `setTransactionMessageConfig`)
- Foundation dev-skill reference on v1 (capability check `supportedTransactionVersions.has(1)`, fallback keeps a v0 client)
- web3.js 1.99.0 release and PR 3866 (read-only `MessageV1`; serialise, build, sign unsupported)
- `@solana/wallet-standard-features` 1.5.0 types (`SolanaTransactionVersion = 'legacy' | 0 | 1`)
- npm: `@raydium-io/raydium-sdk-v2` dist-tags and 2.0.x dependencies; `@solana/kit` 8.5.0; `@solana/compat` 8.5.0
- Solana Compass, 2026-10-02: Backpack ships v1 signing; Phantom, Solflare, Ledger, Trezor not yet announced

## Step 0 done 2026-10-19

Branch `burnticker/phantom-v1-step0` (worktree `Projects/mct-wt-PHANTOM0`). Nothing merged, published or pushed.

**Dependencies.** `@solana/web3.js` 1.98.4 → 1.99.0 (package.json now `^1.99.0`, the floor the readers rely on; the lock moved only
web3.js, its own nested `@solana/codecs-*` and `@solana/errors` 2.3.0 → 5.5.1 and the `commander` copy under them).
`@solana/wallet-standard-features` 1.4.0 → 1.5.0, added as a direct dependency (`^1.5.0`; it was transitive) so the types carry
`'legacy' | 0 | 1`. web3.js 1.99.0 confirms the scope's reading: `MessageV1.deserialize` and the JSON parse of a v1 `getTransaction`
work; `serialize` and `VersionedTransaction.sign` on a v1 message throw "not supported". The builder is step 1.

**The v1 shape, from the chain.** Devnet runs solana-core 4.4.0-beta.0 and already carries version-1 transactions. One was read
(`31asXs…bgHE`, slot 512,809,123) into `test/fixtures/burnticker/v1-ledger-devnet.json`: `version: 1`, a `transactionConfig` block
(`computeUnitLimit`, `heapSize`, `loadedAccountsDataSizeLimit`, `priorityFee`) inside `transaction.message`, no `addressTableLookups`,
signatures under `transaction.signatures` as before. The same RPC asked with `maxSupportedTransactionVersion: 0` answers JSON-RPC
error -32015 "Transaction version (1) is not supported by the requesting client" (kept in the fixture, replayed by the tests).

**Readers moved to version 1** (the launch's critical path):

- `src/lib/burnticker/launchVerify.ts` (the `TxReader` type and the create confirmation's read)
- `src/lib/burnticker/draftReconciler.ts` (`withSignerReads`, the batched signer read)
- `src/lib/burnticker/launchRecovery.ts` (`chainReadDeps`, the browser's settle ladder)
- `src/lib/burnticker/programClient.ts` (`findReceiptOnChain`, `memoOfTransaction`)
- `src/lib/burnKeeper/programAdapter.ts` (`parsedTx`)
- `src/lib/burnticker/trust.ts` (`web3ChainReader.lamportsDelta`)
- `src/lib/burnticker/trustpack/receiptCheck.ts`, `trustpack/ledger.ts`, `trustpack/neverBuys.ts` (raw JSON-RPC; one v1 fixture each
  under `test/fixtures/burnticker/`, allowlisted for the public tree)
- `src/lib/burnticker/history.ts` (the curl the verify page prints)
- `src/lib/burnticker/signPlan.ts` (comment on `getTransaction` only)

**Readers left at version 0, and why:**

- `src/lib/burnticker/lifecycleDates.ts` already copes: it asks for 0 and, on the RPC's -32015, asks again with the version the RPC
  names (its own test covers version 1; the new test replays the devnet answer through it). Unchanged.
- The keeper's reads of its own sends (`src/lib/burnticker/pairForwardChain.ts`, `endSinkChain.ts`, `lockFeesChain.ts`,
  `src/lib/burnKeeper/solanaChain.ts`, `src/lib/pairCurve/client.ts`, `src/lib/burnReceipts/crank.ts`): the keeper builds legacy or
  v0 with its own key and does not need v1 (section 4).
- `src/lib/burnticker/swap/chain.ts`: the swap panel's own transactions, built by the swap path, not the launch flow; moves with that
  builder if it ever changes format.
- `src/lib/burnticker/sources/copycats.ts`: reads the oldest transaction of a third-party coin on another launchpad for the copycat
  check; a v1 answer there is an RPC error the source already treats as "creator unknown". Not a Burnticker launch.
- Operator scripts reading the keeper's or their own transactions (`scripts/burnticker-trustpack.mts`,
  `scripts/ops/verify-evidence-signatures.mjs`, `scripts/burnticker-swap-proof.mts`, `scripts/burnkeeper-devnet-demo.mts`,
  `scripts/keypair-signer.mjs`): flip when the first v1 evidence row exists.
- The trading bots' readers outside the platform tree: never see Burnticker launches.

**Tests.** `test/burntickerTxVersion1.test.ts` (13 cases): the fixtures' shape; a hand-encoded 0x81 message (`test/burntickerV1Helpers.ts`,
byte for byte as web3.js's decoder reads it) deserialized with every config-mask combination; a real web3.js `Connection` over a fake
fetch serving the devnet capture, refusing version 0 with the RPC's own error, driven through `launchVerify`, `withSignerReads`,
`chainReadDeps`, `web3ChainReader.lamportsDelta` and `getParsedTransaction`; the three raw readers over their fixtures (the $DEFICIT
receipt re-enveloped as v1 passes all ten checks); `fetchTx`'s retry; the verify curl. `test/burntickerCodexReview.test.ts` gains the
real launch bundle landed as a v1 message beside its legacy and v0 cases. Gates: eslint clean on the changed files, `tsc` clean for
them (the two pre-existing errors are the spike under `research/` with its own node_modules, and Next's generated `LayoutProps` type
absent until a `next` build), 578 tests across `test/burntickerLaunch*`, `test/burntickerTrust*`, the keeper, swap and lifecycle files.

**Not done, by design.** No v1 builder, no change to `signPlan.ts`'s builder or `SignCard.tsx`; the v0 path and the lookup-table pin
are untouched. The SignCard still checks `supportedTransactionVersions.has(0)`; the `has(1)` decision is step 2.

**One side effect to know.** The worktree's `node_modules` is a symlink to the main checkout's, so the main checkout now runs web3.js
1.99.0 and wallet-standard-features 1.5.0 while its own `package-lock.json` still says 1.98.4 / 1.4.0 until this branch merges.

