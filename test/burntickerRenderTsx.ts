// RENDER A .tsx COMPONENT IN A NODE TEST (2026-10-18, coin card status). Node strips TypeScript types but not JSX, so this registers
// two module hooks for the test process only: a .tsx file is transpiled with the project's own TypeScript (react-jsx), and a relative
// import without an extension from a .tsx file finds its .tsx or .ts file. Import it before the component; then render with
// react-dom/server's renderToStaticMarkup.
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import ts from "typescript";

registerHooks({
  resolve(spec, ctx, next) {
    if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.endsWith(".tsx") && !/\.(m?js|tsx?|json|css)$/.test(spec)) {
      const base = new URL(spec, ctx.parentURL);
      for (const ext of [".tsx", ".ts"]) { const u = base.href + ext; if (fs.existsSync(fileURLToPath(u))) return next(u, ctx); }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, ctx);
    const file = fileURLToPath(url);
    const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } }).outputText;
    return { format: "module", source: out, shortCircuit: true };
  },
});
