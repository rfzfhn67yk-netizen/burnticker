//! Attested readings: ed25519 signatures checked by the native Ed25519 program and read back through instruction introspection.
//!
//! The transaction carries one or more Ed25519SigVerify instructions (any position) followed by `submit_reading`. The runtime
//! refuses the whole transaction if any signature in them is invalid, so by the time `submit_reading` runs every (pubkey, message)
//! pair in those instructions is a VERIFIED signature. This module reads the pairs back from the instructions sysvar and counts the
//! distinct attesters that signed exactly the canonical message.
//!
//! The classic pitfall is offsets that point into ANOTHER instruction: the Ed25519 program then verifies bytes somewhere else while
//! a naive reader parses the ed25519 instruction's own data. So every offset triple must reference the ed25519 instruction itself
//! (instruction index u16::MAX, the convention of @solana/web3.js, or its own position); anything else is refused.

use anchor_lang::prelude::*;
use solana_instructions_sysvar::load_instruction_at_checked;

use crate::constants::*;
use crate::error::BurnError;
use crate::math::{format_date, format_fixed};
use crate::state::AttesterEntry;

/// The signed bytes (v3, review M-3 + L-1 + review-2 F12):
///
///   BURNRECEIPTS-v3|<cluster genesis hash>|<program id>|<mint>|<feed_id>|prev=<YYYY-MM-DD of the previous reading, or "none">|<YYYY-MM-DD>|<value>|src=<64 hex>|proof=<64 hex>
///
/// Binding the cluster's genesis hash (CLUSTER_GENESIS_HASH, fixed per build), the program id and the mint makes a signature useless
/// on any other cluster, token or deployment (attester signatures are public in every submit_reading transaction); binding the
/// previous reading's date fixes the order — a signed reading can only follow the reading its signers saw, so pre-signed readings
/// cannot be reordered or skipped.
///
/// Every attester signs the SAME bytes, so the client packs ONE copy of the message and N (pubkey, signature) entries whose message
/// offsets all point at it (review-2 F4; attested_mask accepts any layout whose offsets stay inside the ed25519 instruction).
#[allow(clippy::too_many_arguments)]
pub fn canonical_message(
    program_id: &Pubkey,
    mint: &Pubkey,
    feed_id: &str,
    prev_date: u32,
    record_date: u32,
    value: u64,
    value_decimals: u8,
    source_url_hash: &[u8; 32],
    proof_hash: &[u8; 32],
) -> String {
    let prev = if prev_date == 0 { String::from("none") } else { format_date(prev_date) };
    format!(
        "{}|{}|{}|{}|{}|prev={}|{}|{}|src={}|proof={}",
        ATTESTATION_DOMAIN,
        CLUSTER_GENESIS_HASH,
        program_id,
        mint,
        feed_id,
        prev,
        format_date(record_date),
        format_fixed(value as u128, value_decimals, false),
        hex(source_url_hash),
        hex(proof_hash)
    )
}

/// LAUNCHPAD-PATH §40 — the signed bytes of a pair result (one period, both coins):
///
///   BURNRECEIPTS-PAIR-v1|<cluster genesis hash>|<program id>|<mint_lo>|<mint_hi>|<YYYY-MM-DD>|winner=<mint or "draw">|src=<64 hex>|proof=<64 hex>
///
/// mint_lo < mint_hi in byte order. A quorum of EACH coin's attester set must sign these exact bytes.
#[allow(clippy::too_many_arguments)]
pub fn canonical_pair_message(program_id: &Pubkey, mint_lo: &Pubkey, mint_hi: &Pubkey, record_date: u32, winner: &Pubkey, source_url_hash: &[u8; 32], proof_hash: &[u8; 32]) -> String {
    let w = if *winner == Pubkey::default() { String::from("draw") } else { winner.to_string() };
    format!(
        "{}|{}|{}|{}|{}|{}|winner={}|src={}|proof={}",
        PAIR_ATTESTATION_DOMAIN,
        CLUSTER_GENESIS_HASH,
        program_id,
        mint_lo,
        mint_hi,
        format_date(record_date),
        w,
        hex(source_url_hash),
        hex(proof_hash)
    )
}

