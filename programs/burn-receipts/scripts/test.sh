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

# The local-validator build (review-3 I-1: binds the localnet genesis tag, never mainnet's) used by the opt-in TS localnet test.
cargo-build-sbf --manifest-path "$here/programs/burn_receipts/Cargo.toml" --features localnet --sbf-out-dir "$here/target/deploy-localnet"
# Re-check R3-6: say where it went — the TS localnet suite loads it from there and skips without it.
echo "target/deploy-localnet/burn_receipts.so built (--features localnet): used by the opt-in TS suite test/burnReceiptsLocalnet.test.ts"
echo "  (run it from the repo root with BURN_RECEIPTS_LOCALNET=1; it starts solana-test-validator)"

cd "$here"
cargo test -p burn_receipts -- --test-threads=1
# pair_curve (2026-10-10): its LiteSVM suite loads target/deploy/pair_curve.so + burn_receipts.so + the CPMM fixture.
cargo test -p pair_curve -- --test-threads=1
