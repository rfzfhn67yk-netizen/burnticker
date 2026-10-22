// B-2 (third audit 2026-10-19; the fifth pass's LA-1): one creator could refresh while the first create was pending, press Launch again,
// get a new mint and sign a second bundle, ending with two live coins on one ticker and paying twice. Now the page reports the create it
// is about to send, the creator's next prepare of the ticker is refused as launch-pending while that create can still land, the page's
// recovery path still finishes the first launch, and the confirm (and the reconciler, and the operator) refuse a second live coin.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { DRAFT_TTL_MS, TICKER_LIVE_ALERT_KIND, TickerAlreadyLiveError, openRegistry, type TokenRow } from "@/lib/burnticker/registry";
import { lockRule } from "@/lib/burnticker/rules";
import { markCreateSent, markLaunched, prepareLaunch, resetConfirmGuards, SENT_TX_FORMAT_PREFIX } from "@/lib/burnticker/api/handlers";
import { limiter } from "@/lib/burnticker/api/http";
import { SdkLaunchLab, type LaunchBundle } from "@/lib/burnticker/launchBundle";
import { LAUNCHLAB_PROGRAM } from "@/lib/burnKeeper/launchlab";
import { CREATE_SEND_PENDING_MS, LAUNCH_PENDING_CODE, launchPendingRefusal } from "@/lib/burnticker/launchPending";
import { reconcileDrafts, reviveDraft, type DraftChainReader } from "@/lib/burnticker/draftReconciler";
import { configPda, feePda } from "@/lib/burnReceipts/pda";
import { sentReporter, type SignPlan } from "@/lib/burnticker/signPlan";
import type { LaunchExpectation, LaunchVerifier } from "@/lib/burnticker/launchVerify";
import { lintCopy } from "@/lib/launch/copyLint";
import { PUSH_KIND_OF_ALERT, PUSH_LEAD } from "@/lib/burnticker/push";
import { ageDraftsPastDedupe, encodeAccount, makeWorld } from "./burntickerApiHelpers.ts";
import { BRONCOS } from "./burntickerHelpers.ts";

const RULE = { ...BRONCOS, pair: null };
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const r = () => Keypair.generate().publicKey;
const sig = (c: string) => c.repeat(88);
beforeEach(() => { limiter.reset(); resetConfirmGuards(); });

/** A world whose LaunchLab client is the SDK's (the bundle carries the real initialize_v2), and a creator whose key the test holds. */
async function world() {
  const w = await makeWorld();
  const DEVNET_GLOBAL = { curveType: 0, index: 0, migrateFee: BigInt(0), tradeFeeRate: BigInt(2500), maxShareFeeRate: BigInt(10000), minSupplyA: BigInt(10_000_000), maxLockRate: BigInt(999_999), minSellRateA: BigInt(1), minMigrateRateA: BigInt(1), minFundRaisingB: BigInt(1), mintB: WSOL };
  const PLATFORM_VIEW = { feeRate: BigInt(7500), creatorFeeRate: BigInt(500), platformScale: BigInt(0), creatorScale: BigInt(100_000), burnScale: BigInt(900_000), cpConfigId: r(), platformCpCreator: PublicKey.default, platformClaimFeeWallet: r(), platformLockNftWallet: r(), platformVestingScale: BigInt(0), restrictCurveParam: 0, name: "Burnticker" };
  (w.p as { launchLab: unknown }).launchLab = new SdkLaunchLab({ cluster: "devnet", programId: LAUNCHLAB_PROGRAM.devnet, platformId: r(), configId: r(), global: DEVNET_GLOBAL, platform: PLATFORM_VIEW });
  const creator = Keypair.generate();
  const body = { creator: creator.publicKey.toBase58(), ticker: "PEND", name: "Pending coin", rule: RULE, firstBuySol: "0", acknowledgements: { ruleLocked: true, noReturns: true } };
  return { w, creator, body };
}
const ixOf = (s: LaunchBundle["transactions"][number]["instructions"][number]) => new TransactionInstruction({ programId: new PublicKey(s.programId), keys: s.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(s.dataBase64, "base64") });
/** Step `step` of the bundle, signed by the given keys, as the page would hand it to the RPC (base64 of the wire bytes). */
function signedStep(b: LaunchBundle, step: number, signers: Keypair[]): string {
  const vt = new VersionedTransaction(new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: r().toBase58(), instructions: b.transactions[step].instructions.map(ixOf) }).compileToV0Message());
  vt.sign(signers);
  return Buffer.from(vt.serialize()).toString("base64");
}
const code = (x: { body: unknown }) => (x.body as { code?: string }).code;
const errorOf = (x: { body: unknown }) => String((x.body as { error?: string }).error ?? "");

