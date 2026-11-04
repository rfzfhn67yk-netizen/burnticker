// ACCESSIBILITY CHECKS (prelaunch audit 2026-10-18, optional polish item 5): an automated pass over the main static pages and the Next
// page shells under src/app/burnticker. (a) The colour tokens in both themes: body text measures at least 4.5:1 on every surface it is
// drawn on, large text and decorative glyphs at least 3:1. (b) Every form control has a label. (c) Every error message is announced
// (aria-live or role) or tied to its control (aria-describedby). (d) Every interactive element shows a focus ring. These are checks,
// not a conformance claim: no page says it meets a standard (the last test holds that).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tabForKey } from "@/lib/burnticker/tabKeys";
import { shellHeaderHtml, shellScript } from "@/lib/burnticker/siteNav.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const GLOBALS = "config/public-repo/overlay/src/app/globals.css";
const STATIC = ["site/burnticker/index.html", "site/burnticker/status/index.html", "site/burnticker/fallback/index.html", "site/deficit/index.html", "site/burnticker/whitepaper.html"];
const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx$/.test(e.name) ? [`${d}/${e.name}`] : []));
/** The Next page shells and their components; the operator pages are private tools behind a key, not public pages. */
const SHELLS = walk("src/app/burnticker").filter((f) => !f.includes("/operator/"));

// ---- colour ------------------------------------------------------------------------------------------------------------------------
/** Relative luminance (WCAG 2) of a #rrggbb or an oklch(L% C h) colour, the form Tailwind's own palette is written in. */
function luminance(c: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const ok = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(c);
  assert.ok(ok, `a colour this test can measure: ${c}`);
  const L = Number(ok[1]) / 100, C = Number(ok[2]), h = (Number(ok[3]) * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const R = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), G = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), B = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
