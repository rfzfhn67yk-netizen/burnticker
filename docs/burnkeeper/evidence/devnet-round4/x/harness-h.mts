// devnet-r4 adversarial harness: builds instructions the admin CLIs do not expose with a free choice of accounts, SIMULATES them on
// devnet (sigVerify off) and prints {simulation:{err,logs}}. --send only for `propose` (admin = the r4x payer). Never prints a key.
import fs from "node:fs";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
const REPO = "<repo>/src/lib";
const { initializeTokenIx, operatorAttester, proposeAttestersIx, applyAttesterChangeIx, createAtaIdempotentIx } = await import(`${REPO}/burnReceipts/instructions.ts`);
const { forwardOnEndIx } = await import(`${REPO}/burnReceipts/endSink.ts`);
const { applyPairedAttesterChangeIx, pairAttesterChangeMessage, pairSetHash } = await import(`${REPO}/burnReceipts/pairs.ts`);
const { ed25519SharedMessageInstruction } = await import(`${REPO}/burnReceipts/attestation.ts`);
const { ruleParamsFromKeeperRules } = await import(`${REPO}/burnReceipts/math.ts`);
const { loadRules } = await import(`${REPO}/burnKeeper/rules.ts`);
const { fetchTokenConfig } = await import(`${REPO}/burnReceipts/accounts.ts`);
const { feePda, associatedTokenAddress } = await import(`${REPO}/burnReceipts/pda.ts`);
const { NATIVE_MINT } = await import(`${REPO}/burnReceipts/constants.ts`);
const { fetchPair } = await import(`${REPO}/pairCurve/accounts.ts`);
const { registerSideIx } = await import(`${REPO}/pairCurve/client.ts`);
const nacl = (await import("tweetnacl")).default;

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const pk = (s: string | undefined) => new PublicKey(s!);
const key = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
const cmd = args[0];
const programId = pk(opt("program") ?? "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
const c = new Connection("https://api.devnet.solana.com", "confirmed");
const payer = key(opt("payer")!);

async function run(ixs: TransactionInstruction[], extra: Record<string, unknown>, signers: Keypair[] = []) {
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs] }).compileToLegacyMessage();
  const tx = new VersionedTransaction(msg);
  const sim = await c.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  const out: Record<string, unknown> = { command: `h.mts ${cmd}`, cluster: "devnet", programId: programId.toBase58(), dryRun: !args.includes("--send"), ...extra, simulation: { err: sim.value.err ? JSON.stringify(sim.value.err) : null, unitsConsumed: sim.value.unitsConsumed ?? null, logs: sim.value.logs ?? [] } };
  if (args.includes("--send") && !sim.value.err) {
    tx.sign([payer, ...signers]);
    const sig = await c.sendRawTransaction(tx.serialize());
    await c.confirmTransaction(sig, "confirmed");
    out.sent = { signature: sig };
  }
  console.log(JSON.stringify(out, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2));
}

