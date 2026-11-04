import type { Metadata } from "next";
import { ClaimFees } from "./ClaimFees";
import { withShareCard } from "@/lib/burnticker/pageMeta";

/**
 * /burnticker/operator/claim-fees (owner, 2026-10-16): the LaunchLab platform fee claim, operator only. This server page renders the
 * client component and nothing else; every fact on it (the platform, the claim wallet, the vault and its balance, the unsigned claim)
 * comes from GET /api/burnticker/v1/ops/platform-fees, which answers only on the operator's own network with the ops PIN, the same gate
 * as the post queue. Without the PIN the page is a PIN box.
 */
export const metadata: Metadata = withShareCard({ title: "Claim the platform fee", description: "The operator's page for claiming the platform fee that a coin's trading has collected, with each claim recorded on chain.", alternates: { canonical: "/burnticker/operator/claim-fees" }, robots: { index: false, follow: false } });

export default function ClaimFeesPage() {
  return <ClaimFees />;
}
