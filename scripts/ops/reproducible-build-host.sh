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
#   Options: --commit <sha> (default: the commit the site pins, PUBLIC_REPO_COMMIT; burn_receipts is built at it),
#   --pair-curve-commit <sha> (default: the public commit whose program source is pair_curve's deployed round 4, see below), --repo <url>, --rpc <url> (default the public
#   mainnet endpoint), --skip-install (a second run on the same server). SV_BASE_IMAGE=<image> pins solana-verify's build image if it
#   cannot pick one for the workspace's Solana version.
#
# Exit 0 = every built program's executable hash equals the deployed program's hash on mainnet. Exit 1 = a difference (the table says
# which). Exit 2 = it could not run (wrong architecture, a failed install, a failed build).
set -euo pipefail
COMMIT="80547d4cd868205be32d00653ce77c4c9f83bfae"
# pair_curve runs round 4 (it was not upgraded in round 5). It links the burn_receipts crate (its constants, the CPMM pool reader and the
# TokenConfig type), so building it from a round-5 tree gives other bytes without any change of its own. Public commit 7e7bab58 (2026-10-12)
# carries exactly the program tree of monorepo 29f6f5de, the source of pair_curve's deployed bytes; pair_curve is built there.
PAIR_CURVE_COMMIT="7e7bab5804f9e3dee070ebbc2bd3ba1de1c6b999"
REPO="https://github.com/rfzfhn67yk-netizen/burnticker"
RPC="https://api.mainnet-beta.solana.com"
INSTALL=1
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="$2"; shift 2 ;;
    --pair-curve-commit) PAIR_CURVE_COMMIT="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --rpc) RPC="$2"; shift 2 ;;
    --skip-install) INSTALL=0; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done

# What the table in config/burnticker/verified-build.json says for the mainnet builds. sha256 is the plain hash of the .so file; the executable
# hash is solana-verify's (trailing zero bytes removed), the number get-program-hash prints for the chain. test/burntickerVerifiedBuild.test.ts
# keeps these lines equal to the table. burn_receipts: the B-17 build (monorepo source 116ff5ad, built on the Mac 2026-10-21), built at
# COMMIT; deployed on mainnet 2026-10-21 17:57 Denver (Squads vault transaction 4, slot 459823169), so the comparison says MATCH.
# pair_curve: still round 4 (source 29f6f5de, 2026-10-12), built at PAIR_CURVE_COMMIT (above). DEPLOYED[<lib>] names the earlier hash
# mainnet runs while an upgrade to the table's build is pending (the comparison then says PENDING); no program has one now.
declare -A ID SHA EXE DEPLOYED
ID[burn_receipts]="AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM"
SHA[burn_receipts]="c753fc2763f794df665b60a23591397e6526567b0c81c86d76533394d30bb4d7"
EXE[burn_receipts]="1aff5fbfe243ea8233c360bfae6809b0dd411e2298600831d10be5ea97c99e17"
ID[pair_curve]="2jQotwSG8WKNYr5pccxuVmNa314qcnnwmrhqbuakELkN"
SHA[pair_curve]="9205de80b377a3fc3c4c8b3de93b66c8a49e8120a78b082e3e5ed850d142088d"
EXE[pair_curve]="8d21ff603670000ac7e1f492aea842fc37891c26197df88b5b7135656373f1e3"
LIBS=(burn_receipts pair_curve)
WS="programs/burn-receipts"
say() { printf '[%s] %s\n' "$(date -u '+%H:%M:%SZ')" "$*"; }

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
declare -A AT; AT[burn_receipts]="$COMMIT"; AT[pair_curve]="$PAIR_CURVE_COMMIT"
for lib in "${LIBS[@]}"; do git cat-file -e "${AT[$lib]}^{commit}" 2>/dev/null || { echo "commit ${AT[$lib]} ($lib) is not in $REPO"; exit 2; }; done

OUT="$HOME/burnticker-verify-out"; rm -rf "$OUT"; mkdir -p "$OUT"
BASE=(); [ -n "${SV_BASE_IMAGE:-}" ] && BASE=(--base-image "$SV_BASE_IMAGE")
for lib in "${LIBS[@]}"; do
  git checkout -q "${AT[$lib]}"
  say "source tree for $lib: $(git rev-parse HEAD)"
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
  if [ "$exe" = "$chain" ]; then r3="MATCH: this build is the deployed program"
  elif [ -n "${DEPLOYED[$lib]:-}" ] && [ "$chain" = "${DEPLOYED[$lib]}" ] && [ "$exe" = "${EXE[$lib]}" ]; then r3="PENDING: mainnet still runs the earlier build; the upgrade to this build has not been deployed"; STATUS=1
  else r3="DIFFER: the deployed program is not this build"; STATUS=1; fi
  printf '%-14s %-10s %-66s %s\n' "$lib" "sha256" "$sha" "$r1"
  printf '%-14s %-10s %-66s %s\n' "" "build" "$exe" "$r2"
  printf '%-14s %-10s %-66s %s\n' "" "mainnet" "${chain:-unread}" "$r3"
  printf '%-14s %-10s %s\n' "" "bytes" "$(stat -c %s "$f")"
done
echo
echo "commits: burn_receipts $COMMIT, pair_curve $PAIR_CURVE_COMMIT; $(solana-verify --version 2>/dev/null), image ${SV_BASE_IMAGE:-chosen by solana-verify}; build logs in $OUT"
if [ "$STATUS" = 0 ]; then
  echo "RESULT: both programs on mainnet are exactly what their public commits build in solana-verify's image."
else
  echo "RESULT: at least one program differs. Paste this table to the operator. Nothing on chain was touched. Delete this server either way."
fi
exit $STATUS
