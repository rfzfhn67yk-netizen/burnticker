// devnet-r4 test harness: limits the keeper's pair-curve scan to the pairs in R4X_PAIRS (comma-separated Pair addresses), so the keeper
// never cranks another actor's pairs. Rewrites one line of src/lib/burnKeeper/pairCurveCrank.ts IN MEMORY at load; the file is untouched.
import { registerHooks } from "node:module";
registerHooks({
  load(url, context, nextLoad) {
    const r = nextLoad(url, context);
    if (url.endsWith("/src/lib/burnKeeper/pairCurveCrank.ts")) {
      const src = String(r.source);
      const needle = "  pairs = kept;\n";
      if (src.split(needle).length !== 2) throw new Error("pairfilter-hook: the pairs = kept; line moved — refusing to run unfiltered");
      const out = src.replace(needle, "  pairs = kept.filter((x) => (process.env.R4X_PAIRS ?? \"\").split(\",\").includes(x.address.toBase58()));\n  d.log(`  [r4x-filter] pair scan limited to ${pairs.length} pair(s): ${pairs.map((x) => x.address.toBase58().slice(0, 8)).join(\",\")}`);\n");
      return { ...r, source: out };
    }
    if (url.endsWith("/src/lib/pairCurve/accounts.ts") && process.env.R4X_DECODE_ONLY_MINE === "1") {
      // second, separately-reported harness switch: decode only the listed pairs (the unfiltered scan dies on a legacy 888-byte Pair)
      const src = String(r.source);
      const needle = "  return list.map((x) => ({ address: x.pubkey, pair: decodePair(x.account.data) }));";
      if (src.split(needle).length !== 2) throw new Error("pairfilter-hook: fetchPairs moved — refusing");
      return { ...r, source: src.replace(needle, "  return list.filter((x) => (process.env.R4X_PAIRS ?? \"\").split(\",\").includes(x.pubkey.toBase58())).map((x) => ({ address: x.pubkey, pair: decodePair(x.account.data) }));") };
    }
    return r;
  },
});