const ratio = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tokens = (src: string): Record<string, string> => Object.fromEntries([...src.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6}|oklch\([^)]*\))/gi)].map((x) => [x[1], x[2].toLowerCase()]));
const BODY = 4.5, LARGE = 3;
/** Every measured pair, for the report: "theme fg on bg = ratio". */
export const measured: string[] = [];
function assertPairs(theme: string, t: Record<string, string>, fgs: string[], bgs: string[], min: number, where: string) {
  for (const fg of fgs) for (const bg of bgs) {
    assert.ok(t[fg] && t[bg], `${where} ${theme}: ${fg} and ${bg} are defined`);
    const r = ratio(t[fg], t[bg]);
    measured.push(`${where} ${theme}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    assert.ok(r >= min, `${where} ${theme}: ${fg} on ${bg} is ${r.toFixed(2)}:1, under ${min}:1`);
  }
}

describe("(a) contrast of the theme tokens, both themes", () => {
  test("the app (the overlay's globals.css over Tailwind's palette): every text colour class the pages use, on every surface", () => {
    const css = read(GLOBALS);
    const palette = tokens(fs.readFileSync(path.join(ROOT, "node_modules/tailwindcss/theme.css"), "utf8"));
    const block = (re: RegExp) => tokens(re.exec(css)![1]);
    const dark = { ...palette, ...block(/@theme \{([\s\S]*?)\n\}/), ...block(/:root \{([\s\S]*?)\n\}/) };
    const light = { ...dark, ...block(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/) };
    // the text colours the pages print: read from the source, so a new class is measured the day it is used
    const used = new Set<string>();
    for (const f of SHELLS) for (const m of read(f).matchAll(/\btext-((?:neutral|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/g)) used.add(`--color-${m[1]}`);
    used.delete("--color-neutral-950"); // the ink on the amber buttons, measured below on the button
    assert.ok(used.size >= 8, "the scan found the pages' text colours");
    const fgs = ["--bt-ink", "--bt-dim", "--bt-muted", "--bt-stamp", "--bt-scorch", "--bt-chip-kalshi", "--bt-chip-polymarket", ...[...used].sort()];
    const bgs = ["--bt-bg", "--bt-counter", "--color-neutral-950", "--color-neutral-900"];
    for (const [name, t] of [["dark", dark], ["light", light]] as const) {
      assertPairs(name, t, fgs, bgs, BODY, "app");
      assertPairs(name, t, ["--color-neutral-950"], ["--color-amber-400"], BODY, "app button");
      assertPairs(name, t, ["--bt-stamp-ink"], ["--bt-stamp-solid"], BODY, "app stamp");
    }
  });
  test("the static pages: page, shell and paper inks on their own surfaces; the decorative ember glyph at 3:1", () => {
    for (const f of STATIC) {
      const html = read(f);
      const blocks = [...html.matchAll(/(:root(?:\[data-theme="(?:light|dark)"\]|:not\(\[data-theme="dark"\]\))?)\s*\{([^}]*)\}/g)];
      let dark: Record<string, string> = {};
      for (const b of blocks) if (b[1] === ":root" || b[1] === ':root[data-theme="dark"]') dark = { ...dark, ...tokens(b[2]) };
      let light = { ...dark };
      for (const b of blocks) if (b[1] === ':root[data-theme="light"]' || b[1] === ':root:not([data-theme="dark"])') light = { ...light, ...tokens(b[2]) };
      const has = (k: string) => k in dark;
      const usedAsText = (k: string) => new RegExp(`(?<![-\\w])color:\\s*var\\(${k}\\)`).test(html);
      const pageFg = ["--ink", "--dim", "--muted", "--amber", "--violet", "--ok", "--red", "--hot", "--warn"].filter((k) => has(k) && usedAsText(k));
      const pageBg = ["--bg", "--panel", "--surface"].filter(has);
      for (const [name, t] of [["dark", dark], ["light", light]] as const) {
        assertPairs(name, t, pageFg, pageBg, BODY, f);
        assertPairs(name, t, ["--sh-ink", "--sh-dim", "--sh-stamp", "--sh-scorch"], ["--sh-bg", "--sh-counter"], BODY, `${f} shell`);
        assertPairs(name, t, ["--sh-paper-ink", "--sh-paper-dim"], ["--sh-paper"], BODY, `${f} receipt`);
        if (has("--thermal")) assertPairs(name, t, ["--thermal", "--faded", "--link"], ["--paper", "--paper2"], BODY, `${f} paper`);
        if (has("--amber-ink")) assertPairs(name, t, ["--amber-ink"], ["--amber"], BODY, `${f} button`);
        if (has("--ember")) assertPairs(name, t, ["--ember"], pageBg, LARGE, `${f} glyph`);
      }
    }
  });
});

// ---- labels, errors, focus -----------------------------------------------------------------------------------------------------------
/** The source of a JSX or HTML opening tag starting at `start`, braces and quotes respected (an arrow function's ">" is not the end). */
function tagAt(src: string, start: number): string {
  let i = start, depth = 0, q: string | null = null;
  for (; i < src.length; i++) { const c = src[i]; if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "`") { q = c; continue; } if (c === "{") depth++; else if (c === "}") depth--; else if (c === ">" && depth === 0) break; }
  return src.slice(start, i + 1);
}
function unlabelled(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<(input|select|textarea)\b/g)) {
    const tag = tagAt(src, m.index!);
    if (/type="(hidden|submit|button)"/.test(tag) || /aria-label(ledby)?=/.test(tag)) continue;
    const id = /\bid=(\{[^}]*\}|"[^"]*")/.exec(tag);
    if (id && (src.includes(`htmlFor=${id[1]}`) || src.includes(`for=${id[1]}`))) continue;
    const before = src.slice(0, m.index);
    if (before.lastIndexOf("<label") > before.lastIndexOf("</label>")) continue;
    out.push(tag.slice(0, 160));
  }
  return out;
}

