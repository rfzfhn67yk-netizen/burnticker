//! The curve, the fee split and the graduation arithmetic — pure functions, u128 inside, no floating point.
//!
//! Path independence: the lamports a side's curve holds are a FUNCTION of the tokens it has sold,
//!     F(sold) = ceil(V_s · sold / (V_t − sold)),
//! (the constant-product curve (V_s + sol)(V_t − sold) = V_s · V_t solved for sol, rounded up). A buy moves `sold` up and charges
//! exactly the difference of F; a sell moves it down and pays exactly the difference. So after any sequence of trades the side holds
//! exactly F(sold): the vault can never gain a lamport to rounding (nothing is stranded) or lose one (nothing is owed that is not
//! there), and when every token is sold back the side holds F(0) = 0. The TS mirror is src/lib/pairCurve/pricing.ts.

use crate::constants::*;
use crate::error::PairError;
use anchor_lang::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CurveParams {
    pub virtual_sol: u64,
    pub virtual_token: u64,
    pub curve_supply: u64,
}

/// F(sold): lamports held by a side's curve after `sold` raw tokens left it. Requires sold ≤ curve_supply < virtual_token.
pub fn sol_at(p: &CurveParams, sold: u64) -> Result<u64> {
    require!(sold <= p.curve_supply && p.curve_supply < p.virtual_token, PairError::MathOverflow);
    let num = (p.virtual_sol as u128).checked_mul(sold as u128).ok_or(PairError::MathOverflow)?;
    let den = (p.virtual_token - sold) as u128;
    let v = num.div_ceil(den);
    u64::try_from(v).map_err(|_| error!(PairError::MathOverflow))
}

/// The largest `sold` (≤ curve_supply) with F(sold) ≤ sigma. Exact: ceil(x) ≤ σ ⇔ x ≤ σ for an integer σ, and
/// V_s·s/(V_t − s) ≤ σ ⇔ s ≤ σ·V_t/(V_s + σ).
pub fn sold_for_sol(p: &CurveParams, sigma: u128) -> Result<u64> {
    let num = sigma.checked_mul(p.virtual_token as u128).ok_or(PairError::MathOverflow)?;
    let den = (p.virtual_sol as u128).checked_add(sigma).ok_or(PairError::MathOverflow)?;
    let s = num / den;
    Ok(s.min(p.curve_supply as u128) as u64)
}

/// The 100 bps fee on `x` lamports (rounded down) and its split: dev = floor(fee × 25 / 100), burn = fee − dev.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct FeeSplit {
    pub fee: u64,
    pub dev: u64,
    pub burn: u64,
}

