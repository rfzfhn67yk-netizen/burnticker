/**
 * A LINEAR-TIME REGEX MATCHER (2026-10-15 prelaunch audit H6). A creator's title filter (rule.filter.titleRegex) is evaluated on the one
 * Node process that serves the site and runs the readers, against every market title a selector sees. JavaScript's own engine
 * backtracks, and the star-height check that guarded it (safeRegex.ts, audit 6 item 8) let through patterns that still take polynomial
 * time to the fourth power and more ("a{1,100}a{1,100}a{1,100}a{1,100}b"), and the back-test route ran filters before any check.
 *
 * This matcher compiles the pattern to a Thompson NFA and runs it as a state set (a Pike VM without captures), so a test takes time
 * proportional to (title length) × (program size), whatever the pattern. It reads JavaScript's own syntax (no `u` flag), and only the
 * part a title filter needs: literals, escapes (\d \w \s and their negations, \b \B, \t \n \r \v \f \0, \xHH, \uHHHH, \cX, identity
 * escapes), classes with ranges and negation, `.`, `^` and `$`, groups (capturing, `(?:`, named), alternation and every quantifier
 * (greedy or lazy: the same for a yes/no test). Lookarounds and backreferences are not supported (they are what makes matching
 * non-regular); `compileLinear` says so, and the launch check refuses such a pattern. Flags: "" and "i". Pure; client-safe.
 */

type Pred = (c: number) => boolean;
type Node =
  | { t: "char"; p: Pred }
  | { t: "assert"; k: "^" | "$" | "b" | "B" }
  | { t: "cat"; items: Node[] }
  | { t: "alt"; alts: Node[] }
  | { t: "rep"; node: Node; min: number; max: number }
  | { t: "empty" };

export class LinearRegexUnsupported extends Error { constructor(m: string) { super(m); this.name = "LinearRegexUnsupported"; } }

/** The most program instructions a pattern may compile to (a bounded repeat is copied out: "x{1,100}" is 100 copies). */
export const LINEAR_MAX_PROGRAM = 4_000;

const LINE_TERMINATOR = (c: number) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const DIGIT: Pred = (c) => c >= 48 && c <= 57;
const WORD: Pred = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const SPACE: Pred = (c) => c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
const not = (p: Pred): Pred => (c) => !p(c);
const eq = (x: number): Pred => (c) => c === x;

class Parser {
  i = 0;
  /**
   * Case folding (flag "i"), JavaScript's way (ECMA-262 Canonicalize without the u flag): a set matches c when some member a has
   * canon(a) === canon(c), where canon is toUpperCase when that gives one code unit and does not turn a non-ASCII unit into an ASCII one
   * (so ſ, the Kelvin sign and ı keep their own case; ς, σ and Σ share one). Applied to each positive set before a class is negated.
   */
  readonly fold: (p: Pred) => Pred;
  readonly s: string;
  constructor(s: string, ci: boolean) {
    this.s = s;
    this.fold = ci ? foldSet : (p) => p;
  }
  peek(o = 0): string { return this.s[this.i + o] ?? ""; }
  eof(): boolean { return this.i >= this.s.length; }
  fail(m: string): never { throw new LinearRegexUnsupported(m); }

