import type { Metadata } from "next";
import Link from "next/link";
import { PRESS_COPY, PRESS_FILES, PRESS_CONTACT } from "@/lib/burnticker/historyCopy";
import { OPERATOR_LINE } from "@/lib/burnticker/trustpack/copy";
import { HERO } from "@/lib/burnticker/siteNav.mjs";
import { MISSION_STATEMENT } from "@/lib/burnticker/mission";
import { Page, PageHeader, Panel } from "../_components/Panel";
import { MailSafe } from "../_components/MailSafe";

export const metadata: Metadata = { title: PRESS_COPY.title, description: PRESS_COPY.description, alternates: { canonical: "/burnticker/press" } };

/**
 * /burnticker/press (legitimacy pass item 6): the mark and wordmark (SVG and PNG, dark and light), the receipt artwork, the $DEFICIT
 * mark, the boilerplate under the live headline, the operator line, the contact address and "what Burnticker is not". The files are
 * served from /burnticker/brand/ (config/public-repo/overlay/public/burnticker/brand). No logo of anyone else, no quotes, no claims.
 */
export default function PressPage() {
  return (
    <Page>
      <PageHeader title={PRESS_COPY.title} intro={`${HERO.title} ${HERO.sub}`} />
      <Panel title={PRESS_COPY.missionTitle} id="one-paragraph">
        <p className="bt-body-text" data-mission>{MISSION_STATEMENT}</p>
      </Panel>
      <Panel title={PRESS_COPY.boilerplateTitle} id="about">
        <p className="bt-body-text" data-boilerplate>{PRESS_COPY.boilerplate}</p>
      </Panel>
      <Panel title={PRESS_COPY.notTitle} id="not">
        <ul className="bt-bullets">{PRESS_COPY.not.map((t) => <li key={t}>{t}</li>)}</ul>
      </Panel>
      <Panel title={PRESS_COPY.filesTitle} id="files">
        <p className="bt-body-text">{PRESS_COPY.filesIntro}</p>
        <ul className="bt-press-grid">
          {PRESS_FILES.map((g) => {
            const preview = g.files.find((f) => f.kind === "PNG") ?? g.files[0];
            return (
              <li key={g.id} className="bt-subpanel" data-press={g.id}>
                <h3 className="bt-h3">{g.label}</h3>
                {/* eslint-disable-next-line @next/next/no-img-element -- a fixed brand file shown at its own size; the optimiser adds nothing */}
                <img className="bt-press-preview" src={preview.href} alt="" loading="lazy" width={160} height={160} />
                <ul className="bt-bullets">{g.files.map((f) => <li key={f.href}><a className="underline" href={f.href} download>{f.kind}</a>, {f.note}</li>)}</ul>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title={PRESS_COPY.operatorTitle} id="operator">
        <p className="bt-body-text"><MailSafe text={OPERATOR_LINE} /></p>
      </Panel>
      <Panel title={PRESS_COPY.contactTitle} id="contact">
        <p className="bt-body-text"><MailSafe text={PRESS_CONTACT} /></p>
      </Panel>
      <p className="bt-meta">{PRESS_COPY.moreTitle}: <Link className="underline" href="/burnticker/changelog">{PRESS_COPY.changelogLink}</Link>. <Link className="underline" href="/burnticker/history#reviews">{PRESS_COPY.reviewsLink}</Link>.</p>
    </Page>
  );
}
