"use client";
import { useEffect, useState } from "react";
import { SITE_LAUNCH_STATE_LOADING, siteLaunchStateFromCatalogue, type SiteLaunchState } from "@/lib/burnticker/launchAvailability";
import { loadCatalogue } from "@/lib/burnticker/catalogueClient";

/**
 * The site's launch record for client components (website-12's SiteLaunchState, read from the one shared catalogue request). Loading
 * until the catalogue answers; a failed read is "unavailable", and both keep every launch control off. The header, the launch dialog and
 * any page sentence about launching read this, never a typed "open" or "closed".
 */
export function useSiteLaunchState(): SiteLaunchState {
  const [s, setS] = useState<SiteLaunchState>(SITE_LAUNCH_STATE_LOADING);
  useEffect(() => {
    let live = true;
    loadCatalogue().then((j) => { if (live) setS(siteLaunchStateFromCatalogue(j)); }, (e: unknown) => { if (live) setS(siteLaunchStateFromCatalogue(null, { failure: String((e as Error)?.message ?? e) })); });
    return () => { live = false; };
  }, []);
  return s;
}