describe("B-2 at prepare: a sent create blocks a second coin on the same ticker", () => {
  test("refresh + Launch again (a new mint) is refused with launch-pending; the first draft's own retry and its confirm still work", async () => {
    const { w, creator, body } = await world();
    const m1 = Keypair.generate();
    const a = await prepareLaunch(w.p, body, { register: true, mint: m1.publicKey.toBase58() });
    assert.ok("ok" in a, JSON.stringify("error" in a ? a.error.body : a).slice(0, 300));
    // the page reports the create (step 2) just before it sends it
    const sentTx = signedStep(a.ok.bundle, 1, [creator, m1]);
    const sent = await markCreateSent(w.p, m1.publicKey.toBase58(), sentTx);
    // SEC-05: the 200 names the recorded row (the page sends only on that acknowledgement)
    assert.equal(sent.status, 200, JSON.stringify(sent.body)); assert.equal((sent.body as { recorded: { mint: string } }).recorded.mint, m1.publicKey.toBase58()); assert.equal((sent.body as { fresh: boolean }).fresh, true);
    assert.equal(w.registry.createSends(m1.publicKey.toBase58()).length, 1);
    // LA7 fix B: the format the create was sent in is read from its bytes and kept in the launch record (with the page's fallback note)
    assert.equal((sent.body as { txFormat?: unknown }).txFormat, 0);
    assert.deepEqual(JSON.parse(w.registry.getStatus(SENT_TX_FORMAT_PREFIX + m1.publicKey.toBase58())!), { format: 0 });
    const noted = await markCreateSent(w.p, m1.publicKey.toBase58(), sentTx, Date.now(), { formatFallback: 'the node said "unsupported transaction version"\n' });
    assert.equal(noted.status, 200);
    assert.deepEqual(JSON.parse(w.registry.getStatus(SENT_TX_FORMAT_PREFIX + m1.publicKey.toBase58())!), { format: 0, fallback: "the node said 'unsupported transaction version' " });
    // the refresh: the idempotency key is gone, Launch is pressed again, the bank (or the browser) gives a new mint
    const m2 = Keypair.generate().publicKey.toBase58();
    const b = await prepareLaunch(w.p, body, { register: true, mint: m2 });
    assert.ok("error" in b, "the second prepare is refused");
    if (!("error" in b)) return;
    assert.equal(b.error.status, 409); assert.equal(code(b.error), LAUNCH_PENDING_CODE);
    assert.match(errorOf(b.error), new RegExp(m1.publicKey.toBase58())); assert.match(errorOf(b.error), /Check on chain and record/);
    assert.deepEqual(lintCopy(errorOf(b.error)).hits, []);
    assert.equal(w.registry.token(m2), null, "nothing was registered for the second mint");
    // the resume path: the same draft (same mint) is still prepared again as before, and its create confirms
    const again = await prepareLaunch(w.p, body, { register: true, mint: m1.publicKey.toBase58() });
    assert.ok("ok" in again, JSON.stringify("error" in again ? again.error.body : again).slice(0, 300));
    w.p.launchVerifier = { verify: async () => ({ ok: true as const, blockTimeMs: Date.now() }) };
    const c = await markLaunched(w.p, m1.publicKey.toBase58(), sig("5"), Date.now(), "t");
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.deepEqual(w.registry.tokens().filter((t) => t.ticker === "PEND" && t.status === "live").map((t) => t.mint), [m1.publicKey.toBase58()]);
    // and once it is live the creator's next $PEND is refused at prepare (a ticker is one coin), before anything is paid
    const third = await prepareLaunch(w.p, body, { register: true, mint: Keypair.generate().publicKey.toBase58() });
    // (the lookalike guard answers first; launchPending.ts refuses the creator's own live coin too, for any path that skips it)
    assert.ok("error" in third); if ("error" in third) { assert.equal(third.error.status, 409); assert.equal(code(third.error), "ticker-taken"); assert.deepEqual(lintCopy(errorOf(third.error)).hits, []); }
    const own = await launchPendingRefusal({ registry: w.registry, market: null }, { creator: creator.publicKey.toBase58(), ticker: "PEND", exceptMint: null });
    assert.equal(own?.extra.code, "ticker-taken"); assert.match(String(own?.error), /You already launched \$PEND/); assert.deepEqual(lintCopy(String(own?.error)).hits, []);
  });

  test("a draft whose create was never sent: LA7-5 refuses a second draft on a new mint for 30 minutes (draft-exists); its own mint goes through; after the window a new one does too", async () => {
    const { w, body } = await world();
    const m1 = Keypair.generate().publicKey.toBase58();
    const a = await prepareLaunch(w.p, body, { register: true, mint: m1 });
    assert.ok("ok" in a);
    const b = await prepareLaunch(w.p, body, { register: true, mint: Keypair.generate().publicKey.toBase58() });
    assert.ok("error" in b); if ("error" in b) { assert.equal(code(b.error), "draft-exists"); assert.equal((b.error.body as { mint?: string }).mint, m1); }
    assert.ok("ok" in await prepareLaunch(w.p, body, { register: true, mint: m1 }), "the same draft is prepared again");
    ageDraftsPastDedupe(w.registry);
    const c = await prepareLaunch(w.p, body, { register: true, mint: Keypair.generate().publicKey.toBase58() });
    assert.ok("ok" in c, JSON.stringify("error" in c ? c.error.body : c).slice(0, 300));
  });

  test("only the creator's own signed create marks a draft: another wallet's signature, a lock step, or garbage is refused and records nothing", async () => {
    const { w, creator, body } = await world();
    const m1 = Keypair.generate();
    const a = await prepareLaunch(w.p, body, { register: true, mint: m1.publicKey.toBase58() });
    assert.ok("ok" in a); if (!("ok" in a)) return;
    const mint = m1.publicKey.toBase58();
    const stranger = Keypair.generate();
    const forged = signedStep(a.ok.bundle, 1, [stranger, m1]);
    const mark = (m: string, tx: unknown) => markCreateSent(w.p, m, tx);
    assert.equal((await mark(mint, forged)).status, 422, "not signed by the draft's creator");
    for (const bad of [forged, signedStep(a.ok.bundle, 0, [creator, m1]), "x".repeat(200)]) assert.deepEqual(lintCopy(errorOf(await mark(mint, bad))).hits, []);
    // a signature slot filled with someone else's signature over the same message
    const tx = VersionedTransaction.deserialize(Buffer.from(signedStep(a.ok.bundle, 1, [creator, m1]), "base64"));
    tx.signatures[0] = Keypair.generate().secretKey.slice(0, 64);
    assert.equal((await mark(mint, Buffer.from(tx.serialize()).toString("base64"))).status, 422, "a creator signature that does not verify");
    assert.equal((await mark(mint, signedStep(a.ok.bundle, 0, [creator, m1]))).status, 422, "the lock step is not the create");
    assert.equal((await mark(mint, "not a transaction")).status, 400);
    assert.equal((await mark(Keypair.generate().publicKey.toBase58(), forged)).status, 404);
    assert.equal(w.registry.createSends(mint).length, 0);
    const ok = await mark(mint, signedStep(a.ok.bundle, 1, [creator, m1]));
    assert.equal(ok.status, 200);
    assert.equal(((await mark(mint, signedStep(a.ok.bundle, 1, [creator, m1]))).body as { fresh: boolean }).fresh, true, "a rebuilt create (new blockhash) is a new send");
  });

  test("the window: a send that can no longer land frees the ticker for the creator, unless the chain shows the coin exists", async () => {
    const reg = openRegistry(":memory:");
    const creator = Keypair.generate().publicKey.toBase58(), t0 = Date.now();
    const d = reg.register({ mint: r().toBase58(), ticker: "WIN", name: "Window", creator, description: "", imageUrl: null, links: [], rulesText: lockRuleText(), feePda: "F", vault: null, tokenConfig: null, poolId: r().toBase58(), launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(t0).toISOString(), status: "draft" }, t0);
    reg.recordCreateSent(d.mint, sig("7"), t0);
    // B-15 (sixth pass): "the coin exists" is the burn program's TokenConfig for the mint naming this creator, not any account
    const PROGRAM = r();
    const created = (mint: string) => ({ owner: PROGRAM, data: encodeAccount("TokenConfig", (v) => { v.mint = new PublicKey(mint); v.creator = new PublicKey(creator); }) });
    const configOf = (mint: string) => configPda(PROGRAM, new PublicKey(mint)).toBase58();
    const program = { programId: PROGRAM.toBase58() };
    const ask = (market: { getAccountInfo(k: PublicKey): Promise<unknown> } | null, now: number) => launchPendingRefusal({ registry: reg, market, program }, { creator, ticker: "win", exceptMint: null }, now);
    assert.equal((await ask(null, t0 + 60_000))?.extra.code, LAUNCH_PENDING_CODE, "inside the window");
    assert.equal(await ask(null, t0 + CREATE_SEND_PENDING_MS + 1), null, "past it, with no chain reader: free again (the confirm still refuses a second live coin)");
    assert.equal(await ask({ getAccountInfo: async () => null }, t0 + CREATE_SEND_PENDING_MS + 1), null, "past it, and the mint does not exist: the send expired");
    assert.equal((await ask({ getAccountInfo: async (k) => (k.toBase58() === configOf(d.mint) ? created(d.mint) : null) }, t0 + CREATE_SEND_PENDING_MS + 1))?.extra.code, LAUNCH_PENDING_CODE, "the coin exists on chain: still pending its record");
    assert.equal(await ask({ getAccountInfo: async () => ({ lamports: 890_880, owner: PublicKey.default, data: Buffer.alloc(0) }) }, t0 + CREATE_SEND_PENDING_MS + 1), null, "dust at the addresses is not a created coin (B-15)");
    assert.equal((await ask({ getAccountInfo: async () => { throw new Error("rpc down"); } }, t0 + CREATE_SEND_PENDING_MS + 1))?.extra.code, LAUNCH_PENDING_CODE, "an unreadable chain after a send: fail closed");
    assert.equal(await launchPendingRefusal({ registry: reg, market: null }, { creator: r().toBase58(), ticker: "WIN", exceptMint: null }, t0 + 60_000), null, "another creator is the ticker rules' business, not this one");
    assert.equal(await launchPendingRefusal({ registry: reg, market: null }, { creator, ticker: "WIN", exceptMint: d.mint }, t0 + 60_000), null, "a retry of that same draft");
    // a create that landed with no send report (an older page) is found on chain too
    const quiet = reg.register({ mint: r().toBase58(), ticker: "QUIET", name: "Quiet", creator, description: "", imageUrl: null, links: [], rulesText: lockRuleText(), feePda: "F", vault: null, tokenConfig: null, poolId: r().toBase58(), launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(t0).toISOString(), status: "draft" }, t0);
    assert.equal((await launchPendingRefusal({ registry: reg, market: { getAccountInfo: async (k) => (k.toBase58() === configOf(quiet.mint) ? created(quiet.mint) : null) }, program }, { creator, ticker: "QUIET", exceptMint: null }, t0 + 60_000))?.extra.code, LAUNCH_PENDING_CODE);
  });

  test("the card reports only the create step, once per coin it confirms", async () => {
    const posted: { mint: string; sentTx: string }[] = [];
    const plan = { confirms: [{ mint: "A", ticker: "A", step: 1 }, { mint: "B", ticker: "B", step: 2 }] } as unknown as SignPlan;
    const onSent = sentReporter(plan, async (b) => { posted.push(b); return { acknowledged: true }; });
    assert.deepEqual(await onSent(0, "s0", "tx0"), [], "the lock step reports nothing");
    assert.deepEqual(await onSent(1, "s1", "tx1"), [{ acknowledged: true }]); await onSent(2, "s2", "tx2");
    assert.deepEqual(posted, [{ action: "sent", mint: "A", sentTx: "tx1" }, { action: "sent", mint: "B", sentTx: "tx2" }]);
    // SEC-05: a failed report is no longer swallowed into silence: it comes back as an unacknowledged report (the runner then does not send)
    const failing = sentReporter(plan, async () => { throw new Error("offline"); });
    assert.deepEqual(await failing(1, "s", "tx"), [{ acknowledged: false, reason: "offline" }]);
  });
});