pub fn fee_split(x: u64) -> FeeSplit {
    let fee = ((x as u128 * FEE_BPS as u128) / BPS_DENOMINATOR as u128) as u64;
    let dev = ((fee as u128 * DEV_FEE_BPS as u128) / FEE_BPS as u128) as u64;
    FeeSplit { fee, dev, burn: fee - dev }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuyQuote {
    pub tokens_out: u64,
    /// F(sold + tokens_out) − F(sold): what the curve (the SOL vault) receives.
    pub cost: u64,
    pub fees: FeeSplit,
    /// cost + fee — never more than the buyer's max_lamports_in.
    pub total: u64,
    pub sold_after: u64,
    pub sol_after: u64,
}

/// The largest net budget N with N + fee(N) ≤ max_in (fee rounds down, so N ≥ floor(max_in · 10,000 / 10,100)).
pub fn net_budget(max_in: u64) -> u64 {
    // u128 throughout: `max_in` may be anything a caller passes, up to u64::MAX (blind review 1 I-2).
    let fee = |x: u128| x * FEE_BPS as u128 / BPS_DENOMINATOR as u128;
    let m = max_in as u128;
    let mut n = m * BPS_DENOMINATOR as u128 / (BPS_DENOMINATOR + FEE_BPS) as u128;
    while n < m && n + 1 + fee(n + 1) <= m {
        n += 1;
    }
    while n > 0 && n + fee(n) > m {
        n -= 1;
    }
    n as u64
}

pub fn quote_buy(p: &CurveParams, sold: u64, max_in: u64) -> Result<BuyQuote> {
    let f0 = sol_at(p, sold)?;
    let n = net_budget(max_in);
    let target = sold_for_sol(p, f0 as u128 + n as u128)?.max(sold);
    let tokens_out = target - sold;
    require!(tokens_out > 0, PairError::ZeroOutput);
    let sol_after = sol_at(p, target)?;
    let cost = sol_after - f0;
    // Blind review 1 I-1: after a sell leaves `sold` inside a ceil step, a zero-budget buy could take the rest of the step for free.
    require!(cost > 0, PairError::ZeroOutput);
    let fees = fee_split(cost);
    let total = cost.checked_add(fees.fee).ok_or(PairError::MathOverflow)?;
    // F(target) ≤ f0 + n by construction, and fee is monotone, so total ≤ n + fee(n) ≤ max_in.
    require!(total <= max_in, PairError::MathOverflow);
    Ok(BuyQuote { tokens_out, cost, fees, total, sold_after: target, sol_after })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SellQuote {
    /// F(sold) − F(sold − amount): what leaves the curve.
    pub gross: u64,
    pub fees: FeeSplit,
    /// gross − fee: what the seller receives.
    pub net: u64,
    pub sold_after: u64,
    pub sol_after: u64,
}

pub fn quote_sell(p: &CurveParams, sold: u64, amount: u64) -> Result<SellQuote> {
    require!(amount > 0 && amount <= sold, PairError::SellExceedsSold);
    let sold_after = sold - amount;
    let f0 = sol_at(p, sold)?;
    let sol_after = sol_at(p, sold_after)?;
    let gross = f0 - sol_after;
    let fees = fee_split(gross);
    Ok(SellQuote { gross, fees, net: gross - fees.fee, sold_after, sol_after })
}

/// Pro-rata redemption (a Voided pair, or a refunding side): `amount` of the `outstanding` raw tokens is worth
/// floor(amount × pool / supply) of the snapshot, never more than what is left; the holder of the LAST outstanding tokens receives
/// exactly what is left, so the side drains to 0 whatever the order of exits. No fee.
pub fn quote_redeem(pool: u64, supply: u64, outstanding: u64, left: u64, amount: u64) -> Result<u64> {
    require!(amount > 0 && amount <= outstanding && supply > 0, PairError::SellExceedsSold);
    if amount == outstanding {
        return Ok(left);
    }
    let v = (amount as u128).checked_mul(pool as u128).ok_or(PairError::MathOverflow)? / supply as u128;
    Ok((v as u64).min(left))
}

/// sol_A + sol_B ≥ target AND each side ≥ min_side_share_bps of the combined raise.
pub fn graduation_ready(sol_a: u64, sol_b: u64, target: u64, share_bps: u16) -> bool {
    let total = sol_a as u128 + sol_b as u128;
    let need = share_bps as u128 * total;
    total >= target as u128 && sol_a as u128 * BPS_DENOMINATOR as u128 >= need && sol_b as u128 * BPS_DENOMINATOR as u128 >= need
}

/// Tokens that put the CPMM pool at the curve's last price: floor(pool_sol · (V_t − sold) / (V_s + F(sold))) — rounded down, so the
/// pool opens at or a hair ABOVE the curve price (no cheap graduation arbitrage) — capped by what the token vault holds.
pub fn price_matched_tokens(p: &CurveParams, sold: u64, pool_sol: u64, available: u64) -> Result<u64> {
    let s_res = (p.virtual_sol as u128).checked_add(sol_at(p, sold)? as u128).ok_or(PairError::MathOverflow)?;
    let t_res = (p.virtual_token - sold) as u128;
    let t = (pool_sol as u128).checked_mul(t_res).ok_or(PairError::MathOverflow)? / s_res;
    Ok(t.min(available as u128) as u64)
}

/// Lamports CPMM `initialize` takes from its creator for one pool: the create-pool fee plus the rent of the pool state, the
/// observation ring, the LP mint, the creator's LP account and the two pool vaults.
pub fn graduation_costs(rent: &Rent, create_pool_fee: u64) -> u64 {
    create_pool_fee
        .saturating_add(rent.minimum_balance(CPMM_POOL_STATE_LEN))
        .saturating_add(rent.minimum_balance(CPMM_OBSERVATION_LEN))
        .saturating_add(rent.minimum_balance(SPL_MINT_LEN))
        .saturating_add(rent.minimum_balance(SPL_ACCOUNT_LEN).saturating_mul(3))
}

/// What one side's raise must cover beyond its pool deposit: CPMM's take (graduation_costs) plus the rent of the vault's own WSOL
/// account, which graduate creates first and closes last (that rent comes back as residue to the side's burn pool). Graduate cannot
/// borrow it from the other side: the second side's call has nothing else in the vault.
pub fn side_costs(rent: &Rent, create_pool_fee: u64) -> u64 {
    graduation_costs(rent, create_pool_fee).saturating_add(rent.minimum_balance(SPL_ACCOUNT_LEN))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> CurveParams {
        CurveParams { virtual_sol: DEFAULT_VIRTUAL_SOL_LAMPORTS, virtual_token: DEFAULT_VIRTUAL_TOKEN_AMOUNT, curve_supply: DEFAULT_CURVE_SUPPLY }
    }

    /// The same reference numbers test/pairCurvePricing.test.ts asserts (computed independently with Python big integers).
    #[test]
    fn reference_values_match_the_ts_mirror_and_python() {
        let p = defaults();
        assert_eq!(sol_at(&p, 1_000_000).unwrap(), 28);
        assert_eq!(sol_at(&p, 1_000_000_000_000).unwrap(), 27_985_075);
        assert_eq!(sol_at(&p, 400_000_000_000_000).unwrap(), 17_830_609_213);
        assert_eq!(sol_at(&p, p.curve_supply).unwrap(), 85_005_359_057);
        let q = quote_buy(&p, 0, 1_000_000_000).unwrap();
        assert_eq!((q.tokens_out, q.cost, q.fees.fee, q.fees.dev, q.fees.burn, q.total), (34_281_150_163_062, 990_099_010, 9_900_990, 2_475_247, 7_425_743, 1_000_000_000));
        let q = quote_buy(&p, 123_456_789_000, 2_500_000_001).unwrap();
        assert_eq!((q.tokens_out, q.cost, q.total, q.sold_after), (81_765_435_134_082, 2_475_247_526, 2_500_000_001, 81_888_891_923_082));
        let q = quote_buy(&p, 0, 200_000_000_000).unwrap();
        assert_eq!((q.tokens_out, q.cost, q.fees.fee, q.total), (p.curve_supply, 85_005_359_057, 850_053_590, 85_855_412_647));
        let sold = quote_buy(&p, 0, 3_000_000_000).unwrap().sold_after;
        let s = quote_sell(&p, sold, sold / 2).unwrap();
        assert_eq!((s.gross, s.fees.fee, s.fees.dev, s.fees.burn), (1_555_202_690, 15_552_026, 3_888_006, 11_664_020));
    }

    #[test]
    fn net_budget_survives_u64_max() {
        let n = net_budget(u64::MAX);
        assert!(n as u128 + fee_split(n).fee as u128 <= u64::MAX as u128);
    }

    #[test]
    fn redemption_is_order_independent_and_drains_exactly() {
        // three holders of 7, 11 and 13 tokens share 1,000,003 lamports; every exit order pays the same and leaves exactly 0
        let (pool, supply) = (1_000_003u64, 31u64);
        for order in [[7u64, 11, 13], [13, 11, 7], [11, 7, 13]] {
            let (mut out, mut left) = (supply, pool);
            let mut paid = std::collections::BTreeMap::new();
            for amt in order {
                let x = quote_redeem(pool, supply, out, left, amt).unwrap();
                out -= amt;
                left -= x;
                paid.insert(amt, x);
            }
            assert_eq!((out, left), (0, 0));
            for (amt, x) in paid {
                let fair = amt * pool / supply;
                assert!(x >= fair && x <= fair + 2, "{amt}: {x} vs {fair}");
            }
        }
        assert!(quote_redeem(pool, supply, supply, pool, supply + 1).is_err());
    }

    #[test]
    fn sell_out_raise_is_about_85_sol() {
        let p = defaults();
        let f = sol_at(&p, p.curve_supply).unwrap();
        assert!((84_900_000_000..85_100_000_000).contains(&f), "{f}");
        assert_eq!(sol_at(&p, 0).unwrap(), 0);
    }

    #[test]
    fn inverse_is_exact() {
        let p = defaults();
        for sigma in [0u128, 1, 999, 1_000_000_007, 42_500_000_000, 84_000_000_000, 10_000_000_000_000] {
            let s = sold_for_sol(&p, sigma).unwrap();
            assert!(sol_at(&p, s).unwrap() as u128 <= sigma, "sigma {sigma}");
            if s < p.curve_supply {
                assert!(sol_at(&p, s + 1).unwrap() as u128 > sigma, "sigma {sigma}");
            }
        }
    }

    #[test]
    fn fee_split_is_exact() {
        for x in [0u64, 1, 99, 100, 101, 399, 400, 401, 1_000_000_000, u64::MAX / 200] {
            let f = fee_split(x);
            assert_eq!(f.dev + f.burn, f.fee);
            assert_eq!(f.fee, (x as u128 * 100 / 10_000) as u64);
            assert_eq!(f.dev, f.fee / 4);
        }
    }

    #[test]
    fn net_budget_is_maximal() {
        for m in [0u64, 1, 100, 101, 102, 10_099, 10_100, 10_101, 1_000_000_000, 123_456_789_012] {
            let n = net_budget(m);
            assert!(n + fee_split(n).fee <= m);
            assert!(n + 1 + fee_split(n + 1).fee > m || n == m);
        }
    }

    #[test]
    fn buy_then_sell_round_trip_restores_the_curve() {
        let p = defaults();
        let mut sold = 0;
        let mut vault = 0u64;
        let mut holdings = vec![];
        for (i, amt) in [1_000_000_000u64, 3_333_333_333, 7, 10_000_000_000, 250_000_001].iter().enumerate() {
            let q = quote_buy(&p, sold, *amt).unwrap();
            assert!(q.total <= *amt, "{i}");
            vault += q.cost;
            sold = q.sold_after;
            assert_eq!(vault, sol_at(&p, sold).unwrap());
            holdings.push(q.tokens_out);
        }
        for h in holdings.iter().rev() {
            let q = quote_sell(&p, sold, *h).unwrap();
            vault -= q.gross;
            sold = q.sold_after;
            assert_eq!(vault, sol_at(&p, sold).unwrap());
        }
        assert_eq!((sold, vault), (0, 0));
    }

    #[test]
    fn buy_caps_at_sell_out_and_charges_only_what_it_uses() {
        let p = defaults();
        let q = quote_buy(&p, 0, 200_000_000_000).unwrap();
        assert_eq!(q.sold_after, p.curve_supply);
        assert_eq!(q.cost, sol_at(&p, p.curve_supply).unwrap());
        assert!(q.total < 200_000_000_000);
        assert!(quote_buy(&p, p.curve_supply, 1_000_000_000).is_err());
    }

    #[test]
    fn graduation_condition_edges() {
        // exactly 25 % of the combined raise passes; one lamport less fails
        assert!(graduation_ready(25, 75, 100, 2_500));
        assert!(!graduation_ready(24, 75, 99, 2_500));
        assert!(!graduation_ready(25, 74, 100, 2_500));
        assert!(graduation_ready(50, 50, 100, 2_500));
        assert!(!graduation_ready(0, 100, 100, 2_500));
        assert!(graduation_ready(250_000_000, 750_000_000, 1_000_000_000, 2_500));
        assert!(!graduation_ready(249_999_999, 750_000_001, 1_000_000_000, 2_500));
    }

    #[test]
    fn price_match_needs_no_more_than_the_reserve_at_sell_out() {
        let p = defaults();
        let reserve = TOTAL_SUPPLY - p.curve_supply;
        let sol = sol_at(&p, p.curve_supply).unwrap();
        let t = price_matched_tokens(&p, p.curve_supply, sol, u64::MAX).unwrap();
        assert!(t <= reserve, "{t} > {reserve}");
    }
}
