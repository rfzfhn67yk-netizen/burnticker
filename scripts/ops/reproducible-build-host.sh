#!/usr/bin/env bash
# THE REPRODUCIBLE BUILD ON A THROWAWAY LINUX HOST (ops-2, 2026-10-12; docs/burnticker/VERIFIED-BUILD.md "Throwaway Linux host").
# The owner runs it on a fresh x86 Ubuntu 24.04 server that holds nothing else (the smallest shared x86 cloud type, deleted afterwards). It needs
# no key, no wallet and no secret: it installs Docker, Rust and solana-verify, clones the PUBLIC repository at one commit, builds both
# programs inside solana-verify's Docker image, reads the deployed programs' hashes from mainnet over the public RPC (read-only), and
# prints one comparison table. Nothing is sent to any chain.
#
#   From the Mac (the script is streamed over ssh, nothing to copy):
#     ssh root@<server ip> 'bash -s' < scripts/ops/reproducible-build-host.sh
#     ssh root@<server ip> 'bash -s -- --commit <public commit>' < scripts/ops/reproducible-build-host.sh
#   Options: --commit <sha> (default: the commit the site pins, PUBLIC_REPO_COMMIT), --repo <url>, --rpc <url> (default the public
#   mainnet endpoint), --skip-install (a second run on the same server). SV_BASE_IMAGE=<image> pins solana-verify's build image if it
#   cannot pick one for the workspace's Solana version.
#
# Exit 0 = every built program's executable hash equals the deployed program's hash on mainnet. Exit 1 = a difference (the table says
# which). Exit 2 = it could not run (wrong architecture, a failed install, a failed build).
set -euo pipefail
COMMIT="dba062a7115b0ede1479e264d97f23158cfb7282"
REPO="https://github.com/rfzfhn67yk-netizen/burnticker"
RPC="https://api.mainnet-beta.solana.com"
INSTALL=1
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --rpc) RPC="$2"; shift 2 ;;
    --skip-install) INSTALL=0; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done

# What the table in config/burnticker/verified-build.json says for the mainnet builds (2026-10-12 round-4 upgrade). sha256 is the plain hash of
# the .so file; the executable hash is solana-verify's (trailing zero bytes removed), the number get-program-hash prints for the chain.
# test/burntickerVerifiedBuild.test.ts keeps these lines equal to the table.
declare -A ID SHA EXE
ID[burn_receipts]="AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM"
SHA[burn_receipts]="b1f51c4826a0b79a865ec8aa26ffbab7a0a40b08cad04235a45c215f630526c7"
EXE[burn_receipts]="d9d447524754d52d1083c5027ebe2772fe779814c329fb07363dc90350ded2ae"
ID[pair_curve]="2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN"
SHA[pair_curve]="8effaac2f1a1c19ff1505ce72f28d1ae60c02c971f2411ffab707bfd29fbded2"
EXE[pair_curve]="567f37001f4ecc9966ddce3ca3ac2da8262a1138d21c90825591c08d0bc8a895"
LIBS=(burn_receipts pair_curve)
WS="programs/burn-receipts"
say() { printf '[%s] %s\n' "$(date -u '+%H:%M:%S')" "$*"; }

[ "$(uname -m)" = x86_64 ] || { echo "this server is $(uname -m): use an x86 server type, not ARM. solana-verify's build image is amd64."; exit 2; }

if [ "$INSTALL" = 1 ]; then
  say "installing Docker, git and the Rust build tools (apt)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq docker.io git curl ca-certificates build-essential pkg-config libssl-dev libudev-dev >/dev/null
  systemctl start docker
  say "installing Rust (rustup, minimal profile)"
  curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
fi
# shellcheck disable=SC1091
. "$HOME/.cargo/env"
if ! command -v solana-verify >/dev/null 2>&1; then
  say "installing solana-verify (cargo install --locked; about 5 to 10 minutes on two cores)"
  cargo install solana-verify --locked >/dev/null 2>&1 || { echo "cargo install solana-verify failed"; exit 2; }
fi
say "solana-verify $(solana-verify --version 2>/dev/null | awk '{print $2}'), docker $(docker --version | awk '{print $3}' | tr -d ,)"

SRC="$HOME/burnticker-verify"
rm -rf "$SRC"
say "cloning $REPO at $COMMIT"
git clone -q "$REPO" "$SRC"
cd "$SRC"
git checkout -q "$COMMIT"
say "source tree: $(git rev-parse HEAD)"

OUT="$HOME/burnticker-verify-out"; rm -rf "$OUT"; mkdir -p "$OUT"
BASE=(); [ -n "${SV_BASE_IMAGE:-}" ] && BASE=(--base-image "$SV_BASE_IMAGE")
for lib in "${LIBS[@]}"; do
  say "building $lib inside solana-verify's Docker image (default features: the mainnet build)"
  if ! solana-verify build "$WS" --library-name "$lib" ${BASE[@]+"${BASE[@]}"} > "$OUT/$lib.build.log" 2>&1; then
    echo "the build of $lib failed; the last lines of $OUT/$lib.build.log:"; tail -20 "$OUT/$lib.build.log"; exit 2
  fi
  cp "$WS/target/deploy/$lib.so" "$OUT/$lib.so"
done

say "reading the deployed programs from $RPC (read-only)"
STATUS=0
printf '\n%-14s %-10s %-66s %s\n' "program" "what" "hash" "result"
for lib in "${LIBS[@]}"; do
  f="$OUT/$lib.so"
  sha=$(sha256sum "$f" | awk '{print $1}')
  exe=$( { solana-verify get-executable-hash "$f" || true; } | tail -1 | awk '{print $NF}')
  chain=$( { solana-verify get-program-hash -u "$RPC" "${ID[$lib]}" 2>/dev/null || true; } | tail -1 | awk '{print $NF}')
  [ "$sha" = "${SHA[$lib]}" ] && r1="same as the Mac build" || r1="DIFFERENT from the Mac build ${SHA[$lib]:0:16}…"
  [ "$exe" = "${EXE[$lib]}" ] && r2="same as the table" || r2="DIFFERENT from the table ${EXE[$lib]:0:16}…"
  if [ "$exe" = "$chain" ]; then r3="MATCH: this build is the deployed program"; else r3="DIFFER: the deployed program is not this build"; STATUS=1; fi
  printf '%-14s %-10s %-66s %s\n' "$lib" "sha256" "$sha" "$r1"
  printf '%-14s %-10s %-66s %s\n' "" "build" "$exe" "$r2"
  printf '%-14s %-10s %-66s %s\n' "" "mainnet" "${chain:-unread}" "$r3"
  printf '%-14s %-10s %s\n' "" "bytes" "$(stat -c %s "$f")"
done
echo
echo "commit $(git rev-parse HEAD), $(solana-verify --version 2>/dev/null), image ${SV_BASE_IMAGE:-chosen by solana-verify}; build logs in $OUT"
if [ "$STATUS" = 0 ]; then
  echo "RESULT: both programs on mainnet are exactly what this public commit builds in solana-verify's image."
else
  echo "RESULT: at least one program differs. Paste this table to the operator. Nothing on chain was touched. Delete this server either way."
fi
exit $STATUS
