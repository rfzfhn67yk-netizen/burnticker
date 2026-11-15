import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { fitName } from "@/lib/burnticker/launchFields";

/**
 * LAUNCH LIBRARY 2 BY PROVIDER, AND ONE NAMED LAUNCH (sources-2, 2026-10-12). The Space Devs' Launch Library 2 (ll.thespacedevs.com,
 * keyless, 15 requests an hour without a key; "the entire database is accessible to everyone, for free"). The generic attested-http
 * engine reads both from their sources.json entries; this module holds the parameters, the provider table and the coin text.
 *
 *   ll2.provider:<provider id>   one reading per UTC day: the provider's SUCCESSFUL ORBITAL launches that day (suborbital excluded with
 *                                include_suborbital=false; status "Success" counts 1, anything else 0); days without one read 0.
 *                                "burns per successful SpaceX launch". The provider must be in LL2_PROVIDERS (the API's featured list,
 *                                captured 2026-10-12: config/burnticker/fixtures/http/ll2.agencies.json).
 *   ll2.launch:<launch uuid>     ONE reading, once the launch's status is final: "Success" reads 1, "Failure" or "Partial Failure"
 *                                reads 0, read the UTC day after its launch time; Go, TBD, Hold, In Flight give no reading. A one-shot
 *                                (rules.ts isOneShot): the coin resolves once and winds down.
 *
 * How it fails: an HTTP error (429 when the anonymous limit is used up), an unknown launch (404) or a body without rows raises; the keeper
 * records a failed fetch, writes nothing and retries with backoff. A pending launch is "no reading yet", never a 0.
 */

/** The providers Launch Library 2 marks as featured (GET /2.3.0/agencies/?featured=true, 2026-10-12). Id → the name the text uses. */
export const LL2_PROVIDERS: Readonly<Record<string, { name: string; abbrev: string }>> = {
  "115": { name: "Arianespace", abbrev: "ASA" },
  "159": { name: "Avio", abbrev: "AVIO" },
  "141": { name: "Blue Origin", abbrev: "BO" },
  "88": { name: "China Aerospace Science and Technology Corporation", abbrev: "CASC" },
  "17": { name: "China National Space Administration", abbrev: "CNSA" },
  "265": { name: "Firefly Aerospace", abbrev: "FA" },
  "31": { name: "Indian Space Research Organization", abbrev: "ISRO" },
  "37": { name: "Japan Aerospace Exploration Agency", abbrev: "JAXA" },
  "96": { name: "Khrunichev State Research and Production Space Center", abbrev: "KHSC" },
  "44": { name: "NASA", abbrev: "NASA" },
  "257": { name: "Northrop Grumman Space Systems", abbrev: "NGSS" },
  "147": { name: "Rocket Lab", abbrev: "RL" },
  "63": { name: "Roscosmos", abbrev: "RFSA" },
  "121": { name: "SpaceX", abbrev: "SPX" },
  "124": { name: "United Launch Alliance", abbrev: "ULA" },
};

export const LL2_PROVIDER_ID = "ll2.provider", LL2_LAUNCH_ID = "ll2.launch";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ll2ProviderSeries = (provider: string | number): string => `${LL2_PROVIDER_ID}:${provider}`;
export const ll2LaunchSeries = (uuid: string): string => `${LL2_LAUNCH_ID}:${uuid.toLowerCase()}`;
export function parseLl2Series(id: string): { kind: "provider"; provider: string; name: string } | { kind: "launch"; launch: string } | null {
  let m = /^ll2\.provider:(\d{1,5})$/.exec(id);
  if (m) return LL2_PROVIDERS[m[1]] ? { kind: "provider", provider: m[1], name: LL2_PROVIDERS[m[1]].name } : null;
  m = /^ll2\.launch:([0-9a-f-]{36})$/.exec(id);
  return m && UUID.test(m[1]) ? { kind: "launch", launch: m[1] } : null;
}

/** The catalogue's parameter hook for ll2.provider (the provider must be in the table). */
export function applyLl2Provider(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  const p = LL2_PROVIDERS[param];
  if (!p) throw new Error(`ll2.provider: ${param} is not a provider in the table (${Object.keys(LL2_PROVIDERS).join(", ")})`);
  return { ...cfg, request: { ...cfg.request, url: cfg.request.url.split("{provider}").join(param) }, sourceUrl: cfg.sourceUrl.split("{provider}").join(param), title: `Successful orbital launches by ${p.name} (Launch Library 2)`, unit: { ...cfg.unit, label: `1 ${p.name} launch`, definition: `per UTC day: each successful orbital launch by ${p.name} counts 1; failures and suborbital flights count nothing` } };
}
/** The catalogue's parameter hook for ll2.launch. */
export function applyLl2Launch(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  if (!UUID.test(param)) throw new Error(`ll2.launch: ${param} is not a Launch Library 2 launch id`);
  return { ...cfg, request: { ...cfg.request, url: cfg.request.url.split("{launch}").join(param) }, sourceUrl: cfg.sourceUrl.split("{launch}").join(param), title: `Launch ${param} succeeds (Launch Library 2)` };
}

/** The coin text pieces (lint-clean; test/burntickerSources2.test.ts lints every variant). `launchName` is the launch's name when known. */
export function ll2Text(s: NonNullable<ReturnType<typeof parseLl2Series>>, spends: string, inverse: boolean, launchName: string | null = null): { name: string; ticker: string; oneLiner: string; block: string; oneShot: boolean } {
  const src = "The result comes from Launch Library 2, a public launch database run by The Space Devs.";
  if (s.kind === "provider") {
    const p = LL2_PROVIDERS[s.provider];
    if (inverse) return { name: fitName(`No ${p.name} Launch Days`), ticker: `NO${p.abbrev}`.slice(0, 10), oneLiner: `burns on every day ${p.name} has no successful launch`, oneShot: false,
      block: `For every day ${p.name} has no successful orbital launch, ${spends}, with a receipt on chain. ${src} Each day is read once it is over in UTC. A day with a successful launch burns nothing.` };
    return { name: fitName(`${p.name} Launches`), ticker: `${p.abbrev}LAUNCH`.slice(0, 10), oneLiner: `burns for every successful ${p.name} launch`, oneShot: false,
      block: `For every successful orbital launch by ${p.name}, ${spends}, with a receipt on chain. Two launches on one day burn twice. ${src} Each day is read once it is over in UTC. A failed launch, a suborbital flight or a day with no launch burns nothing.` };
  }
  // intent audit 2 item 2: never a bare "this launch"; with no name known, the immutable id the rule locks
  const what = launchName ? `the launch named ${launchName}` : `the launch with Launch Library 2 id ${s.launch}`;
  return { name: "Launch Success", ticker: "LAUNCHOK", oneLiner: `burns if ${what} succeeds`, oneShot: true,
    block: `If ${what} succeeds, ${spends} once, with a receipt on chain. ${src} The status is read the day after the launch, once it says success, failure or partial failure. A failure, a partial failure or a scrubbed launch burns nothing.` };
}
