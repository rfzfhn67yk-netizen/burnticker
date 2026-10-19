// A SMALL HOOK RUNNER FOR THE COIN PAGE'S SWAP COMPONENT (prelaunch audit 2026-10-18 F03/F04). The suite has no DOM, so this compiles the
// actual TradePanel.tsx with TypeScript, runs its Swap component with a minimal stand-in for React's hooks (state, memo, callback, ref,
// effect: effects run after each render, a state change renders again), and gives the test the rendered element tree to read and click.
// The chain, plan, copy and pending modules are the real ones; only the wallet, the connection and the component's own timers are fakes.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { Keypair, PublicKey } from "@solana/web3.js";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");
const SRC = path.resolve("src/app/burnticker/t/[ticker]/TradePanel.tsx");

export const FX = JSON.parse(fs.readFileSync(path.resolve("test/fixtures/burnticker-swap-devnet.json"), "utf8")) as Record<string, { address?: string; owner?: string; data?: string }>;
export const ACCOUNTS = new Map(Object.values(FX).filter((a) => a && a.address && a.owner && a.data).map((a) => [a.address!, { owner: new PublicKey(a.owner!), data: Buffer.from(a.data!, "base64"), lamports: 0, executable: false }]));
export const deferred = <T,>() => { let ok!: (v: T) => void, no!: (e: unknown) => void; const p = new Promise<T>((a, b) => { ok = a; no = b; }); return { p, ok, no }; };
export const newKey = () => Keypair.generate().publicKey;

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
type Hook = { value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void; current?: unknown };
const depsEq = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

function textOf(x: unknown): string {
  if (x === null || x === undefined || x === false || x === true) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (Array.isArray(x)) return x.map(textOf).join("");
  return textOf((x as El).props?.children);
}

