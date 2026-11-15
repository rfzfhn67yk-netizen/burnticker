/**
 * WHAT THIS SITE DOES NOT READ, FOR A VISITOR (ChatGPT audit 6 item 25). The platform's host notes (server.ts `stubs`) are written for
 * the operator: client class names, environment variables, script names. A public page used to print "Some live data is not connected on
 * this site" over them on every host, even one where everything was wired, because the notes also describe what IS connected. This turns
 * the notes into the gaps a visitor meets, each in plain words with what it means for them, and drops the notes that are not gaps. An
 * empty list means the public pages say nothing. The raw notes stay on the Trust page, behind a disclosure, for anyone who wants them.
 * Client-safe and pure.
 */
export interface HostGap { id: string; text: string }

const RULES: { id: string; when: RegExp; unless?: RegExp; text: string }[] = [
  { id: "curve", when: /curve progress and top holders: no /i, text: "This site does not read each coin's curve or holders right now, so those card rows say No data yet. The numbers on chain are not affected." },
  { id: "program", when: /^burn_receipts program\b.*(FakeBurnProgram|no program id)/i, text: "This site does not read the burn program on chain right now, so it shows the published receipts only. Each receipt still links its transaction, which you can check yourself." },
  { id: "confirm", when: /^launch confirmation: /i, text: "This site cannot confirm a new launch on chain right now, so new coins are not listed here until it can." },
  { id: "mainnet-launch", when: /^mainnet launches: refused/i, text: "Launching a coin on mainnet is not open on this site." },
  { id: "polymarket", when: /^Polymarket discovery: off/i, text: "New Polymarket markets are not offered as coin sources on this site right now. Coins that already follow one still settle from its on-chain result." },
  { id: "launchlab", when: /^LaunchLab\b/i, unless: /real client/i, text: "This site cannot build a coin launch right now, so the launch page shows its steps without a working Launch button." },
];

/** The visitor-facing gaps in this host's notes, in a fixed order, each once. Notes that describe a working connection are not gaps. */
export function hostGaps(stubs: readonly string[]): HostGap[] {
  const out: HostGap[] = [];
  for (const r of RULES) if (stubs.some((s) => r.when.test(s) && !(r.unless && r.unless.test(s)))) out.push({ id: r.id, text: r.text });
  return out;
}

/** The heading over the gaps on a public page. */
export const HOST_GAPS_HEADING = "What this site does not show right now";
/** The Trust page's disclosure for the raw notes. */
export const HOST_NOTES_SUMMARY = "Show the operator details";
