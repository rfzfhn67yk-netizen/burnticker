import { AddressLookupTableAccount, PublicKey, TransactionInstruction, TransactionMessage } from "@solana/web3.js";
import { LOOKUP_TABLES, NETWORKS, type Network } from "@/lib/burnticker/networks";
import { CPMM_CONFIG_ID, CPMM_MAINNET_TIER_9, CPMM_TIER } from "@/lib/burnticker/cpmmTier";

/**
 * THE PER-NETWORK ADDRESS LOOKUP TABLE (re-check 2026-10-11, "known oversized single launch"). A real single-coin launch — burn_receipts
 * initialize_token + the LaunchLab initialize_v2 — is 1,262 bytes as a legacy transaction, over the 1,232-byte packet limit, so the browser
 * builds every launch step as a version-0 transaction whose FIXED accounts (the ones every launch on the network touches) come from one
 * lookup table. Per-launch accounts (the creator, the mint, its PDAs and vaults) stay in the message; signers and invoked program ids stay
 * in the message whatever the table holds (the runtime's rule; web3.js compileToV0Message applies it).
 *
 * The list below is derived from the real bundle builders (test/burntickerLookupTable.test.ts builds every bundle kind twice — single,
 * single + first buy, vault + first buy, the LaunchLab pair, the pair-curve set — and holds every account common to both builds in this
 * list) and the derived addresses are re-derived in that test (event authorities, LaunchLab's authority and platform fee vault, the
 * fee_keys PDA). The ORDER is the table's order: the browser checks that index i of the on-chain table is entry i of this list.
 *
 * The browser never trusts the table blindly: before anything is signed it fetches the table at the pinned address (networks.ts
 * lookupTablePin: the host's BURNTICKER_LOOKUP_TABLE on its own network, else LOOKUP_TABLES, served by GET /api/burnticker/launch so a
 * pin needs no code release), checks it is active, that every entry is at its index, and that its authority is the pinned operations key or none
 * (frozen); otherwise "lookup table mismatch — nothing was sent". The transaction is then compiled against THIS list (the verified
 * prefix), never against whatever else the table holds. Client-safe: web3.js, networks.ts and cpmmTier.ts only.
 *
 * CPMM TIER 14 (owner decision 2026-10-19). Index 10 of the mainnet table is the AmmConfig of 2026-10-12 (tier 9) and the table at
 * 8DZaHFo6… is frozen, so it can neither be changed nor extended. The mainnet list therefore keeps tier 9 at index 10 and appends tier 14
 * (CPMM_TIER.mainnet) at index 21: a NEW table holding these 22 entries is a superset of the old 21, so the code released before it still
 * verifies it (entries past its list are tolerated), and this code refuses the old 21-entry table ("index 21: expected …, found nothing")
 * rather than sign against it. Order: create, freeze and verify the new table and pin it on the host (BURNTICKER_LOOKUP_TABLE) BEFORE
 * this list is published. Without the entry a pair-curve step names tier 14 as a static key: 32 bytes in the message instead of a 1-byte
 * table index, +31 bytes per step that references it.
 */

export interface LookupTableEntry { key: string; what: string }

