#!/bin/sh
# Install (or refresh) the BURNTICKER set as systemd USER units for the current user — on the dedicated Burnticker VPS, as `mct`,
# from the repo:  sh scripts/ops/install-burnticker-units.sh [--check] [--start]
#
# Idempotent: copies only the units listed below (NOT deploy/install-vps.sh's whole set — no trading arm, collector or funding runner
# ever runs on this host), reloads, enables the keepers + the web unit and enables+starts the two timers. The keepers and the web unit
# are NOT started unless --start is given: the first start wants .env.local and a shipped build in place (docs/burnticker/deploy.md).
#   --check   print what would change and exit 0; touch nothing
#   --start   also start mct-burnticker-web, mct-burnticker-keeper, mct-burnkeeper and mct-burnticker-mintbank after enabling
# mct-burnticker-mintbank (2026-10-14 night) grinds the burn-ending mint keys the launch route hands out; it refuses to start (exit 2, not
# retried) until BURNTICKER_MINT_BANK_KEY is in the host's env file (docs/burnticker/deploy.md, "The mint key bank").
# mct-burnticker-synth.timer (2026-10-15, the nightly synthetic creator) is copied but NOT enabled here: it needs .env.devnet-synth and
# Chrome first (docs/burnticker/SYNTHETIC-CREATOR.md); then `systemctl --user enable --now mct-burnticker-synth.timer`.
# mct-burnticker-synthbank.timer (2026-10-15, the synthetic creator's devnet mint bank) is copied but NOT enabled either: it needs
# BURNTICKER_SYNTH_BANK_KEY in devnet-synth.env first; then `systemctl --user enable --now mct-burnticker-synthbank.timer`.
# mct-burnticker-backup.timer (2026-10-16, audit F-7) is enabled and started here: every 6 hours a sqlite .backup of the registry, the
# $DEFICIT ledger and the mint key bank into data/backups/ (keep 14, quick_check), copied off the box to BURNTICKER_BACKUP_DEST when the
# owner has named one (until then the log says the off-box copy is skipped). Needs the sqlite3 CLI (apt install sqlite3).
# mct-burnticker-web-probe.timer (2026-10-19, audit I-11 / B-4) is enabled and started here: every 5 minutes one GET of the public
# current-status through Cloudflare (scripts/service/burnticker-web-probe.sh), a ping to BURNTICKER_WEB_HEARTBEAT_URL (Healthchecks.io) on a
# good answer and <url>/fail otherwise. Until the owner sets the URL it makes no request and logs "skipped" once a day.
# mct-burnticker-logrotate.timer (2026-10-18, audit A-32) is enabled and started here: daily, logs/*.log rotated (keep 14, compressed,
# copytruncate) by the service user's own logrotate run. The config is deploy/logrotate/burnticker with this directory, the user and
# its group filled in (scripts/ops/render-logrotate.mjs), checked with `logrotate -d`, written to ~/.config/burnticker/logrotate.conf;
# its state file is ~/.local/state/burnticker-logrotate.status. Without /usr/sbin/logrotate the install STOPS before changing anything
# (apt install logrotate; Ubuntu has it).
set -eu
cd "$(dirname "$0")/../.."
UNITS="mct-burnticker-keeper.service mct-burnticker-web.service mct-burnkeeper.service mct-burnticker-mintbank.service mct-burnticker-audit.service mct-burnticker-audit.timer mct-burnticker-publish.service mct-burnticker-publish.timer mct-burnticker-clonewatch.service mct-burnticker-clonewatch.timer mct-burnticker-backup.service mct-burnticker-backup.timer mct-burnticker-web-probe.service mct-burnticker-web-probe.timer mct-burnticker-logrotate.service mct-burnticker-logrotate.timer mct-burnticker-synth.service mct-burnticker-synth.timer mct-burnticker-synthbank.service mct-burnticker-synthbank.timer"
ENABLE="mct-burnticker-keeper.service mct-burnticker-web.service mct-burnkeeper.service mct-burnticker-mintbank.service"
TIMERS="mct-burnticker-audit.timer mct-burnticker-publish.timer mct-burnticker-clonewatch.timer mct-burnticker-backup.timer mct-burnticker-web-probe.timer mct-burnticker-logrotate.timer"
# --defer-timers (continuous audit run 2, HB-24): enable a timer that is not running yet but do not start it. The deploy installs the units
# from the NEW release before the release link is switched, so a timer added by this release would fire against the OLD tree, where its
# script does not exist yet (publish 92: mct-burnticker-web-probe failed four times and raised bt-unit-failed). The deploy runs this
# script again after the switch, without the flag, and that run starts it.
CHECK=0; START=0; DEFER_TIMERS=0
for a in "$@"; do case "$a" in --check) CHECK=1 ;; --start) START=1 ;; --defer-timers) DEFER_TIMERS=1 ;; *) echo "unknown flag $a"; exit 2 ;; esac; done
if [ "$(uname -s)" != "Linux" ]; then echo "systemd user units are a Linux thing; on the Mac nothing to install (the keepers run on the Burnticker VPS)"; exit 0; fi
DEST="$HOME/.config/systemd/user"
say() { printf '%s\n' "$*"; }
act() { if [ "$CHECK" = 1 ]; then say "  would: $*"; else say "  $*"; "$@"; fi; }