  parseAlt(): Node {
    const alts: Node[] = [this.parseCat()];
    while (this.peek() === "|") { this.i++; alts.push(this.parseCat()); }
    return alts.length === 1 ? alts[0] : { t: "alt", alts };
  }
  parseCat(): Node {
    const items: Node[] = [];
    while (!this.eof() && this.peek() !== "|" && this.peek() !== ")") items.push(this.parseQuantified());
    return items.length === 0 ? { t: "empty" } : items.length === 1 ? items[0] : { t: "cat", items };
  }
  parseQuantified(): Node {
    const atom = this.parseAtom();
    for (;;) {
      const c = this.peek();
      let min: number, max: number;
      if (c === "*") { min = 0; max = Infinity; this.i++; }
      else if (c === "+") { min = 1; max = Infinity; this.i++; }
      else if (c === "?") { min = 0; max = 1; this.i++; }
      else if (c === "{") {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(this.s.slice(this.i));
        if (!m) return atom;   // a "{" that is not a quantifier is a literal (non-unicode JavaScript)
        min = Number(m[1]); max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
        if (max < min) this.fail("a repeat's upper bound is below its lower bound");
        this.i += m[0].length;
      } else return atom;
      if (this.peek() === "?") this.i++;   // lazy: the same for a yes/no test
      if (atom.t === "assert") this.fail("a quantifier after an anchor");
      return { t: "rep", node: atom, min, max };
    }
  }
  parseAtom(): Node {
    const c = this.peek();
    if (c === "(") {
      this.i++;
      if (this.peek() === "?") {
        const n = this.peek(1);
        if (n === ":") this.i += 2;
        else if (n === "=" || n === "!") this.fail("a lookahead");
        else if (n === "<" && (this.peek(2) === "=" || this.peek(2) === "!")) this.fail("a lookbehind");
        else if (n === "<") { const m = /^\?<[A-Za-z_$][\w$]*>/.exec(this.s.slice(this.i)); if (!m) this.fail("a group name"); this.i += m[0].length; }
        else this.fail("a group modifier");
      }
      const inner = this.parseAlt();
      if (this.peek() !== ")") this.fail("an unclosed group");
      this.i++;
      return inner;
    }
    if (c === ")") this.fail("an unmatched )");
    if (c === "[") return { t: "char", p: this.parseClass() };
    if (c === ".") { this.i++; return { t: "char", p: this.fold(not(LINE_TERMINATOR)) }; }
    if (c === "^" || c === "$") { this.i++; return { t: "assert", k: c }; }
    if (c === "*" || c === "+" || c === "?") this.fail("a quantifier with nothing to repeat");
    if (c === "\\") {
      this.i++;
      const e = this.peek();
      if (e === "b" || e === "B") { this.i++; return { t: "assert", k: e }; }
      return { t: "char", p: this.fold(this.parseEscape(false).p) };
    }
    this.i++;
    return { t: "char", p: this.fold(eq(c.charCodeAt(0))) };
  }
  /** After a backslash: a character set (\d \w \s and negations; code null) or one character (its code). In a class, \b is the backspace. */
  parseEscape(inClass: boolean): { p: Pred; code: number | null } {
    const e = this.peek();
    if (e === "") this.fail("a trailing backslash");
    this.i++;
    const one = (x: number) => ({ p: eq(x), code: x });
    switch (e) {
      case "d": return { p: DIGIT, code: null }; case "D": return { p: not(DIGIT), code: null };
      case "w": return { p: WORD, code: null }; case "W": return { p: not(WORD), code: null };
      case "s": return { p: SPACE, code: null }; case "S": return { p: not(SPACE), code: null };
      case "t": return one(9); case "n": return one(10); case "r": return one(13); case "v": return one(11); case "f": return one(12);
      case "b": if (inClass) return one(8); break;
      case "0": if (!/[0-9]/.test(this.peek())) return one(0); this.fail("an octal escape"); break;
      case "x": { const m = /^[0-9A-Fa-f]{2}/.exec(this.s.slice(this.i)); if (m) { this.i += 2; return one(parseInt(m[0], 16)); } return one(120); }
      case "u": { const m = /^[0-9A-Fa-f]{4}/.exec(this.s.slice(this.i)); if (m) { this.i += 4; return one(parseInt(m[0], 16)); } return one(117); }
      case "c": { const l = this.peek(); if (/[A-Za-z]/.test(l)) { this.i++; return one(l.charCodeAt(0) % 32); } this.fail("a \\c escape"); break; }
      case "k": this.fail("a named backreference"); break;
      default: if (/[1-9]/.test(e)) this.fail("a backreference");
    }
    return one(e.charCodeAt(0));
  }
  parseClass(): Pred {
    this.i++;   // [
    let neg = false;
    if (this.peek() === "^") { neg = true; this.i++; }
    const parts: Pred[] = [];
    const single = (): { p: Pred; code: number | null } => {
      if (this.peek() === "\\") { this.i++; return this.parseEscape(true); }
      const ch = this.s.charCodeAt(this.i); this.i++; return { p: eq(ch), code: ch };
    };
    while (this.peek() !== "]") {
      if (this.eof()) this.fail("an unclosed class");
      const a = single();
      if (this.peek() === "-" && this.peek(1) !== "]" && this.peek(1) !== "") {
        this.i++;
        const b = single();
        if (a.code === null || b.code === null) { parts.push(this.fold(a.p), eq(45), this.fold(b.p)); continue; }   // [\d-x]: Annex B reads the dash literally
        if (b.code < a.code) this.fail("a class range out of order");
        const lo = a.code, hi = b.code;
        parts.push(this.fold((c) => c >= lo && c <= hi));
      } else parts.push(this.fold(a.p));
    }
    this.i++;   // ]
    const any: Pred = (c) => parts.some((p) => p(c));
    return neg ? not(any) : any;
  }
}

