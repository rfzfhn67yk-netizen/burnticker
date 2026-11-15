"use client";
import { useLayoutEffect } from "react";
import { reapplyStoredTheme } from "./theme";

/**
 * RE-APPLY THE STORED THEME ON HYDRATION (prelaunch audit 2026-10-18 A-24). A page that calls notFound() is answered by Next 16 with a
 * bare error document (<html id="__next_error__">) and the browser then builds the whole page itself, so the root layout's THEME_BOOT
 * script never runs and a visitor who chose the light theme got the dark palette under the light header. This sets the same
 * attribute THEME_BOOT sets, before paint, whenever the root mounts. It never changes a theme already in place.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    reapplyStoredTheme(document.documentElement, storage);
  }, []);
  return null;
}
