#!/usr/bin/env bash
# THE VERIFIED BUILD (trust pack, 2026-10-10). Rebuilds burn_receipts and pair_curve from this repository and prints the executable
# hash of each — the number anyone compares with the program deployed on chain. docs/burnticker/VERIFIED-BUILD.md explains every step.
#
#   bash scripts/ops/verified-build.sh --docker [--write]      the real verifiable build: solana-verify's Docker image (Linux + Docker)
#   bash scripts/ops/verified-build.sh --local  [--write]      INTERIM: cargo build-sbf on this host (what the committed table holds today)
#   bash scripts/ops/verified-build.sh --onchain devnet|mainnet  read the deployed programs back (read-only RPC) and hash them
#   bash scripts/ops/verified-build.sh --commands [COMMIT]     print the solana-verify verify-from-repo + registry commands
#
# Each build mode builds both programs twice — default features (the mainnet build) and `--features devnet` (Raydium's devnet program
# ids compiled in; the devnet deployment) — and compares every hash with config/burnticker/verified-build.json. Exit 0 = all equal;
# exit 1 = a difference (printed). --write replaces the table's build hashes (and its `kind`) instead of failing.
#
# The executable hash is sha256 of the program bytes with trailing zero bytes removed (solana-verify's definition, so it equals
# `solana-verify get-executable-hash` / `get-program-hash`). Read-only: no transaction is ever sent; no key is read. The program
# keypairs are NOT needed (the ids are compiled in from declare_id!); cargo build-sbf writes a throwaway keypair into OUT, never into
# target/deploy.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
WS="programs/burn-receipts"
TABLE="config/burnticker/verified-build.json"
OUT="${OUT:-${TMPDIR:-/tmp}/burnticker-verified-build}"
PUBLIC_REPO="${PUBLIC_REPO:-https://github.com/rfzfhn67yk-netizen/burnticker}"
LIBS=(burn_receipts pair_curve)
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

MODE="${1:-}"; shift || true
WRITE=0
for a in "$@"; do [ "$a" = "--write" ] && WRITE=1; done

# executable hash of each file given: prints "<hash> <bytes> <file>"
exec_hash() {
  node -e '
    const fs = require("node:fs"), crypto = require("node:crypto");
    for (const f of process.argv.slice(1)) {
      const b = fs.readFileSync(f); let n = b.length; while (n > 0 && b[n - 1] === 0) n--;
      console.log(crypto.createHash("sha256").update(b.subarray(0, n)).digest("hex"), b.length, f);
    }' "$@"
}

# compare (or --write) one variant: $1 = mainnet|devnet, $2 = dir holding <lib>.so, $3 = kind (docker|interim-local)
compare_or_write() {
  local variant="$1" dir="$2" kind="$3"
  node -e '
    const fs = require("node:fs"), crypto = require("node:crypto"), path = require("node:path");
    const [table, variant, dir, kind, write] = process.argv.slice(1);
    const t = JSON.parse(fs.readFileSync(table, "utf8"));
    let bad = 0;
    for (const p of t.programs) {
      const f = path.join(dir, `${p.library}.so`);
      const b = fs.readFileSync(f); let n = b.length; while (n > 0 && b[n - 1] === 0) n--;
      const h = crypto.createHash("sha256").update(b.subarray(0, n)).digest("hex");
      const want = p.builds[variant].hash;
      if (write === "1") { p.builds[variant].hash = h; p.builds[variant].bytes = b.length; console.log(`wrote  ${variant.padEnd(7)} ${p.library.padEnd(13)} ${h}`); }
      else if (h === want) console.log(`MATCH  ${variant.padEnd(7)} ${p.library.padEnd(13)} ${h}`);
      else { bad++; console.log(`DIFFER ${variant.padEnd(7)} ${p.library.padEnd(13)} built ${h} · table ${want}`); }
    }
    if (write === "1") { t.kind = kind; t.updatedAt = new Date().toISOString().slice(0, 10); fs.writeFileSync(table, JSON.stringify(t, null, 2) + "\n"); }
    process.exit(bad ? 1 : 0);' "$TABLE" "$variant" "$dir" "$kind" "$WRITE"
}

build_local() {
  command -v cargo-build-sbf >/dev/null || { echo "cargo-build-sbf not on PATH (install the Solana CLI: docs/burnticker/VERIFIED-BUILD.md)"; exit 2; }
  local status=0
  for variant in mainnet devnet; do
    local dir="$OUT/local-$variant"; mkdir -p "$dir"
    local feat=(); [ "$variant" = devnet ] && feat=(--features devnet)
    for lib in "${LIBS[@]}"; do
      echo "== cargo build-sbf ${feat[*]+${feat[*]}} ($lib, $variant)"
      (cd "$WS/programs/$lib" && CARGO_TARGET_DIR="$OUT/cargo-target" cargo build-sbf ${feat[@]+"${feat[@]}"} --sbf-out-dir "$dir" 2>&1 | tail -1)
    done
    compare_or_write "$variant" "$dir" interim-local || status=1
  done
  return $status
}

