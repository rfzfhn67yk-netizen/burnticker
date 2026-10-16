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
set -eu
cd "$(dirname "$0")/../.."
UNITS="mct-burnticker-keeper.service mct-burnticker-web.service mct-burnkeeper.service mct-burnticker-mintbank.service mct-burnticker-audit.service mct-burnticker-audit.timer mct-burnticker-publish.service mct-burnticker-publish.timer mct-burnticker-clonewatch.service mct-burnticker-clonewatch.timer mct-burnticker-synth.service mct-burnticker-synth.timer mct-burnticker-synthbank.service mct-burnticker-synthbank.timer"
ENABLE="mct-burnticker-keeper.service mct-burnticker-web.service mct-burnkeeper.service mct-burnticker-mintbank.service"
TIMERS="mct-burnticker-audit.timer mct-burnticker-publish.timer mct-burnticker-clonewatch.timer"
CHECK=0; START=0
for a in "$@"; do case "$a" in --check) CHECK=1 ;; --start) START=1 ;; *) echo "unknown flag $a"; exit 2 ;; esac; done
if [ "$(uname -s)" != "Linux" ]; then echo "systemd user units are a Linux thing; on the Mac nothing to install (the keepers run on the Burnticker VPS)"; exit 0; fi
DEST="$HOME/.config/systemd/user"
say() { printf '%s\n' "$*"; }
act() { if [ "$CHECK" = 1 ]; then say "  would: $*"; else say "  $*"; "$@"; fi; }

say "burnticker units → $DEST ($([ "$CHECK" = 1 ] && echo CHECK ONLY || echo applying))"
for d in logs data data/burnticker-site data/burnkeeper-site; do [ -d "$d" ] || act mkdir -p "$d"; done
[ -d "$DEST" ] || act mkdir -p "$DEST"
CHANGED=0
for u in $UNITS; do
  src="deploy/systemd/$u"
  [ -f "$src" ] || { say "  MISSING in the repo: $src"; exit 1; }
  if [ -f "$DEST/$u" ] && cmp -s "$src" "$DEST/$u"; then say "  unchanged: $u"; else act cp "$src" "$DEST/$u"; CHANGED=1; fi
done
# 2026-10-14: run as the service user without a session bus (sudo -u mct from root), systemctl --user cannot reach the bus; point it at
# the user's runtime dir so enable/start work either way
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -z "${XDG_RUNTIME_DIR:-}" ]; then export XDG_RUNTIME_DIR="/run/user/$(id -u)"; export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"; fi
if [ "$CHANGED" = 1 ] || [ "$CHECK" = 1 ]; then act systemctl --user daemon-reload; fi
for u in $ENABLE; do
  if systemctl --user is-enabled "$u" >/dev/null 2>&1; then say "  enabled: $u"; else act systemctl --user enable "$u"; fi
done
for t in $TIMERS; do
  if systemctl --user is-active "$t" >/dev/null 2>&1; then say "  timer active: $t"; else act systemctl --user enable --now "$t"; fi
done
if [ "$START" = 1 ]; then for u in $ENABLE; do act systemctl --user start "$u"; done; fi

# Linger: without it the user units die at logout and never start at boot. provision-burnticker-host.sh sets it; say so if it is off.
if command -v loginctl >/dev/null 2>&1; then
  if loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then say "  linger: yes"; else say "  linger: NO — as root: loginctl enable-linger $(id -un)"; fi
fi
[ -f .env.local ] && say "  .env.local: present (never read here)" || say "  .env.local: ABSENT — the units need BURNTICKER_* names from docs/burnticker/deploy.md before a start"
[ -f .next/BUILD_ID ] && say "  build: $(cat .next/BUILD_ID)" || say "  build: none — ship one with scripts/ops/deploy-burnticker-host.sh from the Mac before starting mct-burnticker-web"
say "next:  systemctl --user start mct-burnticker-web mct-burnticker-keeper mct-burnkeeper mct-burnticker-mintbank   ·   systemctl --user list-timers 'mct-burnticker-*'"
say "       tail -f logs/burnticker-keeper.log logs/burnticker-web.log logs/burnkeeper.log   ·   journalctl --user -u mct-burnticker-keeper -n 50"
