# Sourced by every background service entrypoint. Not executable on its own.
#
# WHY THIS EXISTS. Next.js reads .env.local automatically; a plain node script
# and a launchd/systemd job do not. Worse, a background service inherits NO
# shell environment at all — no .zshrc, no exports, no nvm PATH. Without this,
# configuration set in a terminal appears to work interactively and silently
# vanishes under the service manager.
#
# A value already present in the environment WINS, so running a service by
# hand with an override still behaves as expected.
#
# SECRETS. This reads whatever is in .env.local, which is plaintext on disk.
# Put API keys here. Do NOT put the signer passphrase here — that would store
# the passphrase next to nothing but itself and undo the point of encrypting
# the key. The passphrase is entered per-run, by hand. See scripts/service.sh.
# EXCEPTION — the dedicated Burnticker VPS (docs/burnticker/deploy.md): Linux has no Keychain and its keepers run unattended, so
# there (and only there) BURNKEEPER_SIGNER_PASSPHRASE lives in that host's .env.local (mode 600, typed in by the owner; never in the
# repo — deploy-burnticker-host.sh excludes .env*). The keys it unlocks can only attest readings and pay fees; they hold no funds.
load_env_local() {
  _dir="${1:-.}"
  [ -f "$_dir/.env.local" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    _key="${line%%=*}"
    # Anything that is not a plain KEY=VALUE is skipped rather than exported.
    # Pasting a documentation line into this file is how an RPC URL once became
    # "https://... (or https://...)" and ate a signed transaction.
    case "$_key" in *[!A-Za-z0-9_]*) continue ;; esac
    [ -n "$(eval "printf '%s' \"\${$_key-}\"")" ] && continue
    export "$_key=${line#*=}"
  done < "$_dir/.env.local"
}
