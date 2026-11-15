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

# The NAMES in .env.local, one a line, never a value (2026-10-18: the synthetic creator's devnet web instances set every one of them empty,
# because `next start` would otherwise fill them in from this file). Reads the names the way Next's own parser does: `export` and any
# whitespace before the name, `KEY=value` and `KEY: value`, spaces around the separator. A name is [A-Za-z_][A-Za-z0-9_]*; anything else
# is skipped. A value that opens a quote (" ' or `) and does not close it on its line runs on to the line that does: those lines are part
# of the value (a PEM or base64 block), never read as names.
env_local_names() {
  _dir="${1:-.}"
  [ -f "$_dir/.env.local" ] || return 0
  _open=""
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$_open" ]; then
      case "$line" in *"$_open"*) _open="" ;; esac
      continue
    fi
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in ''|\#*) continue ;; esac
    case "$line" in export[[:space:]]*) line="${line#export}"; line="${line#"${line%%[![:space:]]*}"}" ;; esac
    _key="${line%%[!A-Za-z0-9_]*}"
    _rest="${line#"$_key"}"
    _rest="${_rest#"${_rest%%[![:space:]]*}"}"
    case "$_rest" in =*|:*) ;; *) continue ;; esac
    _val="${_rest#?}"
    _val="${_val#"${_val%%[![:space:]]*}"}"
    case "$_val" in
      \"*|\'*|\`*) _q="${_val%"${_val#?}"}"; case "${_val#?}" in *"$_q"*) ;; *) _open="$_q" ;; esac ;;
    esac
    case "$_key" in ''|[0-9]*) continue ;; esac
    printf '%s\n' "$_key"
  done < "$_dir/.env.local"
}
