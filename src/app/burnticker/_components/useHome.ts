"use client";
import { useEffect, useState } from "react";
import type { HomeData } from "@/lib/burnticker/home";

/**
 * The home data (GET /api/burnticker/home: the featured cards and the activity line) for client components: one read per page load,
 * shared by the header's activity line and the coin list. `error` is set when the read fails; nothing is ever invented in its place.
 */
let pending: Promise<HomeData> | null = null;
function load(): Promise<HomeData> {
  // 2026-10-15: a cold host answers 503 "home-loading" with retry-after while it reads the coins; wait and ask again (up to 6 times)
  // instead of showing the page as broken
  const once = async (left: number): Promise<HomeData> => {
    const r = await fetch("/api/burnticker/home");
    if (r.status === 503 && left > 0) {
      const j = (await r.json().catch(() => null)) as { code?: string; retryAfterSec?: number } | null;
      const wait = Math.min(15, Math.max(2, Number(r.headers.get("retry-after") ?? j?.retryAfterSec ?? 5)));
      await new Promise((res) => setTimeout(res, wait * 1000));
      return once(left - 1);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as HomeData;
  };
  pending ??= once(6);
  pending.catch(() => { pending = null; });
  return pending;
}
export function useHome(): { data: HomeData | null; error: string | null } {
  const [s, setS] = useState<{ data: HomeData | null; error: string | null }>({ data: null, error: null });
  useEffect(() => { let live = true; load().then((data) => { if (live) setS({ data, error: null }); }, (e) => { if (live) setS({ data: null, error: String(e?.message ?? e) }); }); return () => { live = false; }; }, []);
  return s;
}