/// Pair-forward r3 M-1: what the PARTNER's quorum signs to let a paired coin apply its pending attester change —
/// `BURNRECEIPTS-PAIR-ATTESTER-CHANGE-v1|<genesis>|<program>|<mint>|<partner mint>|set=<hex sha256 of the pending set>|eta=<unix>`,
/// the set hash being pair::set_hash(pending_quorum, pending attesters) (the same form as PairLink.attester_set_hash).
pub fn canonical_pair_attester_change_message(program_id: &Pubkey, mint: &Pubkey, partner_mint: &Pubkey, pending_set_hash: &[u8; 32], eta: i64) -> String {
    format!(
        "{}|{}|{}|{}|{}|set={}|eta={}",
        PAIR_ATTESTER_CHANGE_DOMAIN,
        CLUSTER_GENESIS_HASH,
        program_id,
        mint,
        partner_mint,
        hex(pending_set_hash),
        eta
    )
}

/// LAUNCHPAD-PATH §45: what a quorum of the coin's attesters signs to end its rule —
/// `BURNRECEIPTS-END-v1|<genesis>|<program>|<mint>|<YYYY-MM-DD>|outcome=resolved|void|src=<64hex>|proof=<64hex>`.
pub fn canonical_end_message(program_id: &Pubkey, mint: &Pubkey, record_date: u32, outcome: u8, source_url_hash: &[u8; 32], proof_hash: &[u8; 32]) -> String {
    let o = if outcome == END_STATE_RESOLVED { "resolved" } else { "void" };
    format!(
        "{}|{}|{}|{}|{}|outcome={}|src={}|proof={}",
        END_ATTESTATION_DOMAIN,
        CLUSTER_GENESIS_HASH,
        program_id,
        mint,
        format_date(record_date),
        o,
        hex(source_url_hash),
        hex(proof_hash)
    )
}

fn hex(b: &[u8; 32]) -> String {
    let mut s = String::with_capacity(64);
    for x in b {
        s.push_str(&format!("{:02x}", x));
    }
    s
}

const SIG_OFFSETS_START: usize = 2;
const SIG_OFFSETS_LEN: usize = 14;
const PUBKEY_LEN: usize = 32;
const SIG_LEN: usize = 64;

fn rd_u16(d: &[u8], at: usize) -> Result<u16> {
    let b = d.get(at..at + 2).ok_or(BurnError::BadEd25519Instruction)?;
    Ok(u16::from_le_bytes([b[0], b[1]]))
}

/// Returns the bitmask of attester slots whose key signed `expected` (bit i = attesters[i]); a key signing twice counts once.
pub fn attested_mask(ix_sysvar: &AccountInfo, expected: &[u8], attesters: &[AttesterEntry]) -> Result<u8> {
    let count = {
        let data = ix_sysvar.try_borrow_data()?;
        require!(data.len() >= 2, BurnError::BadEd25519Instruction);
        u16::from_le_bytes([data[0], data[1]]) as usize
    };
    let mut mask = 0u8;
    for index in 0..count {
        let ix = load_instruction_at_checked(index, ix_sysvar)?;
        if ix.program_id != ED25519_PROGRAM_ID {
            continue;
        }
        let d = &ix.data;
        require!(d.len() >= SIG_OFFSETS_START, BurnError::BadEd25519Instruction);
        let n = d[0] as usize;
        for s in 0..n {
            let base = SIG_OFFSETS_START + s * SIG_OFFSETS_LEN;
            let sig_off = rd_u16(d, base)? as usize;
            let sig_ix = rd_u16(d, base + 2)?;
            let pk_off = rd_u16(d, base + 4)? as usize;
            let pk_ix = rd_u16(d, base + 6)?;
            let msg_off = rd_u16(d, base + 8)? as usize;
            let msg_len = rd_u16(d, base + 10)? as usize;
            let msg_ix = rd_u16(d, base + 12)?;
            let own = |i: u16| i == u16::MAX || i as usize == index;
            require!(own(sig_ix) && own(pk_ix) && own(msg_ix), BurnError::BadEd25519Instruction);
            require!(d.get(sig_off..sig_off + SIG_LEN).is_some(), BurnError::BadEd25519Instruction);
            let pk = d.get(pk_off..pk_off + PUBKEY_LEN).ok_or(BurnError::BadEd25519Instruction)?;
            let msg = d.get(msg_off..msg_off + msg_len).ok_or(BurnError::BadEd25519Instruction)?;
            if msg != expected {
                continue;
            }
            if let Some(slot) = attesters.iter().position(|a| a.key.as_ref() == pk) {
                mask |= 1u8 << slot;
            }
        }
    }
    Ok(mask)
}
