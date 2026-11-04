import Link from "next/link";
import type { ReactNode } from "react";

/** A copy-module sentence printed as is, with some of its own words made into links (each phrase linked once, in order). */
export function LinkedWords({ text, links }: { text: string; links: { words: string; href: string }[] }) {
  const out: ReactNode[] = [];
  let rest = text;
  for (const l of links) {
    const i = rest.indexOf(l.words);
    if (i < 0) continue;
    out.push(rest.slice(0, i), <Link key={l.href} href={l.href} prefetch={false}>{l.words}</Link>);
    rest = rest.slice(i + l.words.length);
  }
  out.push(rest);
  return <>{out}</>;
}
