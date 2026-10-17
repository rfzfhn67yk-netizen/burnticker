// Keeper-cycle coins made the way the platform makes them: ProgramBurnClient.initializeToken (unit counter, value_decimals 0, the rule's
// onEnd.endSink → a FLAGSHIP EndSink), signed by the r4x payer (creator) and the mint key, then registered (ENDED) in the scratch registry.
import fs from "node:fs";
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
const REPO = "<repo>/src/lib";
const { ProgramBurnClient } = await import(`${REPO}/burnticker/programClient.ts`);
const { openRegistry } = await import(`${REPO}/burnticker/registry.ts`);
const { lockRule, BURNTICKER_RULES_SCHEMA, DEFAULT_ON_END } = await import(`${REPO}/burnticker/rules.ts`);
const key = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
const [db, payerFile, ...specs] = process.argv.slice(2);   // specs: <ticker>:<mintkeyfile>:<reason>
const payer = key(payerFile);
const c = new Connection("https://api.devnet.solana.com", "confirmed");
const programId = new PublicKey("AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM");
const client = new ProgramBurnClient({ connection: c, programId, cluster: "devnet", payer: null, admin: payer.publicKey, solUsd: async () => 150, endSinksLive: true } as never);
const reg = openRegistry(db);
const rule = { schema: BURNTICKER_RULES_SCHEMA, oracle: "catalogue", series: "treasury.debt", market: null, filter: {}, kind: "scalar", scalar: { unit: 1e9, perUnit: { fractionOfPool: 0.01 }, baseline: "previousSettlement", direction: "up" }, binary: null, onVoid: "skip", floorUsd: "1", reserveSol: "0.02", vault: null, onEnd: { ...DEFAULT_ON_END } };
const locked = lockRule(rule);
for (const s of specs) {
  const [ticker, mintFile, reason] = s.split("|");
  const mint = key(mintFile);
  const out = await client.initializeToken({ mint: mint.publicKey.toBase58(), creator: payer.publicKey.toBase58(), ticker, rulesSha256: locked.sha256, selectorKey: "catalogue:treasury.debt", mode: "buyback", attesters: ["D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn"], quorum: 1, vault: null, rule: locked.rule });
  const ixs = out.instructions.map((x: { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; dataBase64: string }) => new TransactionInstruction({ programId: new PublicKey(x.programId), keys: x.keys.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey) })), data: Buffer.from(x.dataBase64, "base64") }));
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToLegacyMessage());
  const sim = await c.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  if (sim.value.err) { console.log(ticker, "SIM ERR", JSON.stringify(sim.value.err), (sim.value.logs ?? []).slice(-6)); continue; }
  tx.sign([payer, mint]);
  const sig = await c.sendRawTransaction(tx.serialize());
  await c.confirmTransaction(sig, "confirmed");
  const feePda = client.feePdaFor(mint.publicKey.toBase58());
  if (!reg.token(mint.publicKey.toBase58())) reg.register({ mint: mint.publicKey.toBase58(), ticker, name: `${ticker} devnet r4 keeper test`, creator: payer.publicKey.toBase58(), description: "devnet-r4 keeper cycle coin (throwaway)", imageUrl: null, links: [], rulesText: locked.text, feePda, vault: null, tokenConfig: out.tokenConfig, poolId: null, launchTx: sig, cluster: "devnet", platformId: "GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf", baselineAt: new Date(Date.now() - 3 * 86400_000).toISOString(), status: "live" });
  reg.markRuleEnded(mint.publicKey.toBase58(), "winddown", reason, Date.now() - 3600_000);
  console.log(JSON.stringify({ ticker, mint: mint.publicKey.toBase58(), tokenConfig: out.tokenConfig, feePda, signature: sig, label: out.instructions[0].label }));
}
reg.close();
