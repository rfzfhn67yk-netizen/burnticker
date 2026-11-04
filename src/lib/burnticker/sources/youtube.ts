import type { HttpSourceConfig } from "@/lib/burnticker/sources/attestedHttp";
import { fitName } from "@/lib/burnticker/launchFields";

/**
 * YOUTUBE CHANNEL MILESTONES (sources-2, 2026-10-12). Built so the catalogue can name it, and NOT LAUNCHABLE: the YouTube API Services
 * Developer Policies (read 2026-10-12, sources.json `terms`) forbid what a settlement needs. They say a client must not "access or use
 * API Data to create new or derived data or metrics", must not store statistics such as a channel's subscriber count for more than
 * 30 days without the channel owner's authorization, and must not "offer or provide incentives ... for engaging with YouTube
 * Applications", subscribing included. A burn receipt is a permanent record derived from the count, and a coin that burns when a
 * channel passes N subscribers is an incentive to subscribe. It needs YouTube's written approval first.
 *
 *   youtube.milestone:<channel id>/<subscribers|views>.<N>   ONE reading, the first time the keeper reads the channel's count at or
 *                                                             above N (id reached-<N>). Public figures and organisations only: a channel
 *                                                             under 100,000 subscribers, or one that hides its count, is refused (a
 *                                                             refusal, never a reading).
 *   key       BURNTICKER_YOUTUBE_API_KEY (a free Google Cloud API key the owner creates; read at request time, never stored or logged).
 *             Without it every read fails as unavailable: the keeper records a failed fetch and writes nothing.
 */

export const YOUTUBE_MILESTONE_ID = "youtube.milestone";
export const YOUTUBE_KEY_ENV = "BURNTICKER_YOUTUBE_API_KEY";
/** The public-channel bar: below this many subscribers a channel is not read. */
export const YOUTUBE_PUBLIC_MIN_SUBSCRIBERS = 100_000;
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
export type YoutubeMetric = "subscribers" | "views";
export const youtubeMilestoneSeries = (channel: string, metric: YoutubeMetric, n: number): string => `${YOUTUBE_MILESTONE_ID}:${channel}/${metric}.${n}`;
export function parseYoutubeSeries(id: string): { channel: string; metric: YoutubeMetric; n: number } | null {
  const m = /^youtube\.milestone:([A-Za-z0-9_-]{24})\/(subscribers|views)\.(\d{4,12})$/.exec(id);
  if (!m || !CHANNEL.test(m[1])) return null;
  const n = Number(m[3]);
  return n >= 1_000 && n <= 100_000_000_000 ? { channel: m[1], metric: m[2] as YoutubeMetric, n } : null;
}

/** The catalogue's parameter hook: the channel into the URL, the metric's path and N into the milestone, the public-channel guard. */
export function applyYoutubeMilestone(cfg: HttpSourceConfig, param: string): HttpSourceConfig {
  const s = parseYoutubeSeries(`${YOUTUBE_MILESTONE_ID}:${param}`);
  if (!s) throw new Error(`youtube.milestone: ${param} is not <channel id>/<subscribers|views>.<N>`);
  const path = s.metric === "subscribers" ? "items[0].statistics.subscriberCount" : "items[0].statistics.viewCount";
  return { ...cfg, request: { ...cfg.request, url: cfg.request.url.split("{channel}").join(s.channel) }, sourceUrl: cfg.sourceUrl.split("{channel}").join(s.channel), title: `YouTube channel ${s.channel} passes ${s.n.toLocaleString("en-US")} ${s.metric}`,
    select: { ...cfg.select, milestone: { path, at: s.n, guard: { path: "items[0].statistics.subscriberCount", min: YOUTUBE_PUBLIC_MIN_SUBSCRIBERS, why: `public figures and organisations only: a channel under ${YOUTUBE_PUBLIC_MIN_SUBSCRIBERS.toLocaleString("en-US")} subscribers, or one that hides its count, is not read` } } } };
}

/** The coin text pieces, for the catalogue card only while the source is not launchable (lint-clean). */
export function youtubeText(s: { channel: string; metric: YoutubeMetric; n: number }, spends: string, channelName: string | null = null): { name: string; ticker: string; oneLiner: string; block: string; oneShot: boolean } {
  const who = channelName ? `the ${channelName} YouTube channel` : "this YouTube channel", n = s.n.toLocaleString("en-US");
  return { name: fitName(`${channelName ?? "Channel"} ${n}`), ticker: "YTMILE", oneLiner: `burns once when ${who} passes ${n} ${s.metric}`, oneShot: true,
    block: `The first time ${who} reads ${n} ${s.metric} or more, ${spends} once, with a receipt on chain. The count comes from the YouTube Data API. If it stays under ${n}, nothing burns.` };
}
