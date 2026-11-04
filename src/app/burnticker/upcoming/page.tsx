import type { Metadata } from "next";
import NextResults from "./NextResults";
import { withShareCard } from "@/lib/burnticker/pageMeta";

const DESCRIPTION = "The next result each Burnticker coin waits for: the event, who publishes it and on what schedule, and where the latest result stands.";
export const metadata: Metadata = withShareCard({ title: "Next results", description: DESCRIPTION, alternates: { canonical: "/burnticker/upcoming" } });

/** /burnticker/upcoming (website-14, product idea 3). The page itself is the client component in ./NextResults.tsx. */
export default function Page() {
  return <NextResults />;
}
