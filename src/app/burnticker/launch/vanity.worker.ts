import { runGrindWorker, type SubtleLike, type WorkerScopeLike } from "@/lib/burnticker/vanityMint";

/**
 * One mint-address search (vanityMint.ts runGrindWorker): the page starts navigator.hardwareConcurrency of these. Everything heavy runs
 * here, off the page's thread. A found key's secret is posted to the page that started this worker and to nothing else; no request is
 * made from here.
 */
const scope = self as unknown as WorkerScopeLike & { crypto: Crypto };
runGrindWorker(scope, {
  subtle: (scope.crypto?.subtle ?? null) as unknown as SubtleLike | null,
  randomBytes: (n) => scope.crypto.getRandomValues(new Uint8Array(n)),
  now: () => performance.now(),
  pause: () => new Promise((r) => setTimeout(r, 0)),
});
