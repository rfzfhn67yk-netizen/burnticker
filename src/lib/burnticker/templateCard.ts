import type { Template } from "@/lib/burnticker/templates";
import type { SiteLaunchState } from "@/lib/burnticker/launchAvailability";
import { NOT_OFFERED } from "@/lib/burnticker/exampleTickets";

/**
 * One gallery card's state (HB-134, HB-151 hourly run 13): why it cannot launch here (null when it can), and its link (null whenever the
 * card cannot launch, so a "Not offered yet." card never carries a link, and so never asks to replace a draft for a rule that cannot
 * launch). `offerRefusal` is the Browse and search cards' own source check (coverage/settleable.ts feedOfferRefusal).
 */
export type TemplateSite = Pick<SiteLaunchState, "wizard" | "pairs" | "types">;
export const isPairTemplate = (t: Pick<Template, "shape" | "type">): boolean => t.shape === "pair" || t.type === "derby" || t.type === "pairs";
export function templateCardState(t: Pick<Template, "shape" | "type" | "source" | "href">, site: TemplateSite, offerRefusal: (source: string) => string | null): { unavailable: string | null; offerWhy: string | null; href: string | null } {
  const offerWhy = t.source ? offerRefusal(t.source) : null;
  const unavailable = isPairTemplate(t) && !site.pairs.available ? site.pairs.line ?? NOT_OFFERED
    : t.type && !site.types[t.type].available ? `${site.types[t.type].label} launches are not available on this site.`
    : offerWhy ? NOT_OFFERED : null;
  return { unavailable, offerWhy, href: site.wizard && !unavailable ? t.href : null };
}
