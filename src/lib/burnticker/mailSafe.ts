/**
 * Splits text around the email addresses in it (website-15 item 3; the component is src/app/burnticker/_components/MailSafe.tsx, which
 * puts each address's "@" in its own element so the served HTML holds no contiguous address for the CDN to rewrite).
 */
const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function mailSafeParts(text: string): { text: string; email: boolean }[] {
  const out: { text: string; email: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(EMAIL)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), email: false });
    out.push({ text: m[0], email: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), email: false });
  return out;
}