// ---- case folding: JavaScript's Canonicalize (no u flag) over every UTF-16 code unit, built once ----
let CANON: Uint16Array | null = null;
function canonTable(): Uint16Array {
  if (CANON) return CANON;
  const t = new Uint16Array(0x10000);
  for (let c = 0; c < 0x10000; c++) {
    const u = String.fromCharCode(c).toUpperCase();
    const uc = u.length === 1 ? u.charCodeAt(0) : c;
    t[c] = c >= 128 && uc < 128 ? c : uc;
  }
  return (CANON = t);
}
/** The predicate "some member of p canonicalises to canon(c)", as a 64 KB table: linear-time to test, built when the pattern compiles. */
function foldSet(p: Pred): Pred {
  const T = canonTable(), hit = new Uint8Array(0x10000);
  for (let a = 0; a < 0x10000; a++) if (p(a)) hit[T[a]] = 1;
  return (c) => hit[T[c]] === 1;
}

// ---- the program (a Thompson NFA) ----
type Ins = { op: "char"; p: Pred; next: number } | { op: "split"; a: number; b: number } | { op: "jmp"; to: number } | { op: "assert"; k: "^" | "$" | "b" | "B"; next: number } | { op: "match" };

function compile(root: Node): Ins[] {
  const prog: Ins[] = [];
  const emit = (i: Ins): number => { if (prog.length >= LINEAR_MAX_PROGRAM) throw new LinearRegexUnsupported(`more than ${LINEAR_MAX_PROGRAM} steps once its repeats are written out`); prog.push(i); return prog.length - 1; };
  // gen(n) emits n's code, leaving every dangling "next" pointed at the instruction emitted after it (patched through `holes`)
  const gen = (n: Node): number[] => {
    switch (n.t) {
      case "empty": return [];
      case "char": { const at = emit({ op: "char", p: n.p, next: -1 }); return [at]; }
      case "assert": { const at = emit({ op: "assert", k: n.k, next: -1 }); return [at]; }
      case "cat": { let holes: number[] = []; for (const it of n.items) { const start = prog.length; const h = gen(it); patch(holes, start); holes = h; } return holes; }
      case "alt": {
        const out: number[] = [];
        for (let k = 0; k < n.alts.length - 1; k++) {
          const sp = emit({ op: "split", a: prog.length + 1, b: -1 });
          out.push(...gen(n.alts[k]));
          const j = emit({ op: "jmp", to: -1 }); out.push(j);
          (prog[sp] as { b: number }).b = prog.length;
        }
        out.push(...gen(n.alts[n.alts.length - 1]));
        return out;
      }
      case "rep": {
        let holes: number[] = [];
        for (let k = 0; k < n.min; k++) { const start = prog.length; const h = gen(n.node); patch(holes, start); holes = h; }
        if (n.max === Infinity) {
          const sp = emit({ op: "split", a: prog.length + 1, b: -1 });
          patch(holes, sp);
          const body = gen(n.node);
          const j = emit({ op: "jmp", to: sp });
          patch(body, j);
          return [sp];
        }
        const exits: number[] = [];
        for (let k = n.min; k < n.max; k++) {
          const sp = emit({ op: "split", a: prog.length + 1, b: -1 });
          patch(holes, sp);
          exits.push(sp);
          holes = gen(n.node);
        }
        return [...holes, ...exits];
      }
    }
  };
  const patch = (holes: number[], to: number) => {
    for (const h of holes) {
      const ins = prog[h];
      if (ins.op === "char" || ins.op === "assert") { if (ins.next === -1) ins.next = to; }
      else if (ins.op === "jmp") { if (ins.to === -1) ins.to = to; }
      else if (ins.op === "split") { if (ins.b === -1) ins.b = to; }
    }
  };
  const holes = gen(root);
  const m = emit({ op: "match" });
  patch(holes, m);
  // an empty tail (a pattern that is all assertions or empty) falls through to match: point any hole left at -1 there
  for (const ins of prog) {
    if ((ins.op === "char" || ins.op === "assert") && ins.next === -1) ins.next = m;
    if (ins.op === "jmp" && ins.to === -1) ins.to = m;
    if (ins.op === "split" && ins.b === -1) ins.b = m;
  }
  return prog;
}

