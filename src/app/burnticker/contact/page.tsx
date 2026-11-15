import type { Metadata } from "next";
import Link from "next/link";
import { MailSafe } from "../_components/MailSafe";
import { withShareCard } from "@/lib/burnticker/pageMeta";
import { CONTACT_LINES } from "@/lib/burnticker/contactCopy";

/**
 * /burnticker/contact (sixth-pass audit OP6-11: /burnticker/support and /burnticker/contact answered 404). One short page with the two
 * addresses the operator reads; /burnticker/support redirects here. The addresses are the ones in config/burnticker/operator.json and
 * security.txt.
 */
export const metadata: Metadata = withShareCard({ title: "Contact", description: "How to reach the Burnticker operator, and where to report a security problem.", alternates: { canonical: "/burnticker/contact" } });

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-3">
      <h1 className="text-2xl font-semibold">Contact</h1>
      {CONTACT_LINES.map((l) => <p key={l} className="text-neutral-300"><MailSafe text={l} /></p>)}
      <p className="text-sm text-neutral-400"><Link className="underline" href="/burnticker/bounty">Bounty and security reports</Link> · <Link className="underline" href="/burnticker/operator">Who runs this</Link></p>
    </main>
  );
}
