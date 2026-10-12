import { Fragment } from "react";
import { mailSafeParts } from "@/lib/burnticker/mailSafe";

/**
 * TEXT WITH AN EMAIL ADDRESS IN IT, SAFE TO HYDRATE (website-15 item 3, Claude site audit 3 item 1). The site sits behind a proxy that
 * rewrites any email address it finds in server HTML into a "[email protected]" link plus a decoding script. React then finds markup it
 * did not render and throws hydration error #418 on every page that prints the operator line (the footer prints it on every page). Here
 * the "@" sits in its own element, so the served HTML holds no contiguous address for the proxy to rewrite; the visible text, a copy and
 * paste, and a screen reader all still read the plain address.
 */
export function MailSafe({ text }: { text: string }) {
  return (
    <>
      {mailSafeParts(text).map((p, i) => {
        if (!p.email) return <Fragment key={i}>{p.text}</Fragment>;
        const [local, domain] = p.text.split("@");
        return <span key={i} className="bt-email" data-email>{local}<span>@</span>{domain}</span>;
      })}
    </>
  );
}
