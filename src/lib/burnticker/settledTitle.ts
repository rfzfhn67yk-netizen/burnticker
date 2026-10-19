/**
 * THE "SETTLED ON …" PART OF A GAME READING'S TITLE, PARSED (review of b3249737, item 5). gameSettle.ts settledWords writes one of:
 *   settled on X · confirmed by Y
 *   settled on X · confirmed by Y · burned when one source had confirmed the final twice   (a game coin, since 2026-10-18)
 *   settled on X · no other source answered · burned when one source had confirmed the final twice
 *   settled on X · confirmed by Y · burned 12 hours after the final was first read        (a game coin until 2026-10-18; still read)
 *   settled on X · no other source answered · burned 12 hours after the final was first read
 *   settled on X · confirmed by Y · burned when two sources had confirmed it      (a game coin, two sources agreed first)
 *   settled on a licensed final score · TheSportsDB only, confirmed after a 12 h hold      (a team coin's one-source game)
 * A reading's title is "<score> final (<outcome>) · <settled part> · see this game on ESPN → <url>", joined with " · " for each game of
 * the day. The parts never contain "·", so the title is split on it rather than matched with lazy groups. Pure; client-safe.
 */
export interface SettledPart { on: string; confirmedBy: string | null; notes: string[] }

/** Every settled part in a title, in order (one per game). */
export function settledParts(title: string): SettledPart[] {
  const bits = title.split(" · ").map((x) => x.trim());
  const out: SettledPart[] = [];
  for (let i = 0; i < bits.length; i++) {
    const m = /^settled on (.+)$/.exec(bits[i]);
    if (!m) continue;
    const part: SettledPart = { on: m[1], confirmedBy: null, notes: [] };
    for (let j = i + 1; j < bits.length && !/^see this game on ESPN/.test(bits[j]) && !/ final \(/.test(bits[j]) && !/^settled on /.test(bits[j]); j++) {
      const c = /^confirmed by (.+)$/.exec(bits[j]);
      if (c && part.confirmedBy === null) part.confirmedBy = c[1]; else part.notes.push(bits[j]);
    }
    out.push(part);
  }
  return out;
}
/** One settled part as a sentence: "Settled on X and confirmed by Y.", "Settled on X; no other source answered; burned when one source …". */
export function settledSentence(p: SettledPart): string {
  return `Settled on ${p.on}${p.confirmedBy ? ` and confirmed by ${p.confirmedBy}` : ""}${p.notes.length ? `; ${p.notes.join("; ")}` : ""}.`;
}
/** The short line a coin page shows under a reading: each distinct settled part, its words joined by " · ". */
export function settledLine(title: string): string {
  return [...new Set(settledParts(title).map((p) => [`settled on ${p.on}`, ...(p.confirmedBy ? [`confirmed by ${p.confirmedBy}`] : []), ...p.notes].join(" · ")))].join(" · ");
}