if (cmd === "init-kind") {
  // initialize_token with an arbitrary EndSink kind (e.g. 2 = LEAGUE_SET), mirroring burnreceipts-admin initialize-token
  const mint = key(opt("mint")!);
  const loaded = loadRules(opt("rules")!);
  const rule = ruleParamsFromKeeperRules(loaded.rules, { floorLamports: BigInt(1_000_000), maxTwapDeviationBps: 300, twapWindowSecs: 1200 });
  const ix = initializeTokenIx({ programId, payer: payer.publicKey, creator: payer.publicKey, mint: mint.publicKey, launchlabPlatform: pk(opt("platform")), layout: "r4",
    endSink: { kind: Number(opt("kind")), ...(opt("sink-mint") ? { sinkMint: pk(opt("sink-mint")) } : {}), minForwardLamports: BigInt(opt("min") ?? "10000000") },
    args: { feed_id: loaded.rules.feed.id, memo_prefix: loaded.rules.memo.prefix, memo_source: loaded.rules.feed.memoSource, rules_sha256: Buffer.from(loaded.sha256, "hex"), rule, attesters: [operatorAttester(pk(opt("attester")))], quorum: 1, fixed_pool: PublicKey.default, admin: payer.publicKey } });
  await run([ix], { endSinkKind: Number(opt("kind")) });
} else if (cmd === "fwd") {
  // forward_on_end with a caller-chosen target (and optional sink_config / pair accounts)
  const mint = pk(opt("mint")), target = pk(opt("target"));
  const pair = opt("pair") ? { partner: pk(opt("pair")!.split(":")[0]), endDate: Number(opt("pair")!.split(":")[1]) } : undefined;
  const tf = feePda(programId, target);
  await run([createAtaIdempotentIx({ payer: payer.publicKey, owner: tf, mint: NATIVE_MINT, ata: associatedTokenAddress(tf, NATIVE_MINT) }), forwardOnEndIx({ programId, cranker: payer.publicKey, mint, target, ...(opt("sink-mint") ? { sinkMint: pk(opt("sink-mint")) } : {}), ...(pair ? { pair } : {}) })], { mint: mint.toBase58(), target: target.toBase58(), sinkMint: opt("sink-mint") ?? null, pair: opt("pair") ?? null });
} else if (cmd === "propose") {
  // propose_attesters with the coin's CURRENT set (a no-op proposal: the only one quorum 1 with fresh keys allows); admin = the payer
  const mint = pk(opt("mint"));
  const cfg = (await fetchTokenConfig(c, programId, mint))!.config;
  const attesters = cfg.attesters.slice(0, cfg.attester_count);
  await run([proposeAttestersIx({ programId, admin: payer.publicKey, mint, attesters, quorum: cfg.quorum })], { mint: mint.toBase58(), attesters: attesters.map((a: { key: PublicKey }) => a.key.toBase58()), quorum: cfg.quorum });
} else if (cmd === "apply-attesters") {
  const mint = pk(opt("mint"));
  await run([applyAttesterChangeIx({ programId, caller: payer.publicKey, mint })], { mint: mint.toBase58() });
} else if (cmd === "apply-paired") {
  // apply_paired_attester_change: the partner's quorum (the keeper key) signs the pair attester-change message over the pending set
  const mint = pk(opt("mint")), partner = pk(opt("partner"));
  const cfg = (await fetchTokenConfig(c, programId, mint))!.config;
  const genesis = await c.getGenesisHash();
  const pending = cfg.pending_attesters.slice(0, cfg.pending_count);
  const setHash = pairSetHash(cfg.pending_quorum, pending);
  const msg = pairAttesterChangeMessage(genesis, programId, mint, partner, setHash, cfg.pending_eta);
  const k = key(opt("attester-key")!);
  const sig = nacl.sign.detached(msg, k.secretKey);
  await run([ed25519SharedMessageInstruction(msg, [{ publicKey: k.publicKey, signature: sig }]), applyPairedAttesterChangeIx({ programId, caller: payer.publicKey, mint, partnerMint: partner })], { mint: mint.toBase58(), partner: partner.toBase58(), pendingEta: String(cfg.pending_eta), message: msg.toString("utf8") });
} else if (cmd === "register-side") {
  // burn_receipts.register_pair_pool for a pair_curve side, whatever the Pair's state
  const pairAddress = pk(opt("pair"));
  const pair = await fetchPair(c, pairAddress);
  const side = opt("side") === "B" ? 1 : 0;
  await run([registerSideIx({ registrar: payer.publicKey, pairAddress, pair, side, cluster: "devnet", burnReceiptsProgramId: programId })], { pair: pairAddress.toBase58(), side: opt("side") });
} else if (cmd !== "init-pair-step3") { console.error("usage: h.mts init-kind|fwd|propose|apply-attesters|apply-paired|register-side …"); process.exit(2); }
if (cmd === "init-pair-step3") {
  // resume paircurve-admin init-pair after its steps 1-2 landed (a 429 killed the process before step 3): init_pair + link_pair
  const crypto = await import("node:crypto");
  const { initPairIx } = await import(`${REPO}/pairCurve/client.ts`);
  const { linkPairIx } = await import(`${REPO}/burnReceipts/pairs.ts`);
  const { pairPda } = await import(`${REPO}/pairCurve/accounts.ts`);
  const { DEFAULT_CURVE_SUPPLY, DEFAULT_VIRTUAL_TOKEN_AMOUNT } = await import(`${REPO}/pairCurve/pricing.ts`);
  const mintA = pk(opt("mint-a")), mintB = pk(opt("mint-b")), platform = pk(opt("platform"));
  const platAcc = (await c.getAccountInfo(platform, "confirmed"))!;
  const cpConfig = new PublicKey(platAcc.data.subarray(688, 720));
  const deadline = Math.floor(Date.now() / 1000) + Number(opt("deadline-secs") ?? 86400);
  const ix = initPairIx({ payer: payer.publicKey, creator: payer.publicKey, mintA, mintB, launchlabPlatform: platform, ammConfig: cpConfig, burnReceiptsProgramId: programId,
    args: { pair_id: Uint8Array.from(crypto.createHash("sha256").update(opt("pair-id")!, "utf8").digest()), virtual_sol_lamports: BigInt(30e9), virtual_token_amount: DEFAULT_VIRTUAL_TOKEN_AMOUNT, curve_supply: DEFAULT_CURVE_SUPPLY, target_raise_lamports: BigInt(Math.round(Number(opt("target-sol")) * 1e9)), min_side_share_bps: Number(opt("share-bps")), deadline: BigInt(deadline) } });
  await run([ix, linkPairIx({ programId, payer: payer.publicKey, pair: pairPda(mintA, mintB), mintA, mintB })], { pair: pairPda(mintA, mintB).toBase58(), deadline });
}
