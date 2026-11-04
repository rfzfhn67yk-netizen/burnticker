#!/usr/bin/env bash
# Environment setup for an agentic reviewer (OpenAI Codex cloud, or any fresh Ubuntu container) working on the PUBLIC Burnticker tree.
# Installs the pinned toolchain the programs and tests expect, then builds both programs so the LiteSVM suites and the IDL test run.
#
#   bash scripts/ops/codex-setup.sh            # ~10–15 min on a cold container (Rust + Solana + Anchor + npm ci + anchor build)
#   SKIP_BUILD=1 bash scripts/ops/codex-setup.sh
#
# Pins (from programs/burn-receipts/Anchor.toml and rust-toolchain.toml): Rust 1.99.0, Solana 4.3.0, Anchor 1.2.1. Node ≥ 22.6
# (type stripping) — Node 24 is fine. No secrets, no env files, no network calls at test time beyond the explicitly live tests
# (which skip without network). The script never touches anything outside the checkout and the toolchain directories.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
RUST_VERSION=1.99.0; SOLANA_VERSION=4.3.0; ANCHOR_VERSION=1.2.1

log() { printf '[codex-setup] %s\n' "$*"; }

# --- system packages (Debian/Ubuntu; harmless elsewhere) ---
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  (apt-get update -qq && apt-get install -y -qq build-essential pkg-config libssl-dev libudev-dev protobuf-compiler curl git ca-certificates) >/dev/null 2>&1 || log "apt-get skipped (not root or offline)"
fi

# --- Rust (pinned) ---
if ! command -v rustup >/dev/null 2>&1; then
  log "installing rustup"; curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain "$RUST_VERSION" --profile minimal >/dev/null
fi
export PATH="$HOME/.cargo/bin:$PATH"
rustup toolchain install "$RUST_VERSION" --profile minimal -c rustfmt -c clippy >/dev/null 2>&1 || true

# --- Solana (pinned) ---
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
if ! solana --version 2>/dev/null | grep -q "$SOLANA_VERSION"; then
  log "installing solana $SOLANA_VERSION"; sh -c "$(curl -sSfL https://release.anza.xyz/v$SOLANA_VERSION/install)" >/dev/null
fi

# --- Anchor (pinned) ---
if ! anchor --version 2>/dev/null | grep -q "$ANCHOR_VERSION"; then
  log "installing anchor $ANCHOR_VERSION via avm (falls back to cargo install)"
  (cargo install --locked avm >/dev/null 2>&1 && avm install "$ANCHOR_VERSION" >/dev/null 2>&1 && avm use "$ANCHOR_VERSION" >/dev/null 2>&1) \
    || cargo install --locked --git https://github.com/solana-foundation/anchor --tag "v$ANCHOR_VERSION" anchor-cli >/dev/null
fi
export PATH="$HOME/.avm/bin:$PATH"

# --- Node deps (the public tree has its own package-lock.json) ---
if [ -f package-lock.json ]; then log "npm ci"; npm ci --no-audit --no-fund >/dev/null; fi

# --- build both programs (produces target/deploy/*.so and target/idl/*.json for the IDL and LiteSVM tests) ---
if [ "${SKIP_BUILD:-0}" != 1 ]; then
  log "anchor build (burn_receipts + pair_curve)"; (cd programs/burn-receipts && anchor build >/dev/null)
fi

log "toolchain: $(rustc --version) | $(solana --version) | $(anchor --version)"
log "done. Rust suites: (cd programs/burn-receipts && bash scripts/test.sh)   TS suite: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs --test 'test/**/*.test.ts'"
