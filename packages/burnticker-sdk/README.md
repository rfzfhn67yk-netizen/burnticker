# @burnticker/sdk

Build on Burnticker from a bot: launch memecoins on Raydium LaunchLab whose supply burns when a verifiable
real-world event settles, read every coin's status and receipts, verify any receipt from its source and the chain, and submit the
permissionless burn crank. Public data and **unsigned** transactions only. The SDK never asks for a key, never signs for you, and
never sends.

```ts
import { Burnticker, rules } from "@burnticker/sdk";

const bt = new Burnticker({ apiBase: "https://<host>/api/burnticker/v1" });
const rule = rules.compose({ series: "KXNFLGAME", filter: { tickerIncludes: "-DEN" } }, { kind: "binary", binary: { onYes: { fractionOfPool: 0.02 } } });
console.log(rules.sha256(rule));                         // the hash every receipt of such a coin cites
console.log((await bt.kalshi.backtest(rule)).sentence);  // what it would have burned over the last 12 months
const coin = await bt.token("BRONCO");                   // status, receipts, next burn, implied chance (display only)
console.log(await bt.verifyReceipt(coin.receipts[0], { ticker: coin.ticker, rulesText: coin.rulesText }));
```

Surface, the receipt verification walk-through, the crank, events, and what you cannot do (change a rule, claim a fee, adopt an
existing coin): `docs/burnticker/sdk.md`. HTTP API: `docs/burnticker/api.md`. Examples: `examples/` (a launch bot, a crank bot, a
receipt announcer).

License: not chosen yet (`UNLICENSED` until the owner decides).
