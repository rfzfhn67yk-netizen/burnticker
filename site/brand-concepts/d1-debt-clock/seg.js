// Render a string into a .seg7 element. Digits, comma, dot, $ (S with a bar), minus, plus (rendered as a lit g + bar),
// and the handful of letters a seven-segment display can actually form. Anything else is a blank digit.
const SEG = {"0":"abcdef","1":"bc","2":"abged","3":"abgcd","4":"fgbc","5":"afgcd","6":"afgedc","7":"abc","8":"abcdefg","9":"abcdfg",
  "-":"g","S":"afgcd","E":"afged","b":"fgedc","d":"bcdeg","U":"bcdef","L":"fed","P":"abefg","A":"abcefg","C":"afed","H":"bcefg",
  "o":"gecd","n":"egc","r":"ge","t":"fged","F":"afeg","I":"bc"," ":""};
function seg7(el, text) {
  el.classList.add("seg7");
  for (const ch of text) {
    const d = document.createElement("div");
    if (ch === ",") { d.className = "d comma"; d.innerHTML = '<div class="s on"></div>'; el.appendChild(d); continue; }
    if (ch === ".") { d.className = "d dot"; d.innerHTML = '<div class="s on"></div>'; el.appendChild(d); continue; }
    d.className = "d";
    const on = ch === "$" ? SEG.S : ch === "+" ? "g" : (SEG[ch] ?? "");
    d.innerHTML = ["a","b","c","d","e","f","g"].map(s => `<div class="s ${s === "d" ? "dd" : s}${on.includes(s) ? " on" : ""}"></div>`).join("")
      + ((ch === "$" || ch === "+") ? '<div class="s bar on"></div>' : "");
    el.appendChild(d);
  }
}
