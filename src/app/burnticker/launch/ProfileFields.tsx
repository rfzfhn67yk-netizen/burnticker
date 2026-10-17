"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createLatest } from "@/lib/burnticker/latestOnly";
import { DESCRIPTION_ONE_PARAGRAPH, IMAGE_CANCEL_LABEL, IMAGE_KEEP_GENERATED_LABEL, IMAGE_RIGHTS_REQUIRED, notSquareLine, oneParagraph, squareCrop } from "@/lib/burnticker/guidedLaunch";
import { DESCRIPTION_MAX, IMAGE_HELP, IMAGE_WAYS, RIGHTS_LINE, creatorLinks, descriptionRoom, descriptionRoomProblem, imageFromTransfer } from "@/lib/burnticker/creatorProfile";
import { controlCharProblem } from "@/lib/burnticker/launchFields";
import { BADGE_UNAVAILABLE_LINE, IMAGE_READ_FAILED, IMAGE_SIZE_HELP, pickImage } from "@/lib/burnticker/profileImagePick";
import { BADGE_NOTE, BADGE_TOGGLE } from "@/lib/burnticker/creatorBadgeCopy";
import { IMAGE_RIGHTS_LINE } from "@/lib/burnticker/legalCopy";
import { LinkedWords } from "../_components/LinkedWords";
import { CUSTOM_IMAGES_OFF_LINE } from "@/lib/burnticker/creatorCopy";
import { fieldRuleSentence } from "./fieldChecks";

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
export interface ProfileImage { badgedUrl: string; plainUrl: string; contentType: string; base64: string; name: string; /** launch audit 221: the mark service did not answer, so the plain file is used and there is no mark to choose */ badgeUnavailable?: boolean }
/** `imageState` (intent audit 5 item 15): an image still being prepared, or one that failed, blocks the launch until it is resolved. */
export interface ProfileValue { image: ProfileImage | null; rights: boolean; badge: boolean; description: string; x: string; telegram: string; website: string; imageState?: "pending" | "failed" | null }
export const EMPTY_PROFILE: ProfileValue = { image: null, rights: false, badge: true, description: "", x: "", telegram: "", website: "" };
/** The preview that will be pinned. */
export const chosenPreview = (v: ProfileValue): string | null => (v.image ? (v.badge ? v.image.badgedUrl : v.image.plainUrl) : null);

/**
 * website-18: the launch body fields for one coin's profile (a single coin, each coin of a Matchup, or `pair` for side B of a registered
 * pair): the creator's description, links and, when one was chosen, the uploaded image with the rights line and the badge choice.
 */
export function profileBody(v: ProfileValue): { creatorDescription: string; links: { label: string; url: string }[]; image?: { contentType: string; base64: string }; imageRights?: boolean; imageBadge?: boolean } {
  const out: ReturnType<typeof profileBody> = { creatorDescription: v.description.trim(), links: creatorLinks({ x: v.x, telegram: v.telegram, website: v.website }).links };
  if (v.image) { out.image = { contentType: v.image.contentType, base64: v.image.base64 }; out.imageRights = v.rights; out.imageBadge = v.badge; }
  return out;
}

/** What still blocks the launch in these fields (the review lists it beside the button). */
export function profileProblems(v: ProfileValue): string[] {
  return profileFieldProblems(v).map((x) => x.text);
}
export { profileFieldProblems, linkFieldProblem, LINK_FIELDS, type ProfileField } from "@/lib/burnticker/guidedLaunch";
import { LINK_FIELDS, linkFieldProblem, profileFieldProblems, type ProfileField } from "@/lib/burnticker/guidedLaunch";
export const profileFieldId = (side: "a" | "b", field: ProfileField | "note" | "name" | "ticker"): string => `bt-profile-${side}-${field}`;

/**
 * website-18: `part` splits the fields so the image control stays on the review card ("image") while the description and links can sit
 * in a disclosure ("text"); `who` names the side of a pair ("$LAKERS"); `customImages` false (the host takes no custom images) shows the
 * generated art with CUSTOM_IMAGES_OFF_LINE instead of the file control.
 */
