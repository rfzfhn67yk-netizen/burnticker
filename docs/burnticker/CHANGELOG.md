# Burnticker changelog — every publish and every deploy

Append-only. `scripts/ops/publish-public-repo.sh --tag` appends one entry per publish of the public repository: the date, the
monorepo commit the tree was cut from, the burn_receipts program hash (sha256 of the built `.so` when it exists on the publishing
host, else "not built here"), the IDL sha256, and the allowlist's sha256. A deploy of the program or the keeper is a further
entry written by hand with the deployed program id and the transaction. Rendered verbatim on /burnticker/trust. This file is
copied to the public repository's root as `CHANGELOG.md`.

## 2026-10-09 — no publish and no deploy yet

The public repository does not exist yet. The program is not deployed on any public cluster. Entries start when the owner runs the
publish script.

## 2026-10-10 — publish from 3d952cb3466c

- monorepo commit: `3d952cb3466cb5c754e12067231b7264f5678eb7` (the working tree had uncommitted changes when this tag was written)
- program hash: `7a61f00bb38394a6ec57341836e2a261caa9b4befe67082a3ff9e0e9026f5739` — sha256 of programs/burn-receipts/target/deploy/burn_receipts.so on the publishing host
- IDL sha256 (src/lib/burnReceipts/idl.ts): `1c3fda17a66eba4855c53439e2b186c795f2d9e8fe6ba627c9b13a4057c1f516`
- allowlist sha256 (config/public-repo.allowlist): `bb08241ed6570d363924fe7452e6acb85b5bbcf68c1c9fe22778312acb335b4b`
- files published: 483