const COMMON_TAIL: readonly LookupTableEntry[] = [
  { key: "11111111111111111111111111111111", what: "System program" },
  { key: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", what: "SPL Token program" },
  { key: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", what: "Token-2022 program" },
  { key: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", what: "Associated Token program" },
  { key: "SysvarRent111111111111111111111111111111111", what: "Rent sysvar" },
  { key: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", what: "Metaplex Token Metadata program" },
  { key: "So11111111111111111111111111111111111111112", what: "WSOL mint" },
  { key: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", what: "Memo program" },
];

/** The table's entries per network, in table order (21 on devnet; 22 on mainnet since tier 14 was appended). */
export const LOOKUP_TABLE_ENTRIES: Record<Network, readonly LookupTableEntry[]> = {
  devnet: [
    { key: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM", what: "burn_receipts program" },
    { key: "3XsZCTaW8nPykaMubVvYLr1ky87o7shL9NQjYiQP6TeD", what: "burn_receipts event authority PDA" },
    { key: "2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN", what: "pair_curve program" },
    { key: "FWjoUGtyBv3Yd5tSHjBuDx3AzMNE3hGgECcnFZmBQ3qY", what: "pair_curve event authority PDA" },
    { key: "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6", what: "Raydium LaunchLab program (devnet)" },
    { key: "7ZR4zD7PYfY2XxoG1Gxcy2EgEeGYrpxrwzPuwdUBssEt", what: "LaunchLab global config (SOL quote)" },
    { key: "GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf", what: "Burnticker LaunchLab platform config" },
    { key: "5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq", what: "LaunchLab authority PDA" },
    { key: "4uAB7seenFJKPUXqYewAdfra2u6baBgjiXU8x1SC7Ycz", what: "LaunchLab event authority PDA" },
    { key: "AzXYBNjojqRJfPnwASTTrikTWYWcuBW2UYszXFW1QptE", what: "LaunchLab platform fee vault (Burnticker platform, WSOL)" },
    { key: CPMM_CONFIG_ID.devnet, what: "Raydium CPMM AmmConfig (pair curve)" },
    { key: "Bj4XCAoGHy9JTcDtQovijFwpG7NsSG6Snqmf8kFi2Yt3", what: "burn_receipts fee_keys PDA" },
    { key: "A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD", what: "operator treasury (devnet Squads vault)" },
    ...COMMON_TAIL,
  ],
  mainnet: [
    { key: "AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM", what: "burn_receipts program" },
    { key: "3XsZCTaW8nPykaMubVvYLr1ky87o7shL9NQjYiQP6TeD", what: "burn_receipts event authority PDA" },
    { key: "2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN", what: "pair_curve program" },
    { key: "FWjoUGtyBv3Yd5tSHjBuDx3AzMNE3hGgECcnFZmBQ3qY", what: "pair_curve event authority PDA" },
    { key: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", what: "Raydium LaunchLab program" },
    { key: "6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX", what: "LaunchLab global config (SOL quote)" },
    { key: "94x5qDDJP4UCkeMWppnmvqTmMgo971h3d6MDRnjEfYy9", what: "Burnticker LaunchLab platform config" },
    { key: "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh", what: "LaunchLab authority PDA" },
    { key: "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr", what: "LaunchLab event authority PDA" },
    { key: "EcXnhWsJmc6vcart32M5ZXMmmCzXE3fiUz9qxqrWQKSn", what: "LaunchLab platform fee vault (Burnticker platform, WSOL)" },
    { key: CPMM_MAINNET_TIER_9.id, what: "Raydium CPMM AmmConfig tier 9 (coins created before the tier 14 change)" },
    { key: "Bj4XCAoGHy9JTcDtQovijFwpG7NsSG6Snqmf8kFi2Yt3", what: "burn_receipts fee_keys PDA" },
    { key: "8cwwy895BENMJTueXfQovWD4mvuoJ4kgyR52UMrqSbo5", what: "operator treasury" },
    ...COMMON_TAIL,
    { key: CPMM_TIER.mainnet.id, what: "Raydium CPMM AmmConfig tier 14 (new coins, pair curve)" },
  ],
};

export const lookupTableKeys = (network: Network): string[] => LOOKUP_TABLE_ENTRIES[network].map((e) => e.key);

/** What an on-chain table holds (AddressLookupTableAccount.state, or the ops script's decode). */
export interface LookupTableState { authority?: PublicKey | string | null; addresses: (PublicKey | string)[]; deactivationSlot: bigint }
const U64_MAX = BigInt("18446744073709551615");
const b58 = (k: PublicKey | string) => (typeof k === "string" ? k : k.toBase58());

/** The diff of an on-chain table against the expected list: [] = it matches. Entries past the list are tolerated (the table is append-only). */
export function lookupTableProblems(network: Network, address: string, state: LookupTableState | null, pin = LOOKUP_TABLES[network]): string[] {
  const out: string[] = [];
  if (!pin.address) return [`no lookup table is pinned for ${network} (networks.ts LOOKUP_TABLES)`];
  if (address !== pin.address) out.push(`table ${address} is not the pinned ${network} table ${pin.address}`);
  if (!state) return [...out, `table ${address} does not exist on ${network}`];
  if (state.deactivationSlot !== U64_MAX) out.push(`table ${address} is deactivated (slot ${state.deactivationSlot})`);
  const want = lookupTableKeys(network), have = state.addresses.map(b58);
  want.forEach((k, i) => { if (have[i] !== k) out.push(`index ${i}: expected ${k} (${LOOKUP_TABLE_ENTRIES[network][i].what}), found ${have[i] ?? "nothing"}`); });
  const auth = state.authority ? b58(state.authority) : null;
  if (auth !== null && auth !== pin.authority) out.push(`table authority ${auth} is neither the pinned operations key${pin.authority ? ` ${pin.authority}` : ""} nor frozen`);
  return out;
}

export const LOOKUP_TABLE_MISMATCH = "lookup table mismatch — nothing was sent";

/** The network a plan's instructions belong to, read from the network-specific fixed accounts they name; null when none or both match. */
export function planNetwork(instructionSets: readonly { programId: string; keys: readonly { pubkey: string }[] }[][]): Network | null {
  const seen = new Set(instructionSets.flatMap((ixs) => ixs.flatMap((ix) => [ix.programId, ...ix.keys.map((k) => k.pubkey)])));
  const only = (n: Network) => { const other = new Set(NETWORKS.filter((x) => x !== n).flatMap((x) => lookupTableKeys(x))); return lookupTableKeys(n).filter((k) => !other.has(k)); };
  const hits = NETWORKS.filter((n) => only(n).some((k) => seen.has(k)));
  return hits.length === 1 ? hits[0] : null;
}

/** Why a launch on `network` cannot be signed in this browser for lack of a table ([] = a table is pinned). */
export function lookupTablePinProblems(network: Network | null, pin = network ? LOOKUP_TABLES[network] : null): string[] {
  if (!network) return ["the network of this launch could not be read from its instructions, so its lookup table is unknown"];
  return pin?.address ? [] : [`this site has no lookup table pinned for ${network} yet, so a launch cannot be signed here`];
}

/** The reader the browser passes (Connection.getAddressLookupTable). */
export interface LookupTableReader { getAddressLookupTable(key: PublicKey): Promise<{ value: AddressLookupTableAccount | null }> }

/**
 * Fetches the pinned table and verifies it; returns an AddressLookupTableAccount holding EXACTLY the expected list (what the message is
 * compiled against). Throws `lookup table mismatch — nothing was sent (…)` on any difference.
 */
export async function verifiedLookupTable(reader: LookupTableReader, network: Network | null, pin = network ? LOOKUP_TABLES[network] : null): Promise<AddressLookupTableAccount> {
  const pinProblems = lookupTablePinProblems(network, pin);
  if (pinProblems.length || !network || !pin?.address) throw new Error(`${LOOKUP_TABLE_MISMATCH} (${pinProblems.join("; ")})`);
  const address = pin.address;
  let acc: AddressLookupTableAccount | null;
  try { acc = (await reader.getAddressLookupTable(new PublicKey(address))).value; } catch (e) { throw new Error(`${LOOKUP_TABLE_MISMATCH} (the table could not be read: ${String((e as Error)?.message ?? e).slice(0, 80)})`); }
  const problems = lookupTableProblems(network, acc ? acc.key.toBase58() : address, acc ? acc.state : null, pin);
  if (problems.length) throw new Error(`${LOOKUP_TABLE_MISMATCH} (${problems.slice(0, 3).join("; ")}${problems.length > 3 ? `; +${problems.length - 3} more` : ""})`);
  return new AddressLookupTableAccount({ key: acc!.key, state: { ...acc!.state, addresses: lookupTableKeys(network).map((k) => new PublicKey(k)) } });
}

/** The expected table as an account (no network read): what a step is measured against before anything is signed. */
export const expectedLookupTable = (network: Network, key: PublicKey = PublicKey.default): AddressLookupTableAccount =>
  new AddressLookupTableAccount({ key, state: { deactivationSlot: U64_MAX, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: lookupTableKeys(network).map((k) => new PublicKey(k)) } });

const PACKET = 1_232;
/** One step's wire size as a version-0 transaction against the network's table (signatures are fixed-width); null = it does not even compile within the packet buffer. */
export function v0WireSize(instructions: readonly { programId: string; keys: readonly { pubkey: string; isSigner: boolean; isWritable: boolean }[]; dataBase64: string }[], payer: string, network: Network): number | null {
  try {
    const ixs = instructions.map((ix) => new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: Buffer.from(ix.dataBase64, "base64") }));
    const msg = new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: PublicKey.default.toBase58(), instructions: ixs }).compileToV0Message([expectedLookupTable(network)]);
    const n = msg.header.numRequiredSignatures;
    return (n < 128 ? 1 : 2) + 64 * n + msg.serialize().length;
  } catch { return null; }
}

/**
 * Steps that cannot be sent as one transaction even with the table, measured before anything is signed (re-check 2026-10-11: a LaunchLab
 * create WITH the creator's opening purchase is 1,281 bytes as v0 + the table — the purchase's wrap / account / close instructions do not
 * fit beside initialize_token and initialize_v2). Since launch-10 (2026-10-12) the site never builds that shape (hostedLaunch.ts: no
 * opening purchase), and since 2026-10-15 a single coin's initialize_token and create are separate steps, so this is the backstop for
 * anything else that grows past the limit. [] = every step fits.
 */
export function planSizeProblems(steps: readonly { label: string; instructions: Parameters<typeof v0WireSize>[0] }[], payer: string | null, network: Network | null): string[] {
  if (!payer || !network) return [];
  const out: string[] = [];
  steps.forEach((st, i) => {
    const size = v0WireSize(st.instructions, payer, network);
    if (size === null || size > PACKET) out.push(`step ${i + 1} of ${steps.length} is ${size === null ? "more than 1,232" : size.toLocaleString("en-US")} bytes even with the lookup table, over the 1,232-byte limit, so it cannot be sent as one transaction`);
  });
  return out;
}
