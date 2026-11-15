# Burnticker bot starter

Three small TypeScript bots on [`@burnticker/sdk`](../burnticker-sdk/README.md). Copy them, rename them, build on them.

| Script | What it does | Writes |
|---|---|---|
| `src/follow.ts` | Polls `GET /v1/tokens/<TICKER>/receipts` and prints every new receipt with its verifier call (the server's checks, or `--verify local` to re-run them on your machine) | `.starter-state/follow-<TICKER>.json` (which receipts it has printed) |
| `src/launch.ts` | Builds a launch bundle for a rule from the public catalogue and prints the unsigned transactions and the rule's sha256. **It never signs.** | nothing (add `--register` to reserve the ticker as a 24-hour draft) |
| `src/post.ts` | Renders a coin's receipt post, season card or one league's scoreboard with the platform's own generator, runs the copy lint, and appends a clean post to a queue file | `queue/posts.jsonl` (append-only) |

## Setup

You need Node 22.6 or later (it runs TypeScript directly) and a checkout of the Burnticker repository. The SDK is not on npm yet, so
the kit imports it from the repository through one line, `src/sdk.ts`.

```sh
git clone https://github.com/rfzfhn67yk-netizen/burnticker && cd burnticker
npm ci
cd packages/burnticker-bot-starter
npm run follow -- DEFICIT --once
```

Once `@burnticker/sdk` is published, the kit works outside the repository. Install the SDK, change the one line in `src/sdk.ts` to
`export * from "@burnticker/sdk";`, and drop the `--import ../../test/alias-hook.mjs` flag from the scripts. `post.ts` also uses the
copy lint's word list (`config/launch/copy-lint.json`) and the post templates (`src/lib/launch/`) from the repository. Copy those two
along, or keep running `post.ts` from a checkout.

Settings come from the environment, and none of them is a key:

| Variable | Default |
|---|---|
| `BURNTICKER_API` | `https://burnticker.com/api/burnticker/v1` |
| `BURNTICKER_SITE` | `https://burnticker.com` |
| `STARTER_STATE` | `.starter-state` |
| `STARTER_QUEUE` | `queue/posts.jsonl` |

## The API is keyless

Every read route is public, keyless and CORS-open, with `Cache-Control` set. There is no account, token or signup. The rate limits are
per IP: 120 requests a minute for reads, 20 for routes that re-read a source (verify, search), and 10 an hour for launch bundles. A 429
carries `Retry-After`. `follow.ts` polls every 60 s by default and never faster than every 15 s. See
[docs/burnticker/api.md](../../docs/burnticker/api.md).

## Run them

```sh
npm run follow -- DEFICIT                        # poll every 60 s; Ctrl-C to stop
npm run follow -- DEFICIT --once --verify local  # one pass, verified on this machine
npm run launch                                   # list the sources a rule can launch on
npm run launch -- --source treasury.debt --fraction 0.02 --ticker DEBTX --name "Debt Burn" --wallet <your PUBLIC key>
npm run post -- DEFICIT                          # queue the latest receipt post
npm run post -- DEFICIT --format season-card
npm run post -- --format scoreboard --league nhl # one league per post, never a ranking across leagues
```

## Where a wallet signs: not here

`launch.ts` holds no key. `--wallet` is a public key. The mint keypair the SDK generates for the preview stays in memory and is thrown
away when the script exits. The script prints the server's unsigned transactions, base64 with empty signature slots, and the rule's
sha256. It checks that sha256 against the one it computed locally before any request, and the SDK refuses a bundle whose rule bytes
differ.

A real launch works like this:

1. Keep the mint keypair.
2. Take a fresh blockhash from your own RPC. `launch.withBlockhash(blockhash)` rebuilds the transactions and co-signs them with the
   mint.
3. Let the creator's wallet sign last, and send through your own RPC.
4. Call `bt.confirmLaunch(mint, signature)`.

[`examples/launch-bot.ts`](../burnticker-sdk/examples/launch-bot.ts) and [docs/burnticker/sdk.md](../../docs/burnticker/sdk.md) §2 show
the whole flow. While the bundle says `ready: false`, send nothing.

## The rules

- **No price talk, ever.** No price, market cap, gains, "moon", targets, odds or prizes, and no calls to buy. A post reports what
  supply did. It never says what a price did or will do. `post.ts` runs every post through the platform's copy lint
  (`config/launch/copy-lint.json`) and refuses one with a hit: it prints the hits and queues nothing.
- **No auto-posting.** There is no X or Telegram API anywhere in this kit. `post.ts` appends to a file. A person reads it and posts by
  hand, or not at all. If you wire a sender onto the queue, you take on this rule.
- **The kit never signs and never sends.** `follow.ts` and `post.ts` are read-only. `launch.ts` previews a bundle.
- **Receipts, not claims.** Link the receipt, the transaction and the verifier, and let readers check it themselves.
  `GET /v1/tokens/<TICKER>/verify/<id>` and the SDK's `verifyReceipt` recompute every receipt from the source and the chain.
- Not affiliated with any team, league, candidate, agency or market. Memecoins: the rule says what supply does, not what price does.

Tests: `test/burntickerBotStarter.test.ts` runs all three scripts against the real API handlers on the platform's fakes.