describe("(b) every form control has a label", () => {
  test("the static pages and the Next page shells", () => {
    let n = 0;
    for (const f of [...STATIC, ...SHELLS]) { const src = read(f); n += (src.match(/<(input|select|textarea)\b/g) ?? []).length; assert.deepEqual(unlabelled(src), [], f); }
    assert.ok(n >= 20, `the scan saw the controls (${n})`);
  });
  test("the check itself catches a bare input and passes the three ways to label one", () => {
    assert.equal(unlabelled(`<input value={x} onChange={(e) => set(e.target.value)} />`).length, 1);
    assert.equal(unlabelled(`<input aria-label="Search" onChange={(e) => go()} />`).length, 0);
    assert.equal(unlabelled(`<label htmlFor="q">Q</label><input id="q" />`).length, 0);
    assert.equal(unlabelled(`<label>Q <input onChange={(e) => go()} /></label>`).length, 0);
  });
});

describe("(c) every error message is announced or tied to its control", () => {
  test("in every file with a form control, a red message line carries aria-live or a role, or an id a control names in aria-describedby", () => {
    let n = 0;
    for (const f of SHELLS) {
      const src = read(f);
      if (!/<(input|select|textarea)\b/.test(src)) continue;
      for (const m of src.matchAll(/<(p|span|div|li)\b/g)) {
        const tag = tagAt(src, m.index!);
        // a literal class naming the error colour (a class chosen by an expression is a status tone, such as a pass/fail mark)
        if (!/className="[^"]*\btext-red-\d+/.test(tag) || /aria-hidden="true"/.test(tag)) continue;
        // a refusal that arrives with its catalogue card (data-refused) is part of that card, not an answer to input
        if (/\bdata-refused\b/.test(tag)) continue;
        n++;
        // a live region announces changes, so it must already be in the page when the message lands: never mounted by && or ?:
        if (/aria-live=/.test(tag)) assert.doesNotMatch(src.slice(Math.max(0, m.index! - 4), m.index), /(&&|\?|:) $/, `${f}: a live region mounted with its message: ${tag.slice(0, 120)}`);
        // an id, literal or a template (`bm-${id}-err`), that a control's aria-describedby names
        const id = /\bid=(?:"([^"]+)"|\{`([^`]+)`\})/.exec(tag), key = id ? id[1] ?? id[2] : null;
        const described = !!key && src.split("aria-describedby=").slice(1).some((d) => d.slice(0, 200).includes(key));
        const ok = /role="(alert|status)"|aria-live=/.test(tag) || described;
        assert.ok(ok, `${f}: ${tag.slice(0, 160)}`);
      }
    }
    assert.ok(n >= 5, `the scan saw the error lines (${n})`);
  });
});

describe("(d) focus is visible", () => {
  test("the app: one :focus-visible ring on every interactive element, and no utility class switches it off", () => {
    const css = read(GLOBALS);
    const rule = /:where\(([^)]*)\):focus-visible \{ outline: 2px solid var\(--bt-focus\); outline-offset: 2px;/.exec(css);
    assert.ok(rule, "the site-wide ring");
    for (const el of ["a", "button", "input", "select", "textarea", "summary", "[tabindex]"]) assert.ok(rule[1].split(/,\s*/).includes(el), el);
    for (const f of SHELLS) for (const m of read(f).matchAll(/className="([^"]*)"/g)) {
      // tabIndex={-1} headings take focus only from script (the launch steps move focus to them), so they may drop the outline
      assert.doesNotMatch(m[1], /(^|\s)focus(-visible)?:outline-none\b/, `${f}: ${m[1]}`);
    }
  });
  test("the static pages: links, summaries, buttons and inputs draw the ring", () => {
    for (const f of STATIC) {
      const html = read(f);
      for (const sel of ["a:focus-visible", "summary:focus-visible", "button:focus-visible", "input:focus-visible"]) assert.ok(html.includes(sel), `${f}: ${sel}`);
      assert.doesNotMatch(html, /:focus(-visible)?\s*\{[^}]*outline:\s*(none|0)\b/, f);
    }
  });
});