export type ProfileUpdate = ProfileValue | ((prev: ProfileValue) => ProfileValue);
export function ProfileFields({ value, onChange, part = "all", who = null, customImages = true, pasteTarget = true, side = "a", generated = null }: { /** website-25 (WIRING-SOURCES7 H2): the coin's generated paragraph (the review's coins[i].description), so the counter and the limit are the room it leaves */ generated?: string | null; value: ProfileValue; /** a state setter: every change is merged into the latest value (intent audit 5 item 14) */ onChange: (v: ProfileUpdate) => void; part?: "all" | "image" | "text"; who?: string | null; customImages?: boolean; /** website-19: an image pasted anywhere on the page lands here (side A of a pair; side B takes drops) */ pasteTarget?: boolean; /** website-22: which coin's fields these are (their ids, for the review's Edit links) */ side?: "a" | "b" }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [fileErr, setFileErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  // website-22 (QA 9 item 11): a link is checked when the field is left (and again on every change after that), beside the field
  // website-25 (QA 11 H5): a field that already holds a link (the creator came back with Edit from the review) shows its error at once
  const [touched, setTouched] = useState<Record<string, boolean>>(() => Object.fromEntries(LINK_FIELDS.map(([k]) => [k, !!value[k].trim()])));
  const [paraNote, setParaNote] = useState(false);
  // website-22 (QA 9 item 14): the picked image's size, so a picture that is not square says so and shows the square the coin keeps
  const [dims, setDims] = useState<{ src: string; w: number; h: number } | null>(null);
  const plainSrc = value.image?.plainUrl ?? null;
  useEffect(() => {
    if (!plainSrc) { setDims(null); return; }
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setDims({ src: plainSrc, w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = plainSrc;
    return () => { live = false; };
  }, [plainSrc]);
  const shape = dims && dims.src === plainSrc && dims.w !== dims.h ? dims : null;
  // intent audit 5 item 14: every change merges into the LATEST value (a functional update), and an image preview applies only if no newer
  // pick or removal came after it (createLatest), so a slow preview can never restore an old image or undo a newer edit
  const set = (p: Partial<ProfileValue>) => onChange((prev) => ({ ...prev, ...p }));
  const latest = useRef(createLatest()).current;
  // launch audit 219–225 (profileImagePick.ts): every way out of a pick clears the busy line, a failed replacement keeps the image already
  // chosen, a mark service that cannot answer leaves the plain file usable without the mark, and an empty browser type is read from the bytes
  const valueRef = useRef(value); valueRef.current = value;
  const pick = (f: File | null) => {
    void pickImage<ProfileValue>(f, {
      latest, update: (fn) => onChange(fn), hasImage: () => !!valueRef.current.image, setBusy, setError: setFileErr,
      readDataUrl: (file) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result ?? "")); r.onerror = () => reject(new Error(IMAGE_READ_FAILED)); r.readAsDataURL(file); }),
      // the preview is the server's badged copy (the same compositing a launch pins), so the creator sees the receipt mark before the wallet
      preview: async (image) => { const res = await fetch("/api/burnticker/launch/image-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }) }); return { status: res.status, body: await res.json().catch(() => null) }; },
    });
  };
  const input = "mt-1 w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm";
  // website-19 (owner, 2026-10-12): paste an image anywhere on the page (Cmd or Ctrl and V), or drop one on the control. A paste into a
  // text field stays text. Both go through pick(), so the size and type checks and the preview are the chosen file's.
  const pickRef = useRef(pick); pickRef.current = pick;
  const [dragOver, setDragOver] = useState(false);
  const imageOn = part !== "text" && customImages;
  useEffect(() => {
    if (!imageOn || !pasteTarget) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const f = imageFromTransfer(e.clipboardData) as File | null;
      if (!f) return;
      e.preventDefault(); pickRef.current(f);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [imageOn, pasteTarget]);
  const showImage = part !== "text", showText = part !== "image";
  const legend = part === "image" ? `${who ? `${who}: ` : ""}Image. It is optional.` : part === "text" ? `${who ? `${who}: ` : ""}Description and links. Each one is optional.` : `${who ? `${who}: ` : ""}Your coin's image, description and links. Each one is optional.`;
  return (
    <fieldset className="min-w-0 space-y-2 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400" data-profile={part}>
      <legend className="px-1 text-neutral-300">{legend}</legend>
      {/* website-18: when this site takes no custom images, the generated art and one sentence say so (never an empty space) */}
      {showImage && !customImages && (
        <div className="flex min-w-0 items-center gap-3" data-custom-images-off>
          <div className="bt-profile-square shrink-0" aria-hidden="true"><span>Receipt art</span></div>
          <p className="min-w-0 text-neutral-300">{CUSTOM_IMAGES_OFF_LINE}</p>
        </div>
      )}
      {showImage && customImages && <div className={`flex min-w-0 items-start gap-3 rounded${dragOver ? " outline outline-2 outline-amber-400" : ""}`} data-image-control onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(imageFromTransfer(e.dataTransfer) as File | null); }}>
        {value.image ? (
          // both previews side by side; the one that will be pinned is outlined
          <div className="flex shrink-0 gap-2" data-image-previews>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
            {!value.image.badgeUnavailable && <figure className={`bt-profile-square${value.badge ? " is-chosen" : ""}`} data-preview="badged"><img src={value.image.badgedUrl} alt="With the receipt mark" width={72} height={72} /></figure>}
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
            <figure className={`bt-profile-square${value.badge ? "" : " is-chosen"}`} data-preview="plain"><img src={value.image.plainUrl} alt="Without the receipt mark" width={72} height={72} /></figure>
          </div>
        ) : <div className="bt-profile-square shrink-0" aria-hidden="true"><span>Receipt art</span></div>}
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`${profileFieldId(side, "image")}-file`} className="block text-neutral-300">Image</label>
          <input id={`${profileFieldId(side, "image")}-file`} type="file" data-optional="profile" accept="image/png,image/jpeg,image/gif,image/webp" aria-describedby={`${uid}-imghelp`} className="block w-full min-w-0 text-xs" onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <p id={`${uid}-imghelp`}>{IMAGE_WAYS} {IMAGE_HELP} {IMAGE_SIZE_HELP}</p>
          <p data-image-rights><LinkedWords text={IMAGE_RIGHTS_LINE} links={[{ words: "terms of use", href: "/burnticker/terms" }]} /></p>
          {busy && <p role="status">Adding the receipt mark.</p>}
          {fileErr && <p className="text-red-400" role="alert">{fileErr}</p>}
          {!value.image && value.imageState && <button type="button" data-optional="profile" className="underline" onClick={() => { latest.cancel(); set({ imageState: null }); setFileErr(null); setBusy(false); }} data-image-way-out={value.imageState}>{value.imageState === "failed" ? IMAGE_KEEP_GENERATED_LABEL : IMAGE_CANCEL_LABEL}</button>}
          {value.image && !value.image.badgeUnavailable && <label className="flex items-start gap-2 text-neutral-200"><input type="checkbox" data-optional="profile" data-badge-toggle checked={value.badge} onChange={(e) => set({ badge: e.target.checked })} /><span>{BADGE_TOGGLE}</span></label>}
          {value.image && !value.image.badgeUnavailable && <p data-badge-note>{BADGE_NOTE}</p>}
          {value.image?.badgeUnavailable && <p data-badge-unavailable>{BADGE_UNAVAILABLE_LINE}</p>}
          {value.image && shape && (() => {
            const c = squareCrop(shape.w, shape.h), wide = shape.w >= shape.h;
            return (
              <div className="space-y-1" data-image-not-square role="status">
                <p className="text-amber-300">{notSquareLine(shape.w, shape.h)}</p>
                <div className="relative inline-block" style={{ width: wide ? 144 : Math.round(144 * shape.w / shape.h), height: wide ? Math.round(144 * shape.h / shape.w) : 144 }} data-image-crop>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
                  <img src={value.image.plainUrl} alt="The whole image, with the square the coin shows outlined" className="h-full w-full rounded object-fill opacity-60" />
                  <span aria-hidden="true" className="absolute border-2 border-amber-400" style={{ left: `${c.left}%`, top: `${c.top}%`, width: `${c.width}%`, height: `${c.height}%` }} />
                </div>
              </div>
            );
          })()}
          {value.image && (
            <>
              <label className="flex items-start gap-2 text-neutral-200"><input id={profileFieldId(side, "image")} type="checkbox" data-optional="profile" data-rights-box aria-invalid={!value.rights} checked={value.rights} onChange={(e) => { set({ rights: e.target.checked }); if (e.target.checked) setFileErr(null); }} /><span data-rights-line>{RIGHTS_LINE}</span></label>
              {!value.rights && <p className="text-amber-300" data-rights-needed>{IMAGE_RIGHTS_REQUIRED}</p>}
              <button type="button" data-optional="profile" className="underline" onClick={() => { latest.cancel(); set({ image: null, rights: false, imageState: null }); setFileErr(null); setBusy(false); }}>Remove the image</button>
            </>
          )}
        </div>
      </div>}
      {showText && <>
      {(() => {
        // website-22 (audit 10 item 8): one paragraph, said where it happened; invisible and text-direction characters said beside the field
        const descId = profileFieldId(side, "description"), descErr = controlCharProblem(value.description, "description") || (value.description.length > DESCRIPTION_MAX ? `The description can be at most ${DESCRIPTION_MAX} characters.` : "") || (generated ? descriptionRoomProblem(generated, value.description) : null) || fieldRuleSentence("description", value.description) || "";
        const max = generated ? Math.min(DESCRIPTION_MAX, descriptionRoom(generated)) : DESCRIPTION_MAX;
        return (<>
          <label className="block" htmlFor={descId}>Description. It follows the rule sentence on the coin&apos;s page, as one paragraph. Links go in the fields below it.</label>
          <textarea id={descId} data-optional="profile" data-profile-field="description" className={input} rows={3} maxLength={DESCRIPTION_MAX} value={value.description} aria-invalid={!!descErr} onChange={(e) => { const p = oneParagraph(e.target.value); setParaNote(p.changed); set({ description: p.value }); }} aria-describedby={`${uid}-count${paraNote ? ` ${uid}-para` : ""}${descErr ? ` ${uid}-descerr` : ""}`} />
          <p id={`${uid}-count`}>{value.description.length} of {max} characters.</p>
          {paraNote && <p id={`${uid}-para`} className="text-amber-300" role="status" data-one-paragraph>{DESCRIPTION_ONE_PARAGRAPH}</p>}
          {descErr && <p id={`${uid}-descerr`} className="text-red-400" data-field-error="description">{descErr}</p>}
        </>);
      })()}
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        {LINK_FIELDS.map(([k, label]) => {
          // website-22 (QA 9 item 11): the server's own rule for this field, checked when the field is left, said beside it
          const id = profileFieldId(side, k), err = touched[k] ? linkFieldProblem(label, value[k]) : null;
          return (
            <div key={k} className="block min-w-0">
              <label htmlFor={id}>{label}</label>
              <input id={id} type="url" inputMode="url" data-optional="profile" data-profile-field={k} placeholder={k === "x" ? "https://x.com/…" : k === "telegram" ? "https://t.me/…" : "https://"} className={input} value={value[k]} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} onBlur={() => setTouched((t) => ({ ...t, [k]: true }))} onChange={(e) => set({ [k]: e.target.value } as Partial<ProfileValue>)} />
              {err && <span id={`${id}-err`} className="mt-0.5 block break-words text-red-400" data-field-error={k}>{err}</span>}
            </div>
          );
        })}
      </div>
      </>}
    </fieldset>
  );
}
