import path from "node:path";

/**
 * NO TEST OPENS THE CHECKOUT'S OWN ./data FILES (2026-10-18 prelaunch audit A-13). On the Burnticker host ./data/burnticker.db of the
 * repository directory IS the live registry, and a test run there once wrote a "launches closed" record into it through the launch
 * route. test/test-isolation.mjs points every test process's BURNTICKER_DB (and the other database paths) at its own temporary
 * directory and sets BURNTICKER_TEST_ISOLATION; this is the second lock: while that marker or NODE_TEST_CONTEXT is set, opening the
 * default file under the current directory's ./data throws instead of writing to it. Outside a test it does nothing.
 */
export function refuseDefaultDataFileUnderTest(file: string, defaultRelative: string, what: string, env: Record<string, string | undefined> = process.env): void {
  if (!env.NODE_TEST_CONTEXT && !env.BURNTICKER_TEST_ISOLATION) return;
  if (file === ":memory:") return;
  if (path.resolve(file) !== path.resolve(defaultRelative)) return;
  throw new Error(`${what}: a test may not open ${path.resolve(file)}, the default ./${defaultRelative.split(path.sep).join("/")} of this checkout (on the host, the live file); test/test-isolation.mjs points it at a temporary file`);
}
