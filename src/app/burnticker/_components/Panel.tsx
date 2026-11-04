import type { ReactNode } from "react";

/**
 * BURNTICKER'S OWN PAGE PARTS (legitimacy pass, website-16, 2026-10-12; docs/burnticker/ui-conventions.md "Burnticker's own system"): the
 * page header, the panel (the one card every section sits in), the data table and the receipt mark. Their look is the token classes in
 * the overlay's globals.css (.bt-page, .bt-panel, .bt-table, .bt-eyebrow), so every page that uses them shares one type scale, one
 * spacing scale and one card.
 */
export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className={`bt-page${wide ? " is-wide" : ""}`}>{children}</main>;
}

export function PageHeader({ title, intro, eyebrow, children }: { title: string; intro?: ReactNode; eyebrow?: string; children?: ReactNode }) {
  return (
    <header className="bt-page-head">
      {eyebrow ? <p className="bt-eyebrow">{eyebrow}</p> : null}
      <h1 className="bt-h1">{title}</h1>
      {intro ? <p className="bt-lede">{intro}</p> : null}
      {children}
    </header>
  );
}

export function Panel({ title, id, children, eyebrow }: { title?: string; id?: string; children: ReactNode; eyebrow?: string }) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section className="bt-panel" id={id} aria-labelledby={title ? hid : undefined}>
      {eyebrow ? <p className="bt-eyebrow">{eyebrow}</p> : null}
      {title ? <h2 id={hid} className="bt-h2">{title}</h2> : null}
      {children}
    </section>
  );
}

/** The receipt mark: a slip with a torn foot, a title bar, two rows and a dashed rule. Decorative; it inherits the text colour. */
export function ReceiptMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`bt-receipt-mark ${className}`.trim()} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M14 6h36v46l-4.5 5-4.5-5-4.5 5-4.5-5-4.5 5-4.5-5-4.5 5-4.5-5z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M21 16h22M21 26h14M21 33h22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M21 42h22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 4" />
    </svg>
  );
}
