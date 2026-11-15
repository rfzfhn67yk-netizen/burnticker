import Link from "next/link";
import type { LegalSection } from "@/lib/burnticker/legalCopy";

/** The terms and privacy pages' shared body: a heading, an intro, a contents list and one short section per heading (legalCopy.ts). */
export default function LegalSections({ title, intro, sections, other }: { title: string; intro: string; sections: LegalSection[]; other: { href: string; label: string } }) {
  const card = "rounded-lg border border-neutral-800 bg-neutral-900 p-4 space-y-2";
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-6 text-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-neutral-300">{intro}</p>
        <nav aria-label="On this page">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-neutral-400">
            {sections.map((s) => <li key={s.id}><a className="underline" href={`#${s.id}`}>{s.heading}</a></li>)}
          </ul>
        </nav>
      </header>
      {sections.map((s) => (
        <section key={s.id} id={s.id} className={card} aria-labelledby={`${s.id}-h`}>
          <h2 id={`${s.id}-h`} className="text-lg font-medium">{s.heading}</h2>
          {s.paragraphs.map((p) => <p key={p} className="text-neutral-200">{p}</p>)}
        </section>
      ))}
      <p className="text-neutral-400"><Link className="underline" href={other.href}>{other.label}</Link></p>
    </main>
  );
}