build_docker() {
  command -v docker >/dev/null && docker info >/dev/null 2>&1 || { echo "Docker is not available here. Run this on a Linux host with Docker (docs/burnticker/VERIFIED-BUILD.md § Docker host)."; exit 2; }
  command -v solana-verify >/dev/null || { echo "solana-verify not installed: cargo install solana-verify --locked"; exit 2; }
  local base=(); [ -n "${SV_BASE_IMAGE:-}" ] && base=(--base-image "$SV_BASE_IMAGE")
  local status=0
  for variant in mainnet devnet; do
    local dir="$OUT/docker-$variant"; mkdir -p "$dir"
    for lib in "${LIBS[@]}"; do
      echo "== solana-verify build $WS --library-name $lib ${base[*]+${base[*]}} $([ "$variant" = devnet ] && echo '-- --features devnet')"
      if [ "$variant" = devnet ]; then solana-verify build "$WS" --library-name "$lib" ${base[@]+"${base[@]}"} -- --features devnet
      else solana-verify build "$WS" --library-name "$lib" ${base[@]+"${base[@]}"}; fi
      cp "$WS/target/deploy/$lib.so" "$dir/$lib.so"
      solana-verify get-executable-hash "$dir/$lib.so"
    done
    compare_or_write "$variant" "$dir" docker || status=1
  done
  return $status
}

onchain() {
  local cluster="${1:-devnet}" url
  case "$cluster" in devnet) url="https://api.devnet.solana.com" ;; mainnet) url="https://api.mainnet-beta.solana.com" ;; *) echo "devnet or mainnet"; exit 2 ;; esac
  url="${RPC_URL:-$url}"
  local dir="$OUT/onchain-$cluster"; mkdir -p "$dir"
  local status=0
  for lib in "${LIBS[@]}"; do
    local id; id=$(node -e 'const t=require(process.argv[1]);console.log(t.programs.find(p=>p.library===process.argv[2]).programId)' "$ROOT/$TABLE" "$lib")
    solana program dump "$id" "$dir/$lib.so" --url "$url" >/dev/null
    local h; h=$(exec_hash "$dir/$lib.so" | cut -d' ' -f1)
    local want; want=$(node -e 'const t=require(process.argv[1]);console.log(t.programs.find(p=>p.library===process.argv[2]).builds[process.argv[3]].hash)' "$ROOT/$TABLE" "$lib" "$cluster")
    if [ "$h" = "$want" ]; then echo "MATCH  $cluster $lib $id $h"; else echo "DIFFER $cluster $lib $id deployed $h · table build $want"; status=1; fi
  done
  return $status
}

commands() {
  local commit="${1:-<PUBLIC_REPO_COMMIT>}"
  cat <<EOF
# 1. Devnet, now (the devnet build compiles Raydium's devnet ids in, hence -- --features devnet):
solana-verify verify-from-repo -u https://api.devnet.solana.com --program-id AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM \\
  $PUBLIC_REPO --commit-hash $commit --library-name burn_receipts --mount-path $WS -- --features devnet
solana-verify verify-from-repo -u https://api.devnet.solana.com --program-id 2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN \\
  $PUBLIC_REPO --commit-hash $commit --library-name pair_curve --mount-path $WS -- --features devnet

# 2. Mainnet, after the owner deploys (default features). Answer "n" when it asks to upload the verification PDA: the upgrade
#    authority is the Squads vault, so the PDA goes through a Squads proposal (step 3).
solana-verify verify-from-repo -um --program-id AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM \\
  $PUBLIC_REPO --commit-hash $commit --library-name burn_receipts --mount-path $WS
solana-verify verify-from-repo -um --program-id 2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN \\
  $PUBLIC_REPO --commit-hash $commit --library-name pair_curve --mount-path $WS

# 3. OtterSec verified-builds registry (mainnet only; owner step — docs/burnticker/TODO-OWNER.md). For each program:
solana-verify export-pda-tx $PUBLIC_REPO --program-id AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM \\
  --uploader <MAINNET_SQUADS_VAULT> --encoding base58 --compute-unit-price 0 \\
  --commit-hash $commit --library-name burn_receipts --mount-path $WS
#    → import the printed transaction into Squads (Developers → TX builder → import base58), two signers approve, execute; then:
solana-verify remote submit-job --program-id AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM --uploader <MAINNET_SQUADS_VAULT>
#    (repeat both for pair_curve 2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN with --library-name pair_curve)
#    Check: solana-verify remote get-job-status / https://verify.osec.io/status/<PROGRAM_ID>
EOF
}

case "$MODE" in
  --local) build_local ;;
  --docker) build_docker ;;
  --onchain) onchain "${1:-devnet}" ;;
  --commands) commands "${1:-}" ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
