#!/usr/bin/env bash
# `anchor test` entry point (Anchor.toml [scripts] test) — review-2 F17(a): a clean checkout passes without hand-built fixtures.
#   1. fixtures/raydium_cp_swap.so missing → scripts/build-cpmm-fixture.sh (clones raydium-cp-swap at the pinned commit, builds it
#      with the TEST admin key, and also builds the LaunchLab stand-in);
#   2. fixtures/launchlab_mock.so missing or older than its source → rebuilt from mocks/launchlab_mock (local, no network);
#   3. the hostile callee and the multicall wrapper (test-only mocks) and the --features localnet build in target/deploy-localnet
#      (the only producer of what the opt-in TS localnet suite loads — re-check R3-6);
#   4. the LiteSVM suites of burn_receipts and pair_curve (anchor build has already produced both .so files).
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

if [ ! -f "$here/fixtures/raydium_cp_swap.so" ]; then
  bash "$here/scripts/build-cpmm-fixture.sh"
fi

# Round 5: the real Raydium AMM v4 program (raydium-amm, pinned commit) for the AMM v4 target-pool suite.
if [ ! -f "$here/fixtures/raydium_amm.so" ]; then
  bash "$here/scripts/build-amm-v4-fixture.sh"
fi

mock_so="$here/fixtures/launchlab_mock.so"
mock_src="$here/mocks/launchlab_mock"
if [ ! -f "$mock_so" ] || [ -n "$(find "$mock_src/src" "$mock_src/Cargo.toml" -newer "$mock_so" -print -quit)" ]; then
  cargo-build-sbf --manifest-path "$mock_src/Cargo.toml"
  cp "$mock_src/target/deploy/launchlab_mock.so" "$mock_so"
  echo "fixtures/launchlab_mock.so built (test-only LaunchLab stand-in)"
fi

# The hostile callee for review-3 M-1 (plays a malicious LaunchLab / CPMM upgrade); test-only, local build.
evil_so="$here/fixtures/evil_callee.so"
evil_src="$here/mocks/evil_callee"
if [ ! -f "$evil_so" ] || [ -n "$(find "$evil_src/src" "$evil_src/Cargo.toml" -newer "$evil_so" -print -quit)" ]; then
  cargo-build-sbf --manifest-path "$evil_src/Cargo.toml"
  cp "$evil_src/target/deploy/evil_callee.so" "$evil_so"
  echo "fixtures/evil_callee.so built (test-only hostile callee)"
fi

# The generic multicall for re-check R3-1 (a wrapper that CPIs [swap, check_pool_health] in one instruction); test-only, local build.
mc_so="$here/fixtures/multicall.so"
mc_src="$here/mocks/multicall"
if [ ! -f "$mc_so" ] || [ -n "$(find "$mc_src/src" "$mc_src/Cargo.toml" -newer "$mc_so" -print -quit)" ]; then
  cargo-build-sbf --manifest-path "$mc_src/Cargo.toml"
  cp "$mc_src/target/deploy/multicall.so" "$mc_so"
  echo "fixtures/multicall.so built (test-only CPI wrapper)"
fi

# The hostile CPMM `initialize` for pair_curve's graduation guards (plays a malicious CPMM upgrade that abuses the SOL vault's
# signature); test-only, local build.
ecpmm_so="$here/fixtures/evil_cpmm_init.so"
ecpmm_src="$here/mocks/evil_cpmm_init"
if [ ! -f "$ecpmm_so" ] || [ -n "$(find "$ecpmm_src/src" "$ecpmm_src/Cargo.toml" -newer "$ecpmm_so" -print -quit)" ]; then
  cargo-build-sbf --manifest-path "$ecpmm_src/Cargo.toml"
  cp "$ecpmm_src/target/deploy/evil_cpmm_init.so" "$ecpmm_so"
  echo "fixtures/evil_cpmm_init.so built (test-only hostile CPMM initialize)"
fi

# The CPMM liquidity-lock stand-in for LAUNCHPAD-PATH §35 (Raydium's lock program source is not public); test-only, local build,
# loaded at the real lock program id by the lock-fee suites.
lock_so="$here/fixtures/cpmm_lock_mock.so"
lock_src="$here/mocks/cpmm_lock_mock"
if [ ! -f "$lock_so" ] || [ -n "$(find "$lock_src/src" "$lock_src/Cargo.toml" -newer "$lock_so" -print -quit)" ]; then
  cargo-build-sbf --manifest-path "$lock_src/Cargo.toml"
  cp "$lock_src/target/deploy/cpmm_lock_mock.so" "$lock_so"
  echo "fixtures/cpmm_lock_mock.so built (test-only Raydium CPMM lock stand-in)"
fi

# The local-validator build (review-3 I-1: binds the localnet genesis tag, never mainnet's) used by the opt-in TS localnet test.
cargo-build-sbf --manifest-path "$here/programs/burn_receipts/Cargo.toml" --features localnet --sbf-out-dir "$here/target/deploy-localnet"
# Re-check R3-6: say where it went — the TS localnet suite loads it from there and skips without it.
echo "target/deploy-localnet/burn_receipts.so built (--features localnet): used by the opt-in TS suite test/burnReceiptsLocalnet.test.ts"
echo "  (run it from the repo root with BURN_RECEIPTS_LOCALNET=1; it starts solana-test-validator)"

# lp-lock blind review RL-3 (2026-10-11): the LiteSVM harness (tests/common Env::new) loads the `test-pins` build — mainnet genesis
# and Raydium ids, with the harness's test LaunchLab platform as BURNTICKER_PLATFORM and the test treasury [0x7e; 32]. The default
# (mainnet) build pins no platform yet and refuses every policy-0/2 initialize_token (PlatformNotPinned); anchor build still makes it.
cargo-build-sbf --manifest-path "$here/programs/burn_receipts/Cargo.toml" --features test-pins --sbf-out-dir "$here/target/deploy-test"
echo "target/deploy-test/burn_receipts.so built (--features test-pins): loaded by the LiteSVM suites"

cd "$here"
cargo test -p burn_receipts -- --test-threads=1
# pair_curve (2026-10-10): its LiteSVM suites load target/deploy-localnet/pair_curve.so (--features localnet: the harness's test
# LaunchLab platform compiled in as BURNTICKER_PLATFORM — the default build is the mainnet build, which pins no platform yet and
# refuses init_pair) + target/deploy/burn_receipts.so + the CPMM fixture.
cargo-build-sbf --manifest-path "$here/programs/pair_curve/Cargo.toml" --features localnet --sbf-out-dir "$here/target/deploy-localnet"
cargo test -p pair_curve -- --test-threads=1

# lp-lock blind review I-1..I-3: the lock suites again against the REAL Raydium lock program when REVIEW_LOCK_SO is set. Acquire it
# read-only, outside the repo, and never commit it (Raydium's binary, not ours):
#   solana program dump -u https://api.mainnet-beta.solana.com LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE /tmp/lock_mainnet.so
#   REVIEW_LOCK_SO=/tmp/lock_mainnet.so bash scripts/test.sh
# (The harness uses mainnet program ids, so the mainnet dump is the one that matches; the devnet program's compiled CPMM id differs.)
if [ -n "${REVIEW_LOCK_SO:-}" ]; then
  echo "== lock suites against REVIEW_LOCK_SO=$REVIEW_LOCK_SO (real lock program)"
  cargo test -p burn_receipts --test lock_fees --test review_lock -- --test-threads=1
  cargo test -p pair_curve -- --test-threads=1
fi
