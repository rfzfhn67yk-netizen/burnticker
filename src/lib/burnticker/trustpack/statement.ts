import { b58decode, b58encode } from "@/lib/burnticker/trustpack/base58";

/**
 * THE OPERATOR STATEMENT'S TEXT AND CHECK, PURE (owner, 2026-10-18). One copy of the rules that scripts/burnticker-sign-statement.mts and
 * the operator's signing page (/burnticker/operator/sign-statement) both use, so the text the page shows and the text the script prints
 * can never differ. No Node module and no environment value: the page's browser half imports it too.
 *
 *   template   operator.json signedMessage.message. While unsigned it holds {DATE}; once signed, the date the script wrote (the status
 *              line) stands where {DATE} was, and the template is that message with the date put back to {DATE} (it must appear
 *              exactly once, or there is no template and signing again means restoring {DATE} by hand).
 *   text       the template with {PUBKEY} = the signer wallet and {DATE} = the chosen day (YYYY-MM-DD).
 *   check      ed25519 over the raw UTF-8 text, or over the text wrapped as a Solana off-chain message (formats 0, 1, 2), in that order.
 *              operator.ts#statementSignatureFormat (Node) and statementSignatureFormatInBrowser (Web Crypto) walk the same list.
 */

export const STATEMENT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD that names a real calendar day. */
export function isStatementDate(s: unknown): s is string {
  if (typeof s !== "string" || !STATEMENT_DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Today in UTC as YYYY-MM-DD (the page's default day). */
export const todayUtc = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

export type StatementTemplate = { template: string; signedOn: string | null } | { problem: string };

/** The template from operator.json's signedMessage: the message itself while it holds {DATE}, or the signed message with its date put back. */
export function statementTemplate(sm: { status: string; message: string }): StatementTemplate {
  if (sm.message.includes("{DATE}")) return { template: sm.message, signedOn: null };
  if (!isStatementDate(sm.status)) return { problem: "The statement in operator.json has no {DATE} and its status is not a signing day, so the text to sign cannot be rebuilt. Put {DATE} back in the message first." };
  const parts = sm.message.split(sm.status);
  if (parts.length !== 2) return { problem: `The statement in operator.json names its signing day ${parts.length - 1} times, so the text to sign cannot be rebuilt. Put {DATE} back in the message first.` };
  return { template: parts.join("{DATE}"), signedOn: sm.status };
}

/** The exact text to sign: {PUBKEY} = the signer wallet, {DATE} = the day. */
export const statementText = (template: string, signer: string, date: string): string => template.replace("{PUBKEY}", signer).replace("{DATE}", date);

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * A Solana off-chain message, version 0, as `solana sign-offchain-message` and a Ledger sign it: "\xffsolana offchain", the version
 * byte 0, a format byte (0 restricted ASCII, 1 limited UTF-8, 2 extended UTF-8), the length as u16 little-endian, then the text.
 */
export function offchainMessageBytes(message: string, format: 0 | 1 | 2): Uint8Array {
  const text = utf8(message), head = utf8("solana offchain");
  const out = new Uint8Array(1 + head.length + 4 + text.length);
  out[0] = 0xff; out.set(head, 1);
  let i = 1 + head.length;
  out[i++] = 0; out[i++] = format; out[i++] = text.length & 0xff; out[i++] = (text.length >> 8) & 0xff;
  out.set(text, i);
  return out;
}

/** The byte strings a valid statement signature may cover, in the order the check tries them. */
export function statementSignedForms(message: string): { format: "raw" | "offchain"; bytes: Uint8Array }[] {
  const raw = utf8(message);
  const out: { format: "raw" | "offchain"; bytes: Uint8Array }[] = [{ format: "raw", bytes: raw }];
  if (raw.length <= 0xffff) for (const f of [0, 1, 2] as const) out.push({ format: "offchain", bytes: offchainMessageBytes(message, f) });
  return out;
}

/** The ed25519 check in the browser (Web Crypto); false, never a throw, on a malformed key or signature. */
export async function verifyEd25519InBrowser(bytes: Uint8Array, signatureB58: string, pubkeyB58: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<boolean> {
  const sig = b58decode(signatureB58), pk = b58decode(pubkeyB58);
  if (!sig || sig.length !== 64 || !pk || pk.length !== 32) return false;
  try {
    const key = await subtle.importKey("raw", pk as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await subtle.verify({ name: "Ed25519" }, key, sig as BufferSource, bytes as BufferSource);
  } catch { return false; }
}

/** statementSignatureFormat with Web Crypto: "raw", "offchain", or null when neither verifies. */
export async function statementSignatureFormatInBrowser(message: string, signatureB58: string, pubkeyB58: string, subtle?: SubtleCrypto): Promise<"raw" | "offchain" | null> {
  for (const f of statementSignedForms(message)) if (await verifyEd25519InBrowser(f.bytes, signatureB58, pubkeyB58, subtle)) return f.format;
  return null;
}

/** What the signing page reads (GET /api/burnticker/v1/ops/statement-text, operator only). */
export interface StatementTextView {
  cluster: "devnet" | "mainnet"; signerRole: string; signer: string; date: string; text: string;
  /** the day the statement in operator.json is signed for, or null while it is a template */
  signedOn: string | null;
}

/** The two commands the owner runs from the repository after signing (shown as text, never run by the page). */
export function statementCommands(date: string, signatureB58: string): string[] {
  const node = "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs";
  return [
    `${node} scripts/burnticker-sign-statement.mts --date ${date} --signature ${signatureB58} --write`,
    `${node} scripts/burnticker-trustpack.mts well-known --write`,
  ];
}

export const SIGN_STATEMENT_COPY = {
  title: "Sign the operator statement",
  intro: "The operator's page for signing the operator statement with a browser wallet. The page sends nothing anywhere and keeps nothing.",
  pin: "Ops PIN",
  open: "Open",
  pinNote: "The PIN stays in this page's memory only. A reload forgets it.",
  date: "Day written into the statement (UTC)",
  connect: "Connect the signer wallet to sign.",
  button: "Sign with this wallet",
  busy: "Waiting for the wallet",
  noSignMessage: "This wallet cannot sign a message. Use a wallet that can, such as Phantom.",
  resign: "The statement in operator.json is already signed. Signing again and running the first command replaces that signature.",
  valid: "The signature checks out in this browser against the signer wallet.",
  invalid: "The signature does not check out against the signer wallet. Do not use it.",
  next: "Then run these from the repository, in order. This page runs nothing.",
  copy: "Copy",
  copied: "Copied",
} as const;

/** One sentence when the connected wallet is not the signer named in the text; null when it is, or when no wallet is connected. */
export function wrongSignerProblem(connected: string | null, signer: string): string | null {
  return connected && connected !== signer ? `The connected wallet ${connected} is not the signer wallet ${signer} named in the statement, so nothing was signed.` : null;
}

export type SignStatementResult = { ok: true; signature: string; format: "raw" | "offchain" | null } | { ok: false; error: string };

/**
 * Signs the exact text with the connected wallet's signMessage and checks the result. Refuses before the wallet is asked when the
 * wallet is not the signer. Sends nothing and stores nothing.
 */
export async function signStatement(view: Pick<StatementTextView, "signer" | "text">, connected: string | null, signMessage: ((bytes: Uint8Array) => Promise<Uint8Array>) | undefined, subtle?: SubtleCrypto): Promise<SignStatementResult> {
  if (!connected) return { ok: false, error: SIGN_STATEMENT_COPY.connect };
  const wrong = wrongSignerProblem(connected, view.signer);
  if (wrong) return { ok: false, error: wrong };
  if (!signMessage) return { ok: false, error: SIGN_STATEMENT_COPY.noSignMessage };
  const sig = await signMessage(utf8(view.text));
  if (!(sig instanceof Uint8Array) || sig.length !== 64) return { ok: false, error: "The wallet did not return a 64-byte signature." };
  const signature = b58encode(sig);
  return { ok: true, signature, format: await statementSignatureFormatInBrowser(view.text, signature, view.signer, subtle) };
}
