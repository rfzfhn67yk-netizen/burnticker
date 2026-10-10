// Teaches Node how to resolve this project's "@/..." path alias (tsconfig.json "paths") so `node --test` and the keeper scripts run
// the TypeScript sources directly — Node 22.6+ strips types on its own; no jest, vitest or ts-node. Registered via --import.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const srcDir = path.resolve(import.meta.dirname, "../src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    // "server-only" throws outside Next's server condition; outside the bundler it is replaced by an empty module.
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    // "next/server" has no extensionless entry for Node ESM; route tests import route modules, which import it.
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      const target = path.join(srcDir, specifier.slice(2));
      for (const candidate of [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]) {
        try { return nextResolve(pathToFileURL(candidate).href, context); } catch { /* next candidate */ }
      }
    }
    return nextResolve(specifier, context);
  },
});
