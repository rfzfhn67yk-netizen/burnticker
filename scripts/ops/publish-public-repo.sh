#!/bin/sh
# PUBLISH THE PUBLIC REPO TREE (the owner, 2026-10-09: "make sure everything is transparent. i dont want to hide anything").
#
# Copies the ALLOWLISTED, git-tracked files of this monorepo (config/public-repo.allowlist) into a standalone directory — the
# public Burnticker repository's working tree — plus the public-only overlay (config/public-repo/overlay: README, LICENSE,
# SECURITY.md, tsconfig, test hook, Next root layout) and a package.json generated from what those files import. Before anything
# is written, two checks run on exactly the files that would be copied and FAIL the run on a single finding:
#   · every local import resolves inside the public tree (no private module is dragged along; the tree type-checks on its own)
#   · no text file matches config/public-repo.denypatterns (private platform words, env files, key paths, hosts)
#
#   sh scripts/ops/publish-public-repo.sh --check                      # dry run: list what would be copied, run both checks, write nothing
#   sh scripts/ops/publish-public-repo.sh [--out ../burnticker-public] # check, then copy (the target is emptied first, except .git and node_modules)
#   sh scripts/ops/publish-public-repo.sh --tag                        # also append the commit + program hash entry to docs/burnticker/CHANGELOG.md
#   sh scripts/ops/publish-public-repo.sh --verify [--link-node-modules]  # after copying, type-check and run the tests IN the public tree
#   --no-lockfile: skip the package-lock.json pruned from the monorepo's lock (written by default: the Burnticker host runs `npm ci` on it)
#   add --list to print every published path.
#
# This script never runs `git init`, `git commit`, `git push`, or creates anything on GitHub. The owner does that (docs/burnticker/
# transparency.md). It reads no secret and no env file.
set -eu
cd "$(dirname "$0")/../.."

MODE=publish
for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
  esac
done

exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ops/public-repo-lib.mjs "$MODE" "$@"
