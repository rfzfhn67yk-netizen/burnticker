"use client";

import { useState } from "react";
import { endChoiceLabel, SELF_ON_LOSS_LINE, SINK_NONE_LINE, SINK_NO_MATCH_LINE, SINK_PICKER_LABEL, SINK_SEARCH_PLACEHOLDER, pickedSinkLine, type EndChoice, type EndChoiceModel } from "@/lib/burnticker/guidedLaunch";
import { searchSinks, type SinkCoin } from "@/lib/burnticker/endSinks";

/** Until a coin is picked, the rule keeps $DEFICIT's burn (guidedLaunch.ts withEndChoice). */
export const PICK_FIRST_LINE = "Pick a coin from the list. Until you do, the rest goes to $DEFICIT's burn.";

/**
 * THE END CHOICE ON THE REVIEW (END-SINK-OPTIONS-BRIEF item 2): where the rest goes when this coin does not win, one sentence per choice,
 * and for "another coin's burn" a searchable list of the live coins on this network (GET /sinks), each with its one-line rule. The winning
 * path's own end (the champion path burns the rest here) is stated above the choices, never offered for the losing path. Presentational:
 * the launch page owns the choice and applies it to the rule.
 */
export function EndChoicePicker({ model, value, onChange, sinks, who = null, locked = false, side, hideWinning = false }: { model: EndChoiceModel; /** walkthrough 13: the review says the winning path in the end sentences above, so the picker there leaves it out */ hideWinning?: boolean; value: EndChoice; onChange: (c: EndChoice) => void; sinks: SinkCoin[] | null; /** an independent pair names the coin ("$LADL") */ who?: string | null; locked?: boolean; side: "a" | "b" }) {
  const [q, setQ] = useState("");
  const name = `end-choice-${side}`;
  const shown = sinks ? searchSinks(sinks, q) : [];
  const picked = value.kind === "coin" && value.mint && value.ticker ? { kind: "coin" as const, mint: value.mint, ticker: value.ticker } : null;
  const gone = picked && sinks && !sinks.some((s) => s.mint === picked.mint);
  return (
    <fieldset disabled={locked} className="m-0 min-w-0 space-y-2 border-0 p-0" data-end-choice={side}>
      <legend className="text-xs font-medium text-neutral-400">{who ? `${who}: ${endChoiceLabel(model).toLowerCase()}` : endChoiceLabel(model)}</legend>
      {model.winning && !hideWinning && <p className="text-xs text-neutral-200" data-end-winning>{model.winning}</p>}
      <div className="min-w-0 space-y-1" role="radiogroup" aria-label={endChoiceLabel(model)}>
        {model.options.map((o) => (
          <label key={o.kind} className="flex min-w-0 cursor-pointer items-start gap-2 rounded border border-neutral-800 px-2 py-1.5 text-sm" data-end-option={o.kind}>
            <input type="radio" name={name} value={o.kind} aria-label={o.line} className="mt-1" checked={value.kind === o.kind} onChange={() => onChange(o.kind === "coin" && picked ? picked : { kind: o.kind })} />
            <span className="min-w-0 break-words text-neutral-100">{o.line}</span>
          </label>
        ))}
      </div>
      {value.kind === "coin" && (
        <div className="min-w-0 space-y-1" data-sink-picker>
          {picked && <p className="text-xs text-amber-200" data-sink-picked>{pickedSinkLine(picked.ticker)}</p>}
          {gone && <p className="text-xs text-amber-300" role="status" data-sink-gone>{`$${picked!.ticker} is not in the list of live coins now. Pick another coin, or send the rest to $DEFICIT's burn.`}</p>}
          {!picked && <p className="text-xs text-neutral-400" data-sink-pick-first>{PICK_FIRST_LINE}</p>}
          {sinks === null ? <p className="text-xs text-neutral-400">Reading the live coins on this network.</p>
            : sinks.length === 0 ? <p className="text-xs text-neutral-400" data-sink-none>{SINK_NONE_LINE}</p>
            : (
              <>
                <label className="block text-xs text-neutral-400">{SINK_PICKER_LABEL}
                  <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={SINK_SEARCH_PLACEHOLDER} aria-label={SINK_PICKER_LABEL} className="mt-1 block w-full min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100" data-sink-search />
                </label>
                {shown.length === 0 ? <p className="text-xs text-neutral-400">{SINK_NO_MATCH_LINE}</p> : (
                  <ul className="max-h-56 min-w-0 space-y-1 overflow-y-auto" role="listbox" aria-label={SINK_PICKER_LABEL} data-sink-list>
                    {shown.map((s) => {
                      const on = picked?.mint === s.mint;
                      return (
                        <li key={s.mint} role="option" aria-selected={on}>
                          <button type="button" data-sink-mint={s.mint} onClick={() => onChange({ kind: "coin", mint: s.mint, ticker: s.ticker })} className={`block w-full min-w-0 rounded border px-2 py-1 text-left text-xs ${on ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"}`}>
                            <span className="font-medium text-neutral-100">${s.ticker}</span> <span className="text-neutral-400">{s.name}</span>
                            <span className="block break-words text-neutral-300">{s.rule}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
        </div>
      )}
      <p className="text-xs text-neutral-500" data-self-on-loss>{model.selfLine ?? SELF_ON_LOSS_LINE}</p>
    </fieldset>
  );
}
