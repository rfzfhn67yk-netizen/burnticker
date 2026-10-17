// THE PLATFORM-FEE CLAIM (owner, 2026-10-16; /burnticker/operator/claim-fees). The PIN gate (the post queue's), the claim's accounts
// for the mainnet platform against the Raydium SDK's own PDA helpers, the refusal of a wallet that is not the claim wallet, and the
// signing order (dry run before the wallet is asked). Mocked wallets and a fake account reader only; nothing reaches a network.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { PlatformConfig, claimPlatformFeeFromVault, getPdaPlatformFeeVaultAuth, getPdaPlatformVault } from "@raydium-io/raydium-sdk-v2";
import { readPlatformFees, platformFeeClaimIxs, v1OpsPlatformFees, type FeeAccountReader } from "@/lib/burnticker/platformFeeClaim";
import { CLAIM_COPY, pollConfirm, claimIxProblems, claimPlatformFees, claimSentSentence, claimWalletProblem, fundingProblem, LAUNCHLAB_PROGRAMS, neededLamports, solFromLamports, ATA_PROGRAM, TOKEN_PROGRAM, WSOL_MINT, type PlatformFeesView } from "@/lib/burnticker/platformFeeClaimPlan";
import { BURNTICKER_PLATFORM, LAUNCHLAB_PROGRAM_ID, OPERATOR_TREASURY } from "@/lib/burnReceipts/constants";
import { simulationFailureText, type SendDeps } from "@/lib/burnticker/signPlan";
import { lintCopy, loadCopyLintConfig } from "@/lib/launch/copyLint";
import { API, callRoute } from "./burntickerApiHelpers.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cfg = loadCopyLintConfig();
const LL = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"), PLATFORM = new PublicKey("94x5qDDJP4UCkeMWppnmvqTmMgo971h3d6MDRnjEfYy9");
const CLAIM_WALLET = new PublicKey("8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5"), VAULT = "EcXnhWsJmc6vcart32M5ZXMmmCzXE3fiUz9qxqrWQKSn";
const WSOL = new PublicKey(WSOL_MINT), TOKEN = new PublicKey(TOKEN_PROGRAM);
const ENV = { BURNTICKER_OPS_PIN: "1234", BURNTICKER_CLUSTER: "mainnet" };
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

/** A PlatformConfig account with the given claim wallet and fee rate (the SDK's own layout, encoded). */
function platformConfigBytes(claimWallet: PublicKey, feeRate = 2500): Buffer {
  const o = PlatformConfig.decode(Buffer.alloc(PlatformConfig.span)) as unknown as Record<string, unknown>;
  o.platformClaimFeeWallet = claimWallet; o.feeRate = new BN(feeRate);
  const out = Buffer.alloc(PlatformConfig.span); PlatformConfig.encode(o as never, out); return out;
}
/** A token account holding `amount` of `mint`. */
const tokenAccount = (mint: PublicKey, owner: PublicKey, amount: bigint) => { const b = Buffer.alloc(165); mint.toBuffer().copy(b, 0); owner.toBuffer().copy(b, 32); b.writeBigUInt64LE(amount, 64); return b; };
/** A fake reader: platform config, vault, claim wallet SOL, and no ATA yet. */
function reader(claimWallet: PublicKey, o: { vault?: bigint; walletLamports?: number; cluster?: "mainnet" | "devnet" } = {}): FeeAccountReader & { calls: number } {
  const c = o.cluster ?? "mainnet", program = LAUNCHLAB_PROGRAM_ID[c], platform = BURNTICKER_PLATFORM[c];
  const vault = getPdaPlatformVault(program, platform, WSOL).publicKey;
  const accounts = new Map<string, { data: Buffer; lamports: number; owner: PublicKey }>([
    [platform.toBase58(), { data: platformConfigBytes(claimWallet), lamports: 1, owner: program }],
    [vault.toBase58(), { data: tokenAccount(WSOL, getPdaPlatformFeeVaultAuth(program).publicKey, o.vault ?? BigInt(1_770_158_720)), lamports: 1, owner: TOKEN }],
    [claimWallet.toBase58(), { data: Buffer.alloc(0), lamports: o.walletLamports ?? 10_000_000, owner: new PublicKey("11111111111111111111111111111111") }],
  ]);
  const r = { calls: 0, async getMultipleAccountsInfo(keys: PublicKey[]) { r.calls++; return keys.map((k) => accounts.get(k.toBase58()) ?? null); }, async getMinimumBalanceForRentExemption() { return 1_488_440; } };
  return r;
}
const req = (o: { host?: string; pin?: string } = {}) => new Request("http://localhost/api/burnticker/v1/ops/platform-fees", { headers: { host: o.host ?? "localhost", ...(o.pin ? { "x-action-pin": o.pin } : {}) } });

