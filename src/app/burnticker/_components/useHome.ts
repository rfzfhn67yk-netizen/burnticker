"use client";
import { useEffect, useState } from "react";
import type { HomeData } from "@/lib/burnticker/home";

/**
 * The home data (GET /api/burnticker/home: the featured cards and the activity line) for client components: one read per page load,
 * shared by the header's activity line and the coin list. `error` is set when the read fails; nothing is ever invented in its place.
 */
let pending: Promise<HomeData> | null = null;
function load(): Promise<HomeData> {
  pending ??= fetch("/api/burnticker/home").then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as HomeData; });
  pending.catch(() => { pending = null; });
  return pending;
}
export function useHome(): { data: HomeData | null; error: string | null } {
  const [s, setS] = useState<{ data: HomeData | null; error: string | null }>({ data: null, error: null });
  useEffect(() => { let live = true; load().then((data) => { if (live) setS({ data, error: null }); }, (e) => { if (live) setS({ data: null, error: String(e?.message ?? e) }); }); return () => { live = false; }; }, []);
  return s;
}