/** Just enough of document for the panel's visibility checks. */
export class FakeDocument {
  visibilityState: "visible" | "hidden" = "visible";
  private listeners = new Set<() => void>();
  addEventListener(type: string, f: () => void) { if (type === "visibilitychange") this.listeners.add(f); }
  removeEventListener(type: string, f: () => void) { if (type === "visibilitychange") this.listeners.delete(f); }
  set(state: "visible" | "hidden") { this.visibilityState = state; for (const f of [...this.listeners]) f(); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the wallet adapter's signTransaction, whatever transaction type the test signs
export interface FakeWallet { publicKey: PublicKey | null; connected: boolean; signTransaction?: (t: any) => Promise<unknown> }

let compiled: { Swap: (p: unknown) => El; bind: (h: SwapHarness) => void } | null = null;
async function compile() {
  if (compiled) return compiled;
  const source = fs.readFileSync(SRC, "utf8").replace(/\nfunction Swap\(p:/, "\nexport function Swap(p:");
  const modules = new Map<string, unknown>();
  for (const m of source.matchAll(/from "(@\/[^"]+)"/g)) modules.set(m[1], await import(m[1]));
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let h: SwapHarness | null = null;
  const react = {
    useState: (v: unknown) => h!.useState(v), useMemo: (f: () => unknown, d: unknown[]) => h!.useMemo(f, d), useCallback: (f: unknown, d: unknown[]) => h!.useMemo(() => f, d),
    useRef: (v: unknown) => h!.useRef(v), useEffect: (f: () => (() => void) | void, d?: unknown[]) => h!.useEffect(f, d),
  };
  const stub = (s: string): unknown => {
    if (s === "react") return react;
    if (s === "react/jsx-runtime") return require("react/jsx-runtime");
    if (s === "@solana/web3.js") return require("@solana/web3.js");
    if (s === "@solana/wallet-adapter-react") return { useWallet: () => h!.wallet, useConnection: () => ({ connection: h!.conn }) };
    if (s === "@solana/wallet-adapter-react-ui") return { useWalletModal: () => ({ setVisible() {} }) };
    if (modules.has(s)) return modules.get(s);
    return require(s);
  };
  const exp: Record<string, unknown> = {};
  const sandbox: Record<string, unknown> = { exports: exp, require: stub, console, Date, Promise, BigInt, setTimeout: (fn: () => void, ms?: number) => h!.addTimer(fn, ms ?? 0), clearTimeout: (id?: number) => h!.clearTimer(id), Error, String, Number, Math, JSON };
  // the page's visibility: undefined unless a test sets harness.doc, so `typeof document` reads as it would without a DOM
  Object.defineProperty(sandbox, "document", { get: () => h?.doc, enumerable: true });
  vm.runInNewContext(out, sandbox);
  compiled = { Swap: exp.Swap as (p: unknown) => El, bind: (x) => { h = x; } };
  return compiled;
}

/** One mounted Swap component. `conn` is the connection the wallet adapter would pass; `wallet` can be replaced to switch wallets. */
export class SwapHarness {
  hooks: Hook[] = []; cursor = 0; effects: (() => void)[] = []; dirty = false;
  timers: { id: number; at: number; fn: () => void }[] = []; clock = 0; nextId = 1;
  el: El | null = null;
  /** a stand-in for document's visibility (visibilityState and visibilitychange); undefined means no DOM */
  doc: FakeDocument | undefined;
  Swap: (p: unknown) => El; props: Record<string, unknown>; wallet: FakeWallet; conn: unknown;
  constructor(Swap: (p: unknown) => El, props: Record<string, unknown>, wallet: FakeWallet, conn: unknown) { this.Swap = Swap; this.props = props; this.wallet = wallet; this.conn = conn; }

  static async mount(props: Record<string, unknown>, wallet: FakeWallet, conn: unknown): Promise<SwapHarness> {
    const c = await compile();
    const h = new SwapHarness(c.Swap, props, wallet, conn);
    c.bind(h);
    h.render();
    await h.settle();
    return h;
  }

  useState(v: unknown) {
    const i = this.cursor++;
    if (!this.hooks[i]) this.hooks[i] = { value: typeof v === "function" ? (v as () => unknown)() : v };
    const hook = this.hooks[i];
    return [hook.value, (n: unknown) => { const next = typeof n === "function" ? (n as (x: unknown) => unknown)(hook.value) : n; if (!Object.is(next, hook.value)) { hook.value = next; this.dirty = true; } }];
  }
  useMemo(f: () => unknown, deps: unknown[]) { const i = this.cursor++; if (!this.hooks[i] || !depsEq(this.hooks[i].deps, deps)) this.hooks[i] = { value: f(), deps }; return this.hooks[i].value; }
  useRef(v: unknown) { const i = this.cursor++; return (this.hooks[i] ??= { current: v }); }
  useEffect(f: () => (() => void) | void, deps?: unknown[]) {
    const i = this.cursor++;
    const prev = this.hooks[i];
    if (prev && deps && depsEq(prev.deps, deps)) return;
    const hook: Hook = { deps, cleanup: prev?.cleanup };
    this.hooks[i] = hook;
    this.effects.push(() => { if (typeof hook.cleanup === "function") hook.cleanup(); hook.cleanup = f(); });
  }
  addTimer(fn: () => void, ms: number) { const id = this.nextId++; this.timers.push({ id, at: this.clock + Math.max(0, ms), fn }); return id; }
  clearTimer(id?: number) { this.timers = this.timers.filter((t) => t.id !== id); }

  render(): El {
    for (let n = 0; n < 50; n++) {
      this.dirty = false; this.cursor = 0;
      this.el = this.Swap(this.props);
      const run = this.effects; this.effects = [];
      for (const e of run) e();
      if (!this.dirty && !this.effects.length) return this.el;
    }
    throw new Error("the component kept re-rendering");
  }
  /** Lets promises settle, fires due timers, and renders again until nothing changes. */
  async settle(rounds = 30): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await new Promise((ok) => setImmediate(ok));
      const due = this.timers.filter((t) => t.at <= this.clock).sort((a, b) => a.at - b.at);
      this.timers = this.timers.filter((t) => t.at > this.clock);
      for (const t of due) t.fn();
      this.render();
    }
  }
  /** Moves the component's own clock forward (its setTimeout calls), then settles. */
  async advance(ms: number): Promise<void> { this.clock += ms; await this.settle(); }
  async switchWallet(w: FakeWallet): Promise<void> { this.wallet = w; this.render(); await this.settle(); }

  elements(): El[] {
    const out: El[] = [];
    const walk = (x: unknown) => { if (!x || typeof x !== "object") return; if (Array.isArray(x)) { x.forEach(walk); return; } const e = x as El; if (!e.props) return; out.push(e); walk(e.props.children); };
    walk(this.el);
    return out;
  }
  /** The visible text of the whole panel, or of one element. */
  text(x?: unknown): string { return textOf(arguments.length ? x : this.el); }
  find(attr: string): El | undefined { return this.elements().find((e) => e.props[attr] !== undefined); }
  swapButton(): El | undefined { return this.find("data-swap-button"); }
  refusal(): string | null { const r = this.find("data-swap-refusal"); return r ? this.text(r) : null; }
  holds(): string | null { const m = this.text().match(/This wallet holds [^.]*\./); return m ? m[0] : null; }
  async type(value: string): Promise<void> {
    const input = this.elements().find((e) => e.type === "input");
    if (!input) throw new Error("no amount input");
    (input.props.onChange as (e: unknown) => void)({ target: { value } });
    this.render(); await this.settle();
  }
  async click(e: El | undefined): Promise<void> {
    if (!e) throw new Error("nothing to click");
    (e.props.onClick as () => unknown)();
    this.render(); await this.settle();
  }
}