describe("the PIN gate is the post queue's", () => {
  test("refused off the operator's network, with no PIN configured, without the PIN and with a wrong one; nothing is read", async () => {
    const r = reader(CLAIM_WALLET);
    assert.equal((await v1OpsPlatformFees(req({ host: "burnticker.com", pin: "1234" }), ENV, r)).status, 403);
    assert.equal((await v1OpsPlatformFees(req({ pin: "1234" }), { BURNTICKER_CLUSTER: "mainnet" }, r)).status, 503);
    assert.equal((await v1OpsPlatformFees(req(), ENV, r)).status, 401);
    assert.equal((await v1OpsPlatformFees(req({ pin: "nope" }), ENV, r)).status, 401);
    assert.equal(r.calls, 0, "no chain read before the gate passes");
    const okRes = await v1OpsPlatformFees(req({ pin: "1234" }), ENV, r);
    assert.equal(okRes.status, 200);
    assert.equal((okRes.body as PlatformFeesView).vault, VAULT);
  });
  test("the route refuses a request with no PIN, and the page shows only the PIN box until the PIN-gated read answers", async () => {
    assert.equal((await callRoute(`${API}/ops/platform-fees`)).status, 403);
    const page = read("src/app/burnticker/operator/claim-fees/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(page, /return <ClaimFees \/>/);
    assert.doesNotMatch(page, /8cwwy|94x5q|EcXnh|platformFee/i, "the server page carries no fact of its own");
    const c = read("src/app/burnticker/operator/claim-fees/ClaimFees.tsx");
    assert.match(c, /"x-action-pin": p/);
    assert.match(c, /!activePin \? \(/);
    assert.match(c, /\{v && \(/, "the view renders only from the gated read");
    assert.doesNotMatch(c, /localStorage|sessionStorage|document\.cookie/, "the PIN is never stored");
    assert.doesNotMatch(c, /8cwwy|94x5q|EcXnh/, "no address is baked into the client");
  });
  test("the operation is in the OpenAPI document as operator only", () => {
    assert.match(read("src/lib/burnticker/api/featuresSpec.ts"), /operationId: "getOpsPlatformFees".*path: "\/ops\/platform-fees".*errors: \[401, 403, 429, 502, 503\]/);
  });
});

describe("the claim for the mainnet platform matches the SDK's own derivations", () => {
  test("vault, vault authority and recipient", async () => {
    const v = (await v1OpsPlatformFees(req({ pin: "1234" }), ENV, reader(CLAIM_WALLET))).body as PlatformFeesView;
    assert.equal(v.cluster, "mainnet"); assert.equal(v.launchLabProgram, LL.toBase58()); assert.equal(v.platformId, PLATFORM.toBase58());
    assert.equal(v.claimWallet, CLAIM_WALLET.toBase58()); assert.equal(v.claimWalletIsTreasury, true); assert.ok(OPERATOR_TREASURY.mainnet.equals(CLAIM_WALLET));
    assert.equal(v.vault, getPdaPlatformVault(LL, PLATFORM, WSOL).publicKey.toBase58()); assert.equal(v.vault, VAULT);
    assert.equal(v.vaultAuthority, getPdaPlatformFeeVaultAuth(LL).publicKey.toBase58());
    const ata = PublicKey.findProgramAddressSync([CLAIM_WALLET.toBuffer(), TOKEN.toBuffer(), WSOL.toBuffer()], new PublicKey(ATA_PROGRAM))[0];
    assert.equal(v.recipient, ata.toBase58()); assert.equal(v.recipientExists, false);
    assert.equal(v.feeRatePpm, 2500); assert.equal(v.vaultLamports, "1770158720"); assert.equal(v.neededLamports, String(5_000 + 1_488_440), "the rent the chain asks for now");
  });
  test("the three instructions: ATA create, the SDK's claimPlatformFeeFromVault byte for byte, CloseAccount into the claim wallet", () => {
    const [create, claim, close] = platformFeeClaimIxs(LL, PLATFORM, CLAIM_WALLET);
    const ata = PublicKey.findProgramAddressSync([CLAIM_WALLET.toBuffer(), TOKEN.toBuffer(), WSOL.toBuffer()], new PublicKey(ATA_PROGRAM))[0];
    const sdk = claimPlatformFeeFromVault(LL, PLATFORM, CLAIM_WALLET, getPdaPlatformFeeVaultAuth(LL).publicKey, getPdaPlatformVault(LL, PLATFORM, WSOL).publicKey, ata, WSOL, TOKEN);
    assert.equal(claim.programId, LL.toBase58());
    assert.equal(claim.dataBase64, Buffer.from(sdk.data).toString("base64"));
    assert.deepEqual(claim.keys, sdk.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })));
    assert.deepEqual(claim.keys.map((k) => k.pubkey).slice(0, 7), [CLAIM_WALLET.toBase58(), getPdaPlatformFeeVaultAuth(LL).publicKey.toBase58(), PLATFORM.toBase58(), VAULT, ata.toBase58(), WSOL_MINT, TOKEN_PROGRAM]);
    assert.equal(create.programId, ATA_PROGRAM); assert.equal(create.keys[1].pubkey, ata.toBase58());
    assert.equal(close.programId, TOKEN_PROGRAM); assert.deepEqual(close.keys.map((k) => k.pubkey), [ata.toBase58(), CLAIM_WALLET.toBase58(), CLAIM_WALLET.toBase58()]);
  });
  test("the client's check passes the built claim and refuses a changed one", async () => {
    const v = (await v1OpsPlatformFees(req({ pin: "1234" }), ENV, reader(CLAIM_WALLET))).body as PlatformFeesView;
    assert.deepEqual(claimIxProblems(v), []);
    assert.equal(LAUNCHLAB_PROGRAMS.mainnet, LAUNCHLAB_PROGRAM_ID.mainnet.toBase58()); assert.equal(LAUNCHLAB_PROGRAMS.devnet, LAUNCHLAB_PROGRAM_ID.devnet.toBase58());
    const other = Keypair.generate().publicKey.toBase58();
    const withRecipient = structuredClone(v); withRecipient.instructions[1].keys[4].pubkey = other;
    assert.match(claimIxProblems(withRecipient).join(";"), /instruction 2/);
    const withCloseTo = structuredClone(v); withCloseTo.instructions[2].keys[1].pubkey = other;
    assert.match(claimIxProblems(withCloseTo).join(";"), /instruction 3/);
    const extraSigner = structuredClone(v); extraSigner.instructions[0].keys.push({ pubkey: other, isSigner: true, isWritable: false });
    assert.match(claimIxProblems(extraSigner).join(";"), /someone other than the claim wallet/);
    const extraIx = structuredClone(v); extraIx.instructions.push(v.instructions[2]);
    assert.match(claimIxProblems(extraIx).join(";"), /expected 3 instructions/);
  });
});

describe("only the claim wallet can claim", () => {
  test("another wallet gets one sentence and nothing is asked of the chain or the wallet", async () => {
    const v = (await v1OpsPlatformFees(req({ pin: "1234" }), ENV, reader(CLAIM_WALLET))).body as PlatformFeesView;
    const someone = Keypair.generate().publicKey.toBase58();
    const said = claimWalletProblem(someone, v.claimWallet)!;
    assert.match(said, /is not the platform's claim wallet/); assert.equal(said.split(/\.\s/).length, 1, "one sentence");
    assert.equal(claimWalletProblem(v.claimWallet, v.claimWallet), null); assert.equal(claimWalletProblem(null, v.claimWallet), null);
    let touched = 0;
    const deps = new Proxy({} as SendDeps, { get: () => { touched++; return async () => { throw new Error("called"); }; } });
    const r = await claimPlatformFees(v, someone, deps);
    assert.equal(r.error, said); assert.equal(r.state, "not-sent"); assert.equal(touched, 0);
    assert.equal((await claimPlatformFees(v, null, deps)).error, CLAIM_COPY.connect); assert.equal(touched, 0);
    const c = read("src/app/burnticker/operator/claim-fees/ClaimFees.tsx");
    assert.match(c, /: notClaimWallet \? <p[^>]*>\{notClaimWallet\}<\/p>/, "the page shows the sentence in place of the button");
  });
  test("an empty vault and an unfunded claim wallet are said, not offered", async () => {
    const v = (await v1OpsPlatformFees(req({ pin: "1234" }), ENV, reader(CLAIM_WALLET, { vault: BigInt(0), walletLamports: 0 }))).body as PlatformFeesView;
    assert.equal((await claimPlatformFees(v, v.claimWallet, {} as SendDeps)).error, CLAIM_COPY.empty);
    assert.match(fundingProblem(v)!, /holds 0\.000000000 SOL and the claim needs 0\.001493440 SOL/);
    assert.equal(fundingProblem({ claimWalletLamports: String(neededLamports(false)), neededLamports: String(neededLamports(false)) }), null);
  });
});

describe("signing order: dry run first, then the wallet, then the send", () => {
  const kp = Keypair.generate();
  const view = async () => (await v1OpsPlatformFees(req({ pin: "1234" }), ENV, reader(kp.publicKey))).body as PlatformFeesView;
  const runWith = async (simulate: SendDeps["simulate"], wallet?: (tx: VersionedTransaction) => VersionedTransaction) => {
    const order: string[] = [];
    const r = await claimPlatformFees(await view(), kp.publicKey.toBase58(), {
      latestBlockhash: async () => { order.push("blockhash"); return { blockhash: BH, lastValidBlockHeight: 100 }; },
      simulate: async (tx) => { order.push("simulate"); assert.equal(tx.signatures.every((s) => s.every((b) => b === 0)), true, "the dry run sees an unsigned transaction"); return simulate(tx); },
      signTransaction: async (tx) => { order.push("wallet"); const t = wallet ? wallet(tx) : tx; t.sign([kp]); return t; },
      lookupTable: async () => null,
      sendRaw: async () => { order.push("send"); return "sig"; },
      confirm: async () => { order.push("confirm"); return { err: null }; },
      storage: null,
    });
    return { r, order };
  };
  test("a passing dry run: blockhash, dry run, wallet, send, confirm, in that order", async () => {
    const { r, order } = await runWith(async () => null);
    assert.deepEqual(order, ["blockhash", "simulate", "wallet", "send", "confirm"]);
    assert.equal(r.error, null); assert.equal(r.signatures.length, 1);
  });
  test("a failed dry run stops before the wallet is asked; nothing is sent", async () => {
    const { r, order } = await runWith(async () => simulationFailureText({ InstructionError: [1, { Custom: 6000 }] }, ["Program log: Error: nothing to claim"]));
    assert.deepEqual(order, ["blockhash", "simulate"]); assert.equal(r.state, "not-sent"); assert.match(r.error!, /dry run of it failed on chain/);
  });
  test("a dry run the RPC cannot perform also stops before the wallet is asked", async () => {
    const { r, order } = await runWith(async () => { throw new Error("429 Too Many Requests"); });
    assert.deepEqual(order, ["blockhash", "simulate"]); assert.match(r.error!, /could not be run just now/);
  });
  test("the wallet may append Lighthouse checks, but a changed instruction is refused before the send", async () => {
    const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
    const rebuild = (tx: VersionedTransaction, f: (ixs: TransactionInstruction[]) => TransactionInstruction[]) => { const m = TransactionMessage.decompile(tx.message); return new VersionedTransaction(new TransactionMessage({ payerKey: m.payerKey, recentBlockhash: m.recentBlockhash, instructions: f(m.instructions) }).compileToV0Message()); };
    const guarded = await runWith(async () => null, (tx) => rebuild(tx, (ixs) => [...ixs, new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [], data: Buffer.from([9]) })]));
    assert.deepEqual(guarded.order, ["blockhash", "simulate", "wallet", "send", "confirm"]);
    const changed = await runWith(async () => null, (tx) => rebuild(tx, (ixs) => ixs.slice(0, 2)));
    assert.deepEqual(changed.order, ["blockhash", "simulate", "wallet"]); assert.match(changed.r.error!, /changed the transaction's instructions/);
  });
  test("the page wires the dry run with sigVerify false and runs inside the flight token", () => {
    const c = read("src/app/burnticker/operator/claim-fees/ClaimFees.tsx");
    assert.match(c, /simulateTransaction\(tx, \{ sigVerify: false/);
    assert.match(c, /withFlight\(\(\) => claimPlatformFees\(/);
  });
});

describe("confirmation is polled, never subscribed", () => {
  test("confirmed → the chain's result; an expired blockhash with no status → throws (signPlan settles it)", async () => {
    const sleep = async () => {};
    let n = 0;
    assert.deepEqual(await pollConfirm({ status: async () => (++n < 3 ? null : { err: null, confirmationStatus: "confirmed" }), blockHeight: async () => 10 }, "s", 100, { sleep }), { err: null });
    assert.deepEqual(await pollConfirm({ status: async () => ({ err: { InstructionError: [1, "x"] }, confirmationStatus: "processed" }), blockHeight: async () => 10 }, "s", 100, { sleep }), { err: { InstructionError: [1, "x"] } });
    await assert.rejects(pollConfirm({ status: async () => null, blockHeight: async () => 101 }, "s", 100, { sleep }), /expired/);
    assert.doesNotMatch(read("src/app/burnticker/operator/claim-fees/ClaimFees.tsx"), /confirmTransaction\(|\.onSignature\(/);
  });
});

describe("copy", () => {
  test("every sentence passes the copy lint and avoids payout, profit and price", async () => {
    const v = (await v1OpsPlatformFees(req({ pin: "1234" }), ENV, reader(CLAIM_WALLET, { walletLamports: 0 }))).body as PlatformFeesView;
    const texts = [...Object.values(CLAIM_COPY), claimWalletProblem(Keypair.generate().publicKey.toBase58(), v.claimWallet)!, fundingProblem(v)!, claimSentSentence("3nYqLkXrS8aBc")];
    for (const t of texts) { assert.deepEqual(lintCopy(t, cfg).hits, [], t); assert.doesNotMatch(t, /payout|profit|price/i, t); }
    assert.equal(solFromLamports(BigInt(1_770_158_720)), "1.770158720");
  });
});
