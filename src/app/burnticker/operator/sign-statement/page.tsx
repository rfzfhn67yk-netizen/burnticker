import type { Metadata } from "next";
import { SignStatement } from "./SignStatement";
import { withShareCard } from "@/lib/burnticker/pageMeta";

/**
 * /burnticker/operator/sign-statement (owner, 2026-10-18): the operator statement signed with a browser wallet (the developer fee wallet
 * is a plain Phantom wallet, so `solana sign-offchain-message` does not apply). This server page renders the client component and nothing
 * else; the text and the signer come from GET /api/burnticker/v1/ops/statement-text, which answers only on the operator's own network
 * with the ops PIN, the claim page's gate. Without the PIN the page is a PIN box.
 */
export const metadata: Metadata = withShareCard({ title: "Sign the operator statement", description: "The operator's page for signing the operator statement in the browser. It sends nothing anywhere and keeps nothing.", alternates: { canonical: "/burnticker/operator/sign-statement" }, robots: { index: false, follow: false } });

export default function SignStatementPage() {
  return <SignStatement />;
}