say "burnticker units → $DEST ($([ "$CHECK" = 1 ] && echo CHECK ONLY || echo applying))"
# the log rotation timer runs /usr/sbin/logrotate: without it every daily run would fail, so the install stops here, before any change
if [ ! -x /usr/sbin/logrotate ]; then say "STOP: /usr/sbin/logrotate is not installed, and mct-burnticker-logrotate needs it. As root: apt install logrotate, then run this again. Nothing was changed."; exit 1; fi
for d in logs data data/burnticker-site data/burnkeeper-site data/backups; do [ -d "$d" ] || act mkdir -p "$d"; done
[ -d "$DEST" ] || act mkdir -p "$DEST"
CHANGED=0
for u in $UNITS; do
  src="deploy/systemd/$u"
  [ -f "$src" ] || { say "  MISSING in the repo: $src"; exit 1; }
  if [ -f "$DEST/$u" ] && cmp -s "$src" "$DEST/$u"; then say "  unchanged: $u"; else act cp "$src" "$DEST/$u"; CHANGED=1; fi
done
# the log rotation config: the repo's template with this directory (logrotate wants absolute paths), the service user and its group
# filled in as plain text by render-logrotate.mjs (never sed: a `&`, `|` or `\` in the path would be rewritten), checked with
# `logrotate -d` (reads and reports only; a scratch state file) before it replaces anything, and the state file's directory
# BT_UNITS_ROOT (L-5, 2026-10-19): the deploy installs from the new release directory but names the release LINK here, so the config
# never points into a release that a later prune removes
LR_DEST="$HOME/.config/burnticker/logrotate.conf"
LR_NEW=$(mktemp); LR_STATE=$(mktemp)
node scripts/ops/render-logrotate.mjs deploy/logrotate/burnticker "${BT_UNITS_ROOT:-$(pwd)}" "$(id -un)" "$(id -gn)" > "$LR_NEW" || { rm -f "$LR_NEW" "$LR_STATE"; say "STOP: the log rotation config could not be written for this directory (above)"; exit 1; }
if ! /usr/sbin/logrotate -d --state "$LR_STATE" "$LR_NEW" > "$LR_NEW.check" 2>&1 || grep -qi '^error' "$LR_NEW.check"; then
  sed 's/^/    /' "$LR_NEW.check" | tail -15; rm -f "$LR_NEW" "$LR_NEW.check" "$LR_STATE"
  say "STOP: logrotate -d rejected the rendered config (above); nothing was replaced"; exit 1
fi
say "  logrotate -d: the rendered config is valid"
rm -f "$LR_NEW.check" "$LR_STATE"
if [ -f "$LR_DEST" ] && cmp -s "$LR_NEW" "$LR_DEST"; then say "  unchanged: $LR_DEST"; else
  [ -d "$(dirname "$LR_DEST")" ] || act mkdir -p "$(dirname "$LR_DEST")"
  act cp "$LR_NEW" "$LR_DEST"
fi
rm -f "$LR_NEW"
[ -d "$HOME/.local/state" ] || act mkdir -p "$HOME/.local/state"
# 2026-10-14: run as the service user without a session bus (sudo -u mct from root), systemctl --user cannot reach the bus; point it at
# the user's runtime dir so enable/start work either way
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -z "${XDG_RUNTIME_DIR:-}" ]; then export XDG_RUNTIME_DIR="/run/user/$(id -u)"; export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"; fi
if [ "$CHANGED" = 1 ] || [ "$CHECK" = 1 ]; then act systemctl --user daemon-reload; fi
for u in $ENABLE; do
  if systemctl --user is-enabled "$u" >/dev/null 2>&1; then say "  enabled: $u"; else act systemctl --user enable "$u"; fi
done
for t in $TIMERS; do
  if systemctl --user is-active "$t" >/dev/null 2>&1; then say "  timer active: $t"
  elif [ "$DEFER_TIMERS" = 1 ]; then act systemctl --user enable "$t"; say "  deferred: $t starts after the release link is switched"
  else act systemctl --user enable --now "$t"; fi
done
if [ "$START" = 1 ]; then for u in $ENABLE; do act systemctl --user start "$u"; done; fi

# Linger: without it the user units die at logout and never start at boot. provision-burnticker-host.sh sets it; say so if it is off.
if command -v loginctl >/dev/null 2>&1; then
  if loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then say "  linger: yes"; else say "  linger: NO — as root: loginctl enable-linger $(id -un)"; fi
fi
[ -f .env.local ] && say "  .env.local: present (never read here)" || say "  .env.local: ABSENT — the units need BURNTICKER_* names from docs/burnticker/deploy.md before a start"
command -v curl >/dev/null 2>&1 && say "  curl: present (the web probe needs it)" || say "  curl: ABSENT — as root: apt install curl (mct-burnticker-web-probe cannot probe without it)"
command -v sqlite3 >/dev/null 2>&1 && say "  sqlite3: present (the backup timer needs it)" || say "  sqlite3: ABSENT — as root: apt install sqlite3 (mct-burnticker-backup fails without it)"
[ -f .next/BUILD_ID ] && say "  build: $(cat .next/BUILD_ID)" || say "  build: none — ship one with scripts/ops/deploy-burnticker-host.sh from the Mac before starting mct-burnticker-web"
say "next:  systemctl --user start mct-burnticker-web mct-burnticker-keeper mct-burnkeeper mct-burnticker-mintbank   ·   systemctl --user list-timers 'mct-burnticker-*'"
say "       tail -f logs/burnticker-keeper.log logs/burnticker-web.log logs/burnkeeper.log   ·   journalctl --user -u mct-burnticker-keeper -n 50"