export interface LinearRegex { test(text: string): boolean; readonly size: number }

/** Compiles `pattern` (JavaScript syntax, flags "" or "i"). Throws LinearRegexUnsupported for a feature it does not read. */
export function compileLinear(pattern: string, flags = ""): LinearRegex {
  if (!/^i?$/.test(flags)) throw new LinearRegexUnsupported(`the flags "${flags}"`);
  const ps = new Parser(pattern, flags === "i");
  const root = ps.parseAlt();
  if (!ps.eof()) ps.fail("an unmatched )");
  const prog = compile(root);
  const isWord = (s: string, i: number) => i >= 0 && i < s.length && WORD(s.charCodeAt(i));
  return {
    size: prog.length,
    test(text: string): boolean {
      const n = text.length, seen = new Int32Array(prog.length).fill(-1);
      let gen = 0;
      // add pc and its epsilon closure at position i to `list`; true when it reaches match
      const add = (list: number[], pc: number, i: number): boolean => {
        const stack = [pc];
        while (stack.length) {
          const x = stack.pop()!;
          if (seen[x] === gen) continue;
          seen[x] = gen;
          const ins = prog[x];
          switch (ins.op) {
            case "match": return true;
            case "jmp": stack.push(ins.to); break;
            case "split": stack.push(ins.b, ins.a); break;
            case "assert": {
              const ok = ins.k === "^" ? i === 0 : ins.k === "$" ? i === n : (isWord(text, i - 1) !== isWord(text, i)) === (ins.k === "b");
              if (ok) stack.push(ins.next);
              break;
            }
            case "char": list.push(x); break;
          }
        }
        return false;
      };
      let cur: number[] = [];
      for (let i = 0; ; i++) {
        gen++;
        const next: number[] = [];
        // the threads carried from i-1 were added under the previous generation: re-close them at i
        for (const pc of cur) if (add(next, pc, i)) return true;
        if (add(next, 0, i)) return true;   // an unanchored search: a new thread starts at every position
        if (i >= n) return false;
        const c = text.charCodeAt(i);
        cur = [];
        for (const pc of next) { const ins = prog[pc] as Extract<Ins, { op: "char" }>; if (ins.p(c)) cur.push(ins.next); }
      }
    },
  };
}