describe("no conformance claim", () => {
  test("the trust, about and docs pages and the static pages never claim a standard", () => {
    for (const f of [...STATIC, ...SHELLS.filter((x) => /\/(trust|about|docs|privacy|terms)\//.test(x))]) assert.doesNotMatch(read(f), /\bWCAG\b|accessibility (conformance|compliant|certified)/i, f);
  });
});

describe("A-29: keyboard and screen-reader fixes", () => {
  test("tab lists: arrows move and wrap, Home and End jump; the three lists use it with a roving tabindex", () => {
    const t = ["burns", "rule", "holders"];
    assert.equal(tabForKey(t, "burns", "ArrowRight"), "rule"); assert.equal(tabForKey(t, "burns", "ArrowLeft"), "holders");
    assert.equal(tabForKey(t, "holders", "ArrowRight"), "burns"); assert.equal(tabForKey(t, "rule", "Home"), "burns"); assert.equal(tabForKey(t, "rule", "End"), "holders");
    assert.equal(tabForKey(t, "rule", "Enter"), null); assert.equal(tabForKey(t, "nope", "ArrowRight"), null);
    for (const [f, sel] of [["src/app/burnticker/CoinsIndex.tsx", "tab === t.id"], ["src/app/burnticker/t/[ticker]/page.tsx", "tab === t"], ["src/app/burnticker/p/[pairId]/page.tsx", "tab === x"]] as const) {
      const src = read(f);
      assert.match(src, /role="tablist"[^>]*onKeyDown=\{tabKeyHandler\(/, f);
      assert.ok(src.includes(`tabIndex={${sel} ? 0 : -1}`), `${f}: roving tabindex`);
    }
    assert.doesNotMatch(read("src/app/burnticker/CoinsIndex.tsx"), /role="tab"[^>]*title=\{t\.rule\}/, "a coins tab is named by its label, not its description");
  });
  test("one skip link on the launch page; the verifier's lines are polite and wait for a pause", () => {
    assert.doesNotMatch(read("src/app/burnticker/launch/layout.tsx"), /bt-skip/);
    const v = read("src/app/burnticker/check/ReceiptVerifier.tsx");
    assert.doesNotMatch(v, /role="alert"/);
    assert.match(v, /<div aria-live="polite" data-verdict-live>/);
    assert.match(v, /<span id="sig-error" className="text-red-400" aria-live="polite" data-field-error="signature">/);
    assert.match(v, /setTimeout\(\(\) => setQuietSig\(sig\), SIG_PAUSE_MS\)/); assert.match(v, /sigSettled && sigCheck\.state !== "valid"/);
  });
  test("Connect wallet is named by its label alone, and the wallet dialog takes focus and gives it back", () => {
    const w = read("src/app/burnticker/_components/WalletButton.tsx");
    assert.doesNotMatch(w, /sr-only">\. \{WALLET_COPY\.note\}/);
    assert.match(w, /querySelector<HTMLElement>\("\.wallet-adapter-modal button"\)\?\.focus\(\)/); assert.match(w, /back\.focus\(\)/);
    assert.doesNotMatch(shellHeaderHtml({}), /class="sh-sr">\. /, "the static Connect wallet link too");
  });
  test("the static phone menu keeps aria-expanded in step; the leagues strip reads a count with words", () => {
    const s = shellScript();
    assert.match(s, /function sync\(\) \{ sum\.setAttribute\("aria-expanded", m\.open \? "true" : "false"\); \}/);
    assert.match(s, /sum\.addEventListener\("click", function \(\) \{ setTimeout\(sync, 0\); \}\);/);
    assert.match(read("src/app/burnticker/CoinsIndex.tsx"), /aria-label=\{l\.coins > 0 \? `\$\{l\.label\}, \$\{l\.coins\} team coin/);
  });
});
