// Fill a .row with split-flap tiles. text: characters (space = blank tile). opts.amber = all tiles amber;
// opts.flipAt = index of one tile caught mid-flip, opts.flipFrom = the character falling away on that tile.
function flapRow(el, text, opts = {}) {
  el.classList.add("row");
  [...text].forEach((ch, i) => {
    const t = document.createElement("div");
    t.className = "tile" + (opts.amber ? " amber" : "") + (opts.amberFrom != null && i >= opts.amberFrom && i < (opts.amberTo ?? 1e9) ? " amber" : "");
    const c = ch === " " ? "" : ch;
    let inner = `<div class="top"><span>${c}</span></div><div class="bot"><span>${opts.flipAt === i ? (opts.flipFrom ?? c) : c}</span></div>`;
    if (opts.flipAt === i) inner += `<div class="flap"><span>${opts.flipFrom ?? c}</span></div>`;
    inner += `<div class="hinge"></div>`;
    t.innerHTML = inner;
    el.appendChild(t);
  });
}
