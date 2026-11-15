#!/usr/bin/env bash
# Builds the REAL Raydium CPMM program (raydium-cp-swap) from source as a TEST FIXTURE for the LiteSVM suite:
#   fixtures/raydium_cp_swap.so
#
# Why from source and not a dump of the mainnet binary: nothing in this repository touches mainnet, and the `localnet` feature of
# raydium-cp-swap compiles the AMM admin key from CPSWAP_LOCALNET_ADMIN, so the tests can create an AmmConfig and a permission PDA
# (exactly what Raydium's admin and LaunchLab do on mainnet) and then create a pool through `initialize_with_permission` with the
# fee PDA as pool creator. The admin key is a deterministic TEST key (ed25519 seed = 32 × 0x2a), never a real one.
#
# Pinned to the commit the program's byte offsets were read from (src/cpmm.rs).
set -euo pipefail

CPMM_REPO="https://github.com/raydium-io/raydium-cp-swap.git"
CPMM_COMMIT="b3187ae53a1b95a201f855a59024a12ca8f5b51a"
TEST_ADMIN="2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ" # Keypair::from_seed(&[42u8; 32]) — test only

here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/fixtures/raydium-cp-swap"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

if [ ! -d "$src" ]; then
  git clone --quiet "$CPMM_REPO" "$src"
fi
git -C "$src" fetch --quiet --depth 1 origin "$CPMM_COMMIT" 2>/dev/null || true
git -C "$src" checkout --quiet "$CPMM_COMMIT"

CPSWAP_LOCALNET_ADMIN="$TEST_ADMIN" cargo-build-sbf --manifest-path "$src/programs/cp-swap/Cargo.toml" --features localnet
cp "$src/target/deploy/raydium_cp_swap.so" "$here/fixtures/raydium_cp_swap.so"
echo "fixtures/raydium_cp_swap.so built from raydium-cp-swap@$CPMM_COMMIT (localnet admin $TEST_ADMIN)"

# The TEST-ONLY LaunchLab claim_creator_fee stand-in (mocks/launchlab_mock; LaunchLab's source is not public), loaded by the
# LiteSVM suite at LaunchLab's program id. The account contract it enforces is pinned to the Raydium SDK (fixtures/launchlab-claim-sdk.json).
cargo-build-sbf --manifest-path "$here/mocks/launchlab_mock/Cargo.toml"
cp "$here/mocks/launchlab_mock/target/deploy/launchlab_mock.so" "$here/fixtures/launchlab_mock.so"
echo "fixtures/launchlab_mock.so built (test-only LaunchLab stand-in)"
