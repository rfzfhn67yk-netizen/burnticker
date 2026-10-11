#!/bin/sh
# Entrypoint for the BURN KEEPER (mct-burnkeeper, 2026-10-09): the event-indexed burn service behind $DEFICIT (rule key DEBT —
# burns indexed to U.S. Treasury Debt to the Penny; mct-runner-study/launch-debt-egg-2026-10-09/SPEC.md §4).
#
# Environment (.env.local on that host, or the unit):
#   BURNKEEPER_RPC_URL       Solana RPC. The cluster is read from its genesis hash. MAINNET IS REFUSED unless BOTH
#   BURNKEEPER_MAINNET=1     and
#   BURNKEEPER_RULES_SHA     = the sha256 printed by `scripts/burn-keeper.mts --print-rules` (the two-key safety)
#   BURNKEEPER_MINT          the $DEFICIT mint (buyback on mainnet: must also be written into the rule file's "mint" — the third key)
#   BURNKEEPER_VAULT         legacy vault mode: the burn vault token account (the keeper must own it). Program execution and legacy
#                            buyback: leave unset
#   BURNKEEPER_SIGNER_PATH   the keeper's encrypted key (default ~/.config/meme-coin-trader/signer-burnkeeper.enc.json) — never the treasury's
#   BURNKEEPER_RULES         default config/burnkeeper/deficit.rules.json (mode "buyback" — the primary mechanic — or "vault")
#   BURNKEEPER_PUBLISH_DIR   where status.json / burns.json / rules.json / index.html are written each cycle (default data/burnkeeper-site)
#   BURNKEEPER_EXECUTION     program (the launch path; the default whenever BURNTICKER_PROGRAM_ID is set) | legacy (DEPRECATED)
#   BURNTICKER_PROGRAM_ID    the deployed burn_receipts program: the keeper attests readings, claims creator fees into the fee PDA and
#                            cranks (docs/burnkeeper/README-execution.md)
#   BURNKEEPER_SIGNER_PASSPHRASE  the key's passphrase: on the Burnticker host it lives ONLY in .env.local (mode 600; Linux has no
#                            Keychain) — never in the repo or on a command line; on a Mac it may come from the Keychain (below)
#   Buyback mode:
#     BURNKEEPER_CLAIM_CREATOR_FEES=1   LEGACY EXECUTION ONLY — do not set for program execution (it claims by itself) and never for a
#                                       fee-PDA token (the legacy leg refuses it)
#     BURNKEEPER_CREATOR_FEE_SOURCE     (status page) the address the creator fees come from
#     BURNKEEPER_SEED_TX / _SEED_SOL    (status page) the disclosed seed deposit's signature and amount
#     BURNKEEPER_PRIORITY_MICROLAMPORTS (optional) priority fee for the burn transaction
#   Vault mode:
#     BURNKEEPER_LAUNCHLAB_POOL         the LaunchLab pool id: the keeper claims vested tokens into the vault before burning
#   BURNKEEPER_BASELINE_DATE   (optional, first start only) the record_date to start from — the last reading before launch
#   BURNKEEPER_DB            default data/burnkeeper.db
# data/PAUSE-burnkeeper holds every send (polling and the status site go on). Extra flags pass through (e.g. --dry-run).
set -eu
cd "$(dirname "$0")/../.."
. ./scripts/load-env.sh
load_env_local .
# The keeper's key passphrase: its own when set (the Burnticker host: .env.local), else on a Mac the shared one from the Keychain. Never logged.
if [ -z "${BURNKEEPER_SIGNER_PASSPHRASE:-}" ] && [ -z "${AUTONOMOUS_SIGNER_PASSPHRASE:-}" ]; then if PASS="$(node scripts/keychain.mjs read 2>/dev/null)"; then export AUTONOMOUS_SIGNER_PASSPHRASE="$PASS"; fi; fi
export BURNKEEPER_RULES="${BURNKEEPER_RULES:-config/burnkeeper/deficit.rules.json}"
export BURNKEEPER_PUBLISH_DIR="${BURNKEEPER_PUBLISH_DIR:-data/burnkeeper-site}"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting the burn keeper (rules $BURNKEEPER_RULES, site $BURNKEEPER_PUBLISH_DIR)"
exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burn-keeper.mts "$@"
