// Punched paper tape, 5-level ITA2 (Baudot-Murray) code, letters shift. Tracks 1–5 top to bottom with the small
// sprocket-feed track between tracks 3 and 4, which is where it sits on real 11/16" tape.
const ITA2 = {A:"11000",B:"10011",C:"01110",D:"10010",E:"10000",F:"10110",G:"01011",H:"00101",I:"01100",J:"11010",
  K:"11110",L:"01001",M:"00111",N:"00110",O:"00011",P:"01101",Q:"11101",R:"01010",S:"10100",T:"00001",U:"11100",
  V:"01111",W:"11001",X:"10111",Y:"10101",Z:"10001"," ":"00100"};
// Draws into an <svg>: text across `width` px, pitch px per character, hole radius r. Paper colour comes from CSS.
function punchTape(svg, text, {pitch = 22, r = 5.6, sprocket = 2.2, ink = "#141414", x0 = 14, height = 92} = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const rowY = [0.16, 0.30, 0.44, 0.66, 0.80].map(f => f * height); // track centres; the gap is where the sprocket runs
  const sprY = 0.55 * height;
  let x = x0, i = 0;
  const chars = [...text.toUpperCase()];
  const total = Math.floor((svg.viewBox.baseVal.width || svg.clientWidth) / pitch);
  for (let n = 0; n < total; n++) {
    const ch = chars[n % chars.length];
    const code = ITA2[ch] || ITA2[" "];
    [...code].forEach((bit, k) => {
      if (bit === "1") { const c = document.createElementNS(ns, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", rowY[k]); c.setAttribute("r", r); c.setAttribute("fill", ink); svg.appendChild(c); }
    });
    const s = document.createElementNS(ns, "circle"); s.setAttribute("cx", x); s.setAttribute("cy", sprY); s.setAttribute("r", sprocket); s.setAttribute("fill", ink); svg.appendChild(s);
    x += pitch; i++;
  }
}