describe("B-2 at confirm: a race that slips past prepare still yields one live coin, and the owner hears of it", () => {
  test("two drafts of one creator on one ticker (the audit's reproduction): the second confirmation is refused 409 ticker-live and alerted", async () => {
    const { w, body } = await world();
    const m1 = Keypair.generate().publicKey.toBase58(), m2 = Keypair.generate().publicKey.toBase58();
    assert.ok("ok" in await prepareLaunch(w.p, body, { register: true, mint: m1 }));
    ageDraftsPastDedupe(w.registry);   // LA7-5: a second draft exists only after the 30-minute window
    assert.ok("ok" in await prepareLaunch(w.p, body, { register: true, mint: m2 }), "no send was reported, so the exemption let it through");
    w.p.launchVerifier = { verify: async () => ({ ok: true as const, blockTimeMs: Date.now() }) };
    const c1 = await markLaunched(w.p, m1, sig("5"), Date.now(), "t");
    const c2 = await markLaunched(w.p, m2, sig("6"), Date.now(), "t");
    assert.equal(c1.status, 200);
    assert.equal(c2.status, 409, JSON.stringify(c2.body)); assert.equal(code(c2), "ticker-live");
    assert.match(errorOf(c2), /You already have a live \$PEND/); assert.deepEqual(lintCopy(errorOf(c2)).hits, []);
    assert.deepEqual(w.registry.tokens().filter((t) => t.ticker === "PEND" && t.status === "live").map((t) => t.mint), [m1]);
    assert.equal(w.registry.token(m2)!.status, "draft");
    const al = w.registry.alertsSince(0).filter((a) => a.kind === TICKER_LIVE_ALERT_KIND);
    assert.equal(al.length, 1); assert.match(al[0].text, /PEND/); assert.match(al[0].text, /same creator's/);
    assert.equal(PUSH_KIND_OF_ALERT[TICKER_LIVE_ALERT_KIND], "ticker-live", "the owner's phone hears of it (push.ts)");
    assert.deepEqual(lintCopy(PUSH_LEAD["ticker-live"]).hits, []);
    // a replay of the first confirmation is still the usual no-op
    assert.equal((await markLaunched(w.p, m1, sig("5"), Date.now(), "t")).status, 200);
  });

  /** One creator's two drafts of TWO, the first live; the second's create landed in its window (and, in one case, it expired since). */
  const twoDrafts = (expire: boolean) => {
    const reg = openRegistry(":memory:");
    const T0 = Date.parse("2026-10-14T12:00:00Z"), PROGRAM = r().toBase58(), creator = r().toBase58();
    const draft = (at: number): TokenRow => reg.register({ mint: r().toBase58(), ticker: "TWO", name: "Two coin", creator, description: "", imageUrl: null, links: [], rulesText: lockRuleText(), feePda: "F", vault: null, tokenConfig: null, poolId: r().toBase58(), launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(at).toISOString(), status: "draft" }, at);
    const a = draft(T0), b = draft(T0 + 60_000);
    reg.markLaunched(a.mint, sig("4"), null, new Date(T0 + 120_000).toISOString());
    const landed = T0 + 180_000;
    const now = expire ? T0 + DRAFT_TTL_MS + 3_600_000 : T0 + 600_000;
    if (expire) reg.expireDrafts(now);
    return { reg, a, b, landed, now, PROGRAM };
  };
  const tableVerifier = (mint: string, blockTimeMs: number): LaunchVerifier => ({ async verify(s: string, e: LaunchExpectation) { return s === sig("5") && e.mint === mint ? { ok: true, blockTimeMs } : { ok: false, status: 422, reason: "not this coin's launch" }; } } as LaunchVerifier);

  for (const expire of [false, true]) {
    test(`the keeper's reconciler (${expire ? "an expired draft's revival" : "a draft"}) never takes the second coin live; it logs, backs off and the owner hears once`, async () => {
      const { reg, a, b, landed, now, PROGRAM } = twoDrafts(expire);
      const reader = {
        async getMultipleAccountsInfo(keys: PublicKey[]) { return keys.map((k) => (configPda(new PublicKey(PROGRAM), new PublicKey(b.mint)).equals(k) ? { owner: new PublicKey(PROGRAM), data: new Uint8Array(8) } : null)); },
        async getSignaturesForAddress(addr: PublicKey) { return feePda(new PublicKey(PROGRAM), new PublicKey(b.mint)).equals(addr) ? [{ signature: sig("5"), err: null, blockTime: Math.floor(landed / 1000) }] : []; },
      } as unknown as DraftChainReader;
      const lines: string[] = [];
      const rep = await reconcileDrafts({ registry: reg, reader, verifier: tableVerifier(b.mint, landed), burnProgramId: PROGRAM, now: () => now, log: (l) => lines.push(l), dryRun: false, env: {} });
      assert.equal(rep.takenLive.length, 0, JSON.stringify(rep));
      assert.ok(lines.some((l) => /already live/.test(l)), lines.join("\n"));
      assert.deepEqual(reg.tokens().filter((t) => t.status === "live").map((t) => t.mint), [a.mint]);
      assert.equal(reg.draftRevivals().length, 0);
      assert.equal(reg.alertsSince(0).filter((x) => x.kind === TICKER_LIVE_ALERT_KIND).length, 1);
      // the operator's revive is refused with the reason, and the registry refuses any caller
      const op = await reviveDraft(reg, tableVerifier(b.mint, landed), { mint: b.mint, launchTx: sig("5"), note: "the creator asked", late: false, apply: true });
      assert.equal(op.ok, false); if (!op.ok) assert.match(op.reason, /already live/);
      assert.throws(() => reg.takeLiveFromChain(b.mint, sig("5"), b.poolId, landed, { source: "confirm" }, now), (e: unknown) => e instanceof TickerAlreadyLiveError && e.sameCreator && e.liveMint === a.mint);
    });
  }

  test("another creator's coin live on the ticker blocks a confirmation too (any race: two live coins never share a ticker)", () => {
    const reg = openRegistry(":memory:");
    const T0 = Date.now();
    // the old data (or a path that skipped the ticker rules): Y's draft first, then X's coin recorded live on the same ticker
    const y = reg.register({ mint: r().toBase58(), ticker: "ANY", name: "Any", creator: r().toBase58(), description: "", imageUrl: null, links: [], rulesText: lockRuleText(), feePda: "F", vault: null, tokenConfig: null, poolId: r().toBase58(), launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
    const x = reg.register({ mint: r().toBase58(), ticker: "ANY", name: "Any", creator: r().toBase58(), description: "", imageUrl: null, links: [], rulesText: lockRuleText(), feePda: "F", vault: null, tokenConfig: null, poolId: r().toBase58(), launchTx: sig("3"), cluster: "devnet", platformId: null, baselineAt: new Date(T0).toISOString(), status: "live" }, T0 + 1);
    assert.throws(() => reg.takeLiveFromChain(y.mint, sig("5"), y.poolId, T0 + 60_000, { source: "confirm" }, T0 + 120_000), (e: unknown) => e instanceof TickerAlreadyLiveError && !e.sameCreator && e.liveMint === x.mint);
    assert.equal(reg.token(y.mint)!.status, "draft");
    assert.match(reg.alertsSince(0).find((a) => a.kind === TICKER_LIVE_ALERT_KIND)!.text, /another \$ANY is already live/);
    // a different ticker is untouched
    const z = reg.register({ mint: r().toBase58(), ticker: "OTHER", name: "Other", creator: r().toBase58(), description: "", imageUrl: null, links: [], rulesText: lockRuleText(), feePda: "F", vault: null, tokenConfig: null, poolId: r().toBase58(), launchTx: null, cluster: "devnet", platformId: null, baselineAt: new Date(T0).toISOString(), status: "draft" }, T0);
    assert.equal(reg.takeLiveFromChain(z.mint, sig("6"), z.poolId, T0 + 60_000, { source: "confirm" }, T0 + 120_000).changed, true);
  });
});

const lockRuleText = (): string => lockRule(RULE).text;
