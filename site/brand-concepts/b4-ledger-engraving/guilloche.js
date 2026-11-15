// Guilloche rosette: nested rings of thin strokes — rotated ellipses and sinusoidal "wave rings" (r = R + A·sin(kθ)),
// the construction a geometric lathe makes on banknotes and bond certificates. Pure strokes, no fills, no blur.
function rosette(svg, cx, cy, R, ink = "#15302a") {
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  g.setAttribute("fill", "none"); g.setAttribute("stroke", ink); g.setAttribute("stroke-width", "0.7");
  // rotated ellipses
  for (let i = 0; i < 40; i++) {
    const e = document.createElementNS(ns, "ellipse");
    e.setAttribute("cx", cx); e.setAttribute("cy", cy); e.setAttribute("rx", R); e.setAttribute("ry", R * 0.34);
    e.setAttribute("transform", `rotate(${i * 4.5} ${cx} ${cy})`); e.setAttribute("opacity", ".55"); g.appendChild(e);
  }
  for (let i = 0; i < 24; i++) {
    const e = document.createElementNS(ns, "ellipse");
    e.setAttribute("cx", cx); e.setAttribute("cy", cy); e.setAttribute("rx", R * 0.62); e.setAttribute("ry", R * 0.2);
    e.setAttribute("transform", `rotate(${i * 7.5 + 3} ${cx} ${cy})`); e.setAttribute("opacity", ".6"); g.appendChild(e);
  }
  // wave rings
  const wave = (r0, A, k, phase, w, op) => {
    let d = "";
    for (let t = 0; t <= 720; t++) {
      const th = (t / 720) * Math.PI * 2;
      const r = r0 + A * Math.sin(k * th + phase);
      d += (t ? "L" : "M") + (cx + r * Math.cos(th)).toFixed(2) + " " + (cy + r * Math.sin(th)).toFixed(2);
    }
    const p = document.createElementNS(ns, "path"); p.setAttribute("d", d + "Z"); p.setAttribute("stroke-width", w); p.setAttribute("opacity", op); g.appendChild(p);
  };
  for (let i = 0; i < 9; i++) wave(R * (1.02 + i * 0.012), R * 0.045, 36, i * 0.35, 0.6, 0.6);
  for (let i = 0; i < 7; i++) wave(R * (0.80 - i * 0.012), R * 0.03, 60, i * 0.4, 0.55, 0.55);
  for (let i = 0; i < 5; i++) wave(R * (0.36 + i * 0.012), R * 0.02, 24, i * 0.5, 0.6, 0.6);
  svg.appendChild(g);
}
