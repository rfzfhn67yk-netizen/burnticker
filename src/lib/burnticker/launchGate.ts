/**
 * THE POST-CREATION LAUNCH GATE (2026-10-10, "nothing about a coin can change after launch"): after LaunchLab creates the mint, the
 * launch evidence must show
 *   is_mutable === false          the Metaplex metadata (name, symbol, URI) can never change on chain
 *   mintAuthority === null        no one can mint more
 *   freezeAuthority === null      no one can freeze a holder
 *   uri on Arweave                the metadata behind the URI is content-addressed (pin.ts), not a server we run — unless the
 *                                 devnet-script escape hatch BURNTICKER_ALLOW_HOSTED_METADATA is on, which the evidence then says.
 * scripts/burnkeeper-launch.mts reads the accounts and records this; any failed check is a failed launch gate.
 */

export interface MetadataView { name: string; symbol: string; uri: string; isMutable: boolean; primarySaleHappened: boolean }

/** Decodes the fields of a Metaplex Token Metadata account the gate needs (borsh: key, update authority, mint, data, …, is_mutable). */
export function decodeMetadataAccount(data: Uint8Array): MetadataView {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 1 + 32 + 32; // key, update_authority, mint
  const str = (): string => { const n = dv.getUint32(o, true); o += 4; const s = new TextDecoder().decode(data.subarray(o, o + n)); o += n; return s.replace(/\0+$/, ""); };
  const name = str(), symbol = str(), uri = str();
  o += 2; // seller_fee_basis_points
  const hasCreators = data[o]; o += 1;
  if (hasCreators === 1) { const n = dv.getUint32(o, true); o += 4 + n * 34; }
  const primarySaleHappened = data[o] === 1; o += 1;
  const isMutable = data[o] === 1;
  return { name, symbol, uri, isMutable, primarySaleHappened };
}

export const PINNED_URI_RE = /^https:\/\/(arweave\.net|devnet\.irys\.xyz|gateway\.irys\.xyz)\/[A-Za-z0-9_-]{32,64}$/;

export interface GateCheck { id: "is_mutable" | "mint_authority" | "freeze_authority" | "uri_pinned"; ok: boolean; detail: string }
export function launchGate(o: { metadata: MetadataView; mintAuthority: string | null; freezeAuthority: string | null; allowHosted?: boolean }): { ok: boolean; checks: GateCheck[] } {
  const pinned = PINNED_URI_RE.test(o.metadata.uri);
  const checks: GateCheck[] = [
    { id: "is_mutable", ok: o.metadata.isMutable === false, detail: `is_mutable = ${o.metadata.isMutable}` },
    { id: "mint_authority", ok: o.mintAuthority === null, detail: `mintAuthority = ${o.mintAuthority ?? "null"}` },
    { id: "freeze_authority", ok: o.freezeAuthority === null, detail: `freezeAuthority = ${o.freezeAuthority ?? "null"}` },
    { id: "uri_pinned", ok: pinned || !!o.allowHosted, detail: pinned ? `uri ${o.metadata.uri} (Arweave)` : o.allowHosted ? `uri ${o.metadata.uri} is HOSTED (BURNTICKER_ALLOW_HOSTED_METADATA — devnet scripts only)` : `uri ${o.metadata.uri} is not an Arweave URL` },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
