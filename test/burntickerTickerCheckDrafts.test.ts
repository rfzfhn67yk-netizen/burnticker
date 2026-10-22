// PRELAUNCH AUDIT 2026-10-18 A-40: a draft's mint and creator were public by ticker before its launch landed (/v1/tokens/<TICKER>,
// /api/burnticker/tokens/<TICKER>, the review's ticker check). A ticker now resolves launched coins only; a draft is found by its mint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { API, callRoute, makeWorld } from "./burntickerApiHelpers.ts";
import { lockRule } from "@/lib/burnticker/rules";
import { BRONCOS } from "./burntickerHelpers.ts";
import { lookupCoin, registryCoinKey } from "@/lib/burnticker/coinLookup";
import { tickerChecks } from "@/lib/burnticker/tickerCheck";

type Handler = (req: Request, ctx: { params: Promise<{ ticker: string }> }) => Promise<Response>;
const pageApi = async (key: string): Promise<Response> => {
  const { GET } = await import("../src/app/api/burnticker/tokens/[ticker]/route.ts") as { GET: Handler };
  return GET(new Request(`http://bt.test/api/burnticker/tokens/${encodeURIComponent(key)}`), { params: Promise.resolve({ ticker: key }) });
};

test("A-40: a draft is hidden from its ticker everywhere (v1 tokens, the page API, the review) and found by its mint", async () => {
  const w = await makeWorld();
  const mint = Keypair.generate().publicKey.toBase58(), creator = Keypair.generate().publicKey.toBase58();
  w.registry.register({ mint, ticker: "SECRETD", name: "Secret draft", creator, description: "", imageUrl: null, links: [], rulesText: lockRule(BRONCOS).text, feePda: "F", vault: null, tokenConfig: null, poolId: null, launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date().toISOString(), status: "draft" });
  assert.equal(lookupCoin(w.registry, "SECRETD").kind, "none");
  assert.equal(lookupCoin(w.registry, mint).kind, "one");
  assert.equal(registryCoinKey(w.registry, w.registry.token(mint)!), mint, "a draft's links use its mint");
  const v1 = await callRoute(`${API}/tokens/SECRETD`);
  assert.equal(v1.status, 404);
  assert.doesNotMatch(await v1.text(), new RegExp(`${mint}|${creator}`));
  const pg = await pageApi("SECRETD");
  assert.equal(pg.status, 404);
  assert.doesNotMatch(await pg.text(), new RegExp(`${mint}|${creator}`));
  assert.equal((await pageApi(mint)).status, 200, "the creator's own view, by mint");
  const [chk] = tickerChecks([{ side: "A", ticker: "SECRETD" }], { inUse: (t) => w.registry.tokensByTicker(t), reserved: new Set(), creator: Keypair.generate().publicKey.toBase58() });
  assert.equal(chk.taken, true, "the ticker is still held");
  assert.deepEqual(chk.inUse, [], "but the draft is not described");
  assert.doesNotMatch(JSON.stringify(chk), new RegExp(`${mint}|Secret draft|${creator}`));
  // a launched coin on its own ticker still resolves by ticker
  assert.equal(lookupCoin(w.registry, w.deficit.ticker).kind, "one");
});
