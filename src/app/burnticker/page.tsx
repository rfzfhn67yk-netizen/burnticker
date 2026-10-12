import type { Metadata } from "next";
import CoinsIndex from "./CoinsIndex";

// site audit #12 (2026-10-11): the coins index is titled like every other app page ("Coins · Burnticker"); the page itself is the client
// component in ./CoinsIndex.tsx, so this server file can carry the metadata
export const metadata: Metadata = { title: "Coins", alternates: { canonical: "/burnticker" } };

export default function Page() {
  return <CoinsIndex />;
}
