"use client";
import { useEffect, useState } from "react";
import { LAUNCH_AVAILABILITY_UNKNOWN, launchAvailabilityFromCatalogue, type LaunchAvailability } from "@/lib/burnticker/creatorLaunches";
import { loadCatalogue } from "@/lib/burnticker/catalogueClient";

/**
 * The creator-launch availability for client pages (creatorLaunches.ts): one catalogue read per page load, shared by every component
 * that asks; CLOSED until the catalogue says `launches.creators: true` (and stays closed when it cannot be read).
 */
let pending: Promise<LaunchAvailability> | null = null;
function load(): Promise<LaunchAvailability> {
  // site audit #18: the one shared catalogue read (catalogueClient.ts), the launch page's included
  pending ??= loadCatalogue().then(launchAvailabilityFromCatalogue).catch(() => LAUNCH_AVAILABILITY_UNKNOWN);
  return pending;
}
export function useLaunchAvailability(): LaunchAvailability {
  const [a, setA] = useState<LaunchAvailability>(LAUNCH_AVAILABILITY_UNKNOWN);
  useEffect(() => { let live = true; void load().then((x) => { if (live) setA(x); }); return () => { live = false; }; }, []);
  return a;
}
