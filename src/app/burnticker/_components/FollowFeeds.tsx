"use client";
import { FollowButton } from "./FollowButton";
import { NEXT_RESULT_LABELS, NEXT_RESULT_LEAD } from "@/lib/burnticker/followFeeds";

/**
 * Follow (this browser only) and, beside it, the two ways to hear about the next result: the coin's RSS feed and its calendar file
 * (followFeeds.ts). The coin page header and the $DEFICIT page header.
 */
export function FollowFeeds({ watchKey, ticker, rss, ics }: { watchKey: string | null; ticker: string; rss: string; ics: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-follow-feeds>
      {watchKey && <FollowButton watchKey={watchKey} ticker={ticker} />}
      <span className="text-neutral-400">{NEXT_RESULT_LEAD} <a className="underline" href={rss} data-feed-rss>{NEXT_RESULT_LABELS.rss}</a> <span aria-hidden="true">·</span> <a className="underline" href={ics} download data-feed-ics>{NEXT_RESULT_LABELS.calendar}</a></span>
    </div>
  );
}
