/**
 * THE SETTLEMENT-COVERAGE AUDIT (2026-10-10). Which categories and selector kinds can be settled without Kalshi: a primary source with
 * an independent cross-read, or Polymarket's on-chain payout vector — and what cannot be settled at all. See types.ts for the rule,
 * matrix.ts for the verdicts, dryRun.ts for the 90-day dry run, preflight.ts for the creation check, report.ts for the CLI/API/doc glue.
 */
export * from "@/lib/burnticker/coverage/types";
export { coverageMatrix, coverageExitCode, SELECTOR_KINDS, SETTLEMENT_RULE, type MatrixOptions } from "@/lib/burnticker/coverage/matrix";
export { historicalDryRun, readFeed, type DryRunOptions } from "@/lib/burnticker/coverage/dryRun";
export { preflightSelector, preflightStrict, PREFLIGHT_FLAG, type PreflightDeps } from "@/lib/burnticker/coverage/preflight";
export { buildCoverage, renderCoverageMarkdown, allDescriptors, runFetch, type CoverageBuildOptions } from "@/lib/burnticker/coverage/report";
export { compareFact, crossReadEligibility, crossReadsOf, describeEntry, domainOf, isKalshi, primaryEligibility } from "@/lib/burnticker/coverage/sources";
export { scheduleOf, expectedPeriods, nextExpected, usFederalHolidays, isBusinessDay } from "@/lib/burnticker/coverage/schedule";
