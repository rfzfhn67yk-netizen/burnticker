/**
 * THE ONE IMPORT OF THE SDK. Inside the Burnticker repository this re-exports the SDK's source (packages/burnticker-sdk), run through the
 * repo's path-alias hook (`--import ../../test/alias-hook.mjs`, see package.json). Outside the repository, once `@burnticker/sdk` is
 * installed from npm, change the path in the line below to the package name, `@burnticker/sdk` (a star re-export of the package).
 * Nothing else in this starter changes.
 */
export * from "../../burnticker-sdk/src/index.ts";
