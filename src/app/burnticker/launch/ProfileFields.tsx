"use client";

import { useId, useState } from "react";
import { DESCRIPTION_MAX, IMAGE_HELP, RIGHTS_LINE, imageFileProblem } from "@/lib/burnticker/creatorProfile";
import { BADGE_NOTE, BADGE_TOGGLE } from "@/lib/burnticker/creatorBadgeCopy";
import { IMAGE_RIGHTS_LINE } from "@/lib/burnticker/legalCopy";
import { LinkedWords } from "../_components/LinkedWords";

/**
 * THE CREATOR'S IMAGE, DESCRIPTION AND LINKS ON THE REVIEW CARD (website-15 item 13; owner decisions 2026-10-12). Above the rule
 * choices, all optional: an image (PNG, JPG, GIF or WebP up to 2 MB, checked here by size and type before anything is sent, shown
 * square, with the line the creator confirms), a description of up to 280 characters that follows the generated rule sentence, and X,
 * Telegram and website links. Without an image the coin keeps its generated receipt art. The server checks everything again.
 */
/**
 * `badgedUrl` is the server's preview WITH the receipt mark (the bytes a launch pins when `badge` is on); `plainUrl` is the creator's
 * file as chosen; `base64` is that original, which the launch sends. `badge` (owner, 2026-10-12): optional, on by default.
 */
export interface ProfileImage { badgedUrl: string; plainUrl: string; contentType: string; base64: string; name: string }
export interface ProfileValue { image: ProfileImage | null; rights: boolean; badge: boolean; description: string; x: string; telegram: string; website: string }
export const EMPTY_PROFILE: ProfileValue = { image: null, rights: false, badge: true, description: "", x: "", telegram: "", website: "" };
/** The preview that will be pinned. */
export const chosenPreview = (v: ProfileValue): string | null => (v.image ? (v.badge ? v.image.badgedUrl : v.image.plainUrl) : null);

/** What still blocks the launch in these fields (the review lists it beside the button). */
export function profileProblems(v: ProfileValue): string[] {
  const out: string[] = [];
  if (v.image && !v.rights) out.push("Confirm the image line, or remove the image.");
  if (v.description.length > DESCRIPTION_MAX) out.push(`The description can be at most ${DESCRIPTION_MAX} characters.`);
  for (const [label, u] of [["X", v.x], ["Telegram", v.telegram], ["Website", v.website]] as const) if (u.trim() && !/^https:\/\/\S{1,200}$/.test(u.trim())) out.push(`The ${label} link has to start with https:// and have no spaces.`);
  return out;
}

export function ProfileFields({ value, onChange }: { value: ProfileValue; onChange: (v: ProfileValue) => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [fileErr, setFileErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const set = (p: Partial<ProfileValue>) => onChange({ ...value, ...p });
  const pick = (f: File | null) => {
    setFileErr(null);
    if (!f) return;
    const bad = imageFileProblem({ size: f.size, type: f.type });
    if (bad) { setFileErr(bad); return; }
    const r = new FileReader();
    // the preview is the server's badged copy (the same compositing a launch pins), so the creator sees the receipt mark before the wallet
    r.onload = () => {
      const url = String(r.result ?? ""); const base64 = url.slice(url.indexOf(",") + 1);
      setBusy(true);
      fetch("/api/burnticker/launch/image-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: { contentType: f.type, base64 } }) })
        .then(async (res) => { const j = await res.json().catch(() => null) as { contentType?: string; base64?: string; error?: string } | null; if (!res.ok || !j?.base64) throw new Error(j?.error ?? "The preview could not be made just now."); return j; })
        .then((j) => set({ image: { badgedUrl: `data:${j.contentType};base64,${j.base64}`, plainUrl: url, contentType: f.type, base64, name: f.name }, rights: false }))
        .catch((e: Error) => setFileErr(e.message))
        .finally(() => setBusy(false));
    };
    r.onerror = () => setFileErr("The image could not be read. Try another file.");
    r.readAsDataURL(f);
  };
  const input = "mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm";
  return (
    <fieldset className="min-w-0 space-y-2 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400" data-profile>
      <legend className="px-1 text-neutral-300">Your coin&apos;s image, description and links. Each one is optional.</legend>
      <div className="flex min-w-0 items-start gap-3">
        {value.image ? (
          // both previews side by side; the one that will be pinned is outlined
          <div className="flex shrink-0 gap-2" data-image-previews>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
            <figure className={`bt-profile-square${value.badge ? " is-chosen" : ""}`} data-preview="badged"><img src={value.image.badgedUrl} alt="With the receipt mark" width={72} height={72} /></figure>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
            <figure className={`bt-profile-square${value.badge ? "" : " is-chosen"}`} data-preview="plain"><img src={value.image.plainUrl} alt="Without the receipt mark" width={72} height={72} /></figure>
          </div>
        ) : <div className="bt-profile-square shrink-0" aria-hidden="true"><span>Receipt art</span></div>}
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`${uid}-img`} className="block text-neutral-300">Image</label>
          <input id={`${uid}-img`} type="file" data-optional="profile" accept="image/png,image/jpeg,image/gif,image/webp" aria-describedby={`${uid}-imghelp`} className="block w-full min-w-0 text-xs" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <p id={`${uid}-imghelp`}>{IMAGE_HELP}</p>
          <p data-image-rights><LinkedWords text={IMAGE_RIGHTS_LINE} links={[{ words: "terms of use", href: "/burnticker/terms" }]} /></p>
          {busy && <p role="status">Adding the receipt mark.</p>}
          {fileErr && <p className="text-red-400" role="alert">{fileErr}</p>}
          {value.image && <label className="flex items-start gap-2 text-neutral-200"><input type="checkbox" data-optional="profile" data-badge-toggle checked={value.badge} onChange={(e) => set({ badge: e.target.checked })} /><span>{BADGE_TOGGLE}</span></label>}
          {value.image && <p data-badge-note>{BADGE_NOTE}</p>}
          {value.image && (
            <>
              <label className="flex items-start gap-2 text-neutral-200"><input type="checkbox" data-optional="profile" checked={value.rights} onChange={(e) => set({ rights: e.target.checked })} /><span data-rights-line>{RIGHTS_LINE}</span></label>
              <button type="button" data-optional="profile" className="underline" onClick={() => { set({ image: null, rights: false }); setFileErr(null); }}>Remove the image</button>
            </>
          )}
        </div>
      </div>
      <label className="block" htmlFor={`${uid}-desc`}>Description. It follows the rule sentence on the coin&apos;s page.</label>
      <textarea id={`${uid}-desc`} data-optional="profile" className={input} rows={3} maxLength={DESCRIPTION_MAX} value={value.description} onChange={(e) => set({ description: e.target.value })} aria-describedby={`${uid}-count`} />
      <p id={`${uid}-count`}>{value.description.length} of {DESCRIPTION_MAX} characters.</p>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        {([["x", "X"], ["telegram", "Telegram"], ["website", "Website"]] as const).map(([k, label]) => (
          <label key={k} className="block min-w-0">{label}<input type="url" inputMode="url" data-optional="profile" placeholder="https://" className={input} value={value[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<ProfileValue>)} /></label>
        ))}
      </div>
    </fieldset>
  );
}
