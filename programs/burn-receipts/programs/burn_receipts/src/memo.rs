//! The canonical burn memo, written by the program itself (Memo program CPI) in the same instruction as the burn. Byte-for-byte the
//! keeper's format (src/lib/burnKeeper/memo.ts on the keeper branch; mirrored in src/lib/burnReceipts/memo.ts here):
//!
//!   v1 (vault):   DEBT|2026-10-08|src=…|prev=…|now=…|delta=…|units=21|burn=2100000[|short=600000]|rules=sha256:<12>|v1
//!   v2 (buyback): DEBT|2026-10-08|src=…|prev=…|now=…|delta=…|units=21|pool=…|spent=…|got=…|burn=…|swap=…|rules=sha256:<12>|v2
//!
//! ON-CHAIN v2 `swap=`: the keeper links its two transactions with the first 12 characters of the swap signature. Here the swap and
//! the burn are ONE instruction, which cannot know its own transaction signature, so `swap=` carries the first 12 base58 characters
//! of the CPMM pool address the swap executed on (same 12-character base58 shape, so the keeper's parser accepts it), or `none` when
//! nothing was bought. The transaction that carries the memo is itself the swap.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::constants::{MEMO_MAX_BYTES, MEMO_PROGRAM_ID};
use crate::error::BurnError;
use crate::math::{format_date, format_fixed, format_signed_fixed, hex12, raw_to_tokens};

pub struct MemoHead<'a> {
    pub prefix: &'a str,
    pub record_date: u32,
    pub source: &'a str,
    pub prev: u64,
    pub now: u64,
    pub delta: i64,
    pub value_decimals: u8,
    pub units: u64,
    pub rules_sha256: &'a [u8; 32],
}

fn head(h: &MemoHead) -> String {
    format!(
        "{}|{}|src={}|prev={}|now={}|delta={}|units={}",
        h.prefix,
        format_date(h.record_date),
        h.source,
        format_fixed(h.prev as u128, h.value_decimals, false),
        format_fixed(h.now as u128, h.value_decimals, false),
        format_signed_fixed(h.delta, h.value_decimals),
        h.units
    )
}

pub fn format_v1(h: &MemoHead, burn_raw: u64, short_raw: u64, decimals: u8) -> String {
    let short = if short_raw > 0 { format!("|short={}", raw_to_tokens(short_raw, decimals)) } else { String::new() };
    format!("{}|burn={}{}|rules=sha256:{}|v1", head(h), raw_to_tokens(burn_raw, decimals), short, hex12(h.rules_sha256))
}

pub fn format_v2(h: &MemoHead, pool: u64, spent: u64, got_raw: u64, burn_raw: u64, swap_ref: &str, decimals: u8) -> String {
    format!(
        "{}|pool={}|spent={}|got={}|burn={}|swap={}|rules=sha256:{}|v2",
        head(h),
        pool,
        spent,
        raw_to_tokens(got_raw, decimals),
        raw_to_tokens(burn_raw, decimals),
        swap_ref,
        hex12(h.rules_sha256)
    )
}

/// `swap=` for a buyback that traded on `pool`.
pub fn swap_ref(pool: &Pubkey) -> String {
    pool.to_string().chars().take(12).collect()
}

/// The LP-fee claim receipt line (LAUNCHPAD-PATH §35), written by claim_lock_fees in the same instruction as the split and the burn:
///   DEBT|lockfees|wsol=<lamports claimed>|burnpool=<to the fee PDA>|operator=<this claim's operator share>|paid=<delivered to the
///   treasury now, incl. earlier pending>|pending=<still parked in the FeeKeyRecord>|burned=<raw tokens burned>|nft=<12>|v2
/// `nft=` carries the first 12 base58 characters of the Fee Key NFT mint. lp-lock blind review I-5: v2 adds paid/pending; v1 (without
/// them) was written by the 2026-10-10 devnet build.
#[allow(clippy::too_many_arguments)]
pub fn format_lock_fees(prefix: &str, wsol: u64, burn_pool: u64, operator: u64, paid: u64, pending: u64, burned_raw: u64, fee_nft_mint: &Pubkey) -> String {
    let nft = fee_nft_mint.to_string();
    format!(
        "{prefix}|lockfees|wsol={wsol}|burnpool={burn_pool}|operator={operator}|paid={paid}|pending={pending}|burned={burned_raw}|nft={}|v2",
        &nft[..12.min(nft.len())]
    )
}

/// LAUNCHPAD-PATH §40 forward receipt: `<PREFIX>|forward|from=<loser mint 12>|to=<winner mint 12>|period=<YYYY-MM-DD>|lamports=N|v1`.
pub fn format_forward(prefix: &str, from: &Pubkey, to: &Pubkey, record_date: u32, lamports: u64) -> String {
    let (f, t) = (from.to_string(), to.to_string());
    format!(
        "{prefix}|forward|from={}|to={}|period={}|lamports={lamports}|v1",
        &f[..12.min(f.len())],
        &t[..12.min(t.len())],
        crate::math::format_date(record_date)
    )
}

/// LAUNCHPAD-PATH §45 end-sink receipt: `<PREFIX>|endfwd|to=<sink mint 12>|lamports=N|v1`.
pub fn format_end_forward(prefix: &str, to: &Pubkey, lamports: u64) -> String {
    let t = to.to_string();
    format!("{prefix}|endfwd|to={}|lamports={lamports}|v1", &t[..12.min(t.len())])
}

pub fn emit_memo<'info>(memo_program: &AccountInfo<'info>, memo: &str) -> Result<()> {
    require_keys_eq!(*memo_program.key, MEMO_PROGRAM_ID, BurnError::InvalidMemoProgram);
    require!(memo.len() <= MEMO_MAX_BYTES, BurnError::MemoTooLong);
    let ix = Instruction { program_id: MEMO_PROGRAM_ID, accounts: vec![], data: memo.as_bytes().to_vec() };
    anchor_lang::solana_program::program::invoke(&ix, std::slice::from_ref(memo_program)).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(rules: &[u8; 32]) -> MemoHead<'_> {
        MemoHead {
            prefix: "DEBT",
            record_date: 20261008,
            source: "fiscaldata.treasury.gov debt_to_penny",
            prev: 4_028_403_614_736_719,
            now: 4_030_531_621_082_972,
            delta: 2_128_006_346_253,
            value_decimals: 2,
            units: 21,
            rules_sha256: rules,
        }
    }

    #[test]
    fn spec_example_v1() {
        let mut r = [0u8; 32];
        r[..6].copy_from_slice(&[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
        assert_eq!(
            format_v1(&h(&r), 2_100_000_000_000, 0, 6),
            "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|burn=2100000|rules=sha256:123456789abc|v1"
        );
        assert_eq!(
            format_v1(&h(&r), 1_500_000_000_000, 600_000_000_000, 6),
            "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|burn=1500000|short=600000|rules=sha256:123456789abc|v1"
        );
    }

    #[test]
    fn v2_shape() {
        let r = [0xffu8; 32];
        let m = format_v2(&h(&r), 1_000_000_000, 659_438_374, 123_450_000, 123_450_000, "CPMMoo8L3F4N", 6);
        assert_eq!(
            m,
            "DEBT|2026-10-08|src=fiscaldata.treasury.gov debt_to_penny|prev=40284036147367.19|now=40305316210829.72|delta=21280063462.53|units=21|pool=1000000000|spent=659438374|got=123.45|burn=123.45|swap=CPMMoo8L3F4N|rules=sha256:ffffffffffff|v2"
        );
        assert!(m.len() <= MEMO_MAX_BYTES);
    }
}
