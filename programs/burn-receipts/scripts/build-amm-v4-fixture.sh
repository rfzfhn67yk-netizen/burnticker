#!/usr/bin/env bash
# Builds the REAL Raydium AMM v4 program (raydium-amm) from source as a TEST FIXTURE for the round-5 LiteSVM suite
# (tests/burn_target.rs: a coin that burns another token on an AMM v4 pool):
#   fixtures/raydium_amm.so
#
# Pinned to the commit the program's AmmInfo offsets were read from (src/amm_v4.rs): d26944bf, "Upgrade version (#70)", after "Remove
# openbook dependency (#69)" — the version with swap_base_in_v2 (instruction 16, no OpenBook accounts), which is what mainnet runs today
# (22 of 22 AMM v4 instructions in the last 40 transactions on WIF's pool were tag 16, read 2026-10-13). The default build is the mainnet
# program id 675kPX9M…; the suite loads it there and writes a swap-only AmmInfo itself (the program has no permissionless create without
# OpenBook). Test fixture only: never deployed, and these bytes are not claimed to equal Raydium's deployed binary.
set -euo pipefail

AMM_REPO="https://github.com/raydium-io/raydium-amm.git"
AMM_COMMIT="d26944bfb76fb5fa8f91e5d440c2050ed358ef81"

here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/fixtures/raydium-amm"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

if [ ! -d "$src" ]; then
  git clone --quiet "$AMM_REPO" "$src"
fi
git -C "$src" fetch --quiet --depth 1 origin "$AMM_COMMIT" 2>/dev/null || true
git -C "$src" checkout --quiet "$AMM_COMMIT"

cargo-build-sbf --manifest-path "$src/program/Cargo.toml"
cp "$src/target/deploy/raydium_amm.so" "$here/fixtures/raydium_amm.so"
rm -f "$src/target/deploy/raydium_amm-keypair.json"
echo "fixtures/raydium_amm.so built from raydium-amm@$AMM_COMMIT"
