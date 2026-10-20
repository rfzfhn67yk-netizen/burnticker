#!/bin/sh
# Entrypoint for mct-burnticker-backup (2026-10-16 prelaunch audit F-7: no backup existed anywhere). Fired every 6 hours by
# mct-burnticker-backup.timer; also safe to run by hand.
#
#   sh scripts/service/run-burnticker-backup.sh                              back up now
#   sh scripts/service/run-burnticker-backup.sh --list                       the backups on this host, newest last
#   sh scripts/service/run-burnticker-backup.sh --restore <file> --to <path> restore one backup into <path> (a NEW file; see below)
#
# What a run does, for each database in BURNTICKER_BACKUP_DBS (default: the registry data/burnticker.db, the $DEFICIT ledger
# data/burnkeeper.db, the mint key bank data/burnticker-mintbank.db and the held-swap records data/burnticker-swap-pending.db, or
# BURNTICKER_SWAP_PENDING_DB when that is set in the environment (HB-62, sixth audit 2026-10-19: a restore lacked them); a missing
# optional one is skipped and said):
#   1. `sqlite3 <db> ".backup <file>"`: SQLite's online backup API, safe while the keeper and the site write (never cp or rsync a live db)
#   2. `PRAGMA quick_check` on the copy: anything but "ok" fails the run
#   3. keeps the newest BURNTICKER_BACKUP_KEEP (default 14) copies of each database in data/backups/, mode 0600
#   4. copies this run's files off the box to BURNTICKER_BACKUP_DEST: `user@host:path` (scp, key-based, BatchMode), a local directory,
#      or `rclone:<remote>:<path>` (rclone copy). Unset: the copy is skipped and the log says so (the owner step, TODO-OWNER.md). The
#      mint key bank is NEVER copied off the box (its file holds sealed keys and stays on the host, mintBank.ts); it is kept here only.
#      The destination keeps BURNTICKER_BACKUP_OFFBOX_DAYS (default 30) days: older copies named by this script are removed there.
#   Each copy is switched to an ordinary journal and no -wal / -shm file is left beside it; rotation removes any it finds.
#   5. writes data/backups/last-backup.json ({ ok, at, files, offBox, error }); the keeper's unit check (ops/unitHealth.ts) raises
#      bt-backup-failed from it, and a failed run also leaves the unit failed (bt-unit-failed).
# NEVER an env file or a key file: a path naming .env, a key, a keypair or a secret is refused before anything is read.
# BURNTICKER_BACKUP_DEST is read from the environment, else from that ONE line of .env.local (no other line of the file is read).
#
# Restore (docs/burnticker/runbook.md, "Backups and restore"): the backup is checked first (quick_check), copied with the backup API
# into a temporary file beside <path>, checked again, then moved into place. <path> must not exist (move the old file aside first, with
# the unit that writes it stopped); the time taken is printed. The restore drill (test/burntickerBackup.test.ts) times it on a fixture.
set -eu
ROOT=${BURNTICKER_BACKUP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}
cd "$ROOT"
DIR=${BURNTICKER_BACKUP_DIR:-data/backups}
KEEP=${BURNTICKER_BACKUP_KEEP:-14}
DBS=${BURNTICKER_BACKUP_DBS:-data/burnticker.db data/burnkeeper.db data/burnticker-mintbank.db ${BURNTICKER_SWAP_PENDING_DB:-data/burnticker-swap-pending.db}}
REQUIRED=${BURNTICKER_BACKUP_REQUIRED:-data/burnticker.db}
stamp() { date -u '+%F %TZ'; }
say() { echo "[$(stamp)] $*"; }
# a time limit where coreutils has one (the box); the Mac has none, and runs the command as it is
limit() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; else shift; "$@"; fi; }
command -v sqlite3 >/dev/null 2>&1 || { say "backup FAILED: sqlite3 is not installed (apt install sqlite3)"; exit 2; }
case "$KEEP" in ''|*[!0-9]*) say "refusing: BURNTICKER_BACKUP_KEEP must be a number"; exit 2 ;; esac
OFFBOX_DAYS=${BURNTICKER_BACKUP_OFFBOX_DAYS:-30}
case "$OFFBOX_DAYS" in ''|*[!0-9]*) say "refusing: BURNTICKER_BACKUP_OFFBOX_DAYS must be a number"; exit 2 ;; esac
[ "$OFFBOX_DAYS" -ge 1 ] || { say "refusing: BURNTICKER_BACKUP_OFFBOX_DAYS must be at least 1"; exit 2; }
[ "$KEEP" -ge 1 ] || { say "refusing: BURNTICKER_BACKUP_KEEP must be at least 1"; exit 2; }

# every sqlite3 call below passes -cmd ".timeout 10000": it waits up to 10 s for a lock the keeper or the site holds (F-7 review)
# the first line of a command's error output, for the log
first_line() { printf '%s' "$1" | head -n 1 | tr -d '"\\' | head -c 200; }
# never an env file or a key file, whatever the list says
refused_path() { case "$1" in *.env*|*env.local*|*.key|*key.json|*keypair*|*secret*|*.[p]em|*id_rsa*|*id_ed2*) return 0 ;; *) return 1 ;; esac; }

if [ "${1:-}" = --list ]; then
  ls -1 "$DIR"/*.db 2>/dev/null | sort || true
  [ -f "$DIR/last-backup.json" ] && cat "$DIR/last-backup.json"
  exit 0
fi

if [ "${1:-}" = --restore ]; then
  FILE=${2:-}; [ "${3:-}" = --to ] || { echo "usage: $0 --restore <backup file> --to <path>"; exit 2; }; TO=${4:-}
  [ -n "$FILE" ] && [ -n "$TO" ] || { echo "usage: $0 --restore <backup file> --to <path>"; exit 2; }
  refused_path "$FILE" && { say "refusing: $FILE is not a database backup"; exit 2; }
  refused_path "$TO" && { say "refusing: $TO is not a database path"; exit 2; }
  [ -f "$FILE" ] || { say "restore FAILED: no such backup: $FILE"; exit 1; }
  [ -e "$TO" ] && { say "refusing: $TO exists. Stop the unit that writes it, move the file aside (mv $TO $TO.before-restore), then run this again."; exit 2; }
  # a leftover journal of the old file would be applied to the restored one when it is first opened (F-7 review)
  for j in "$TO-wal" "$TO-journal"; do [ -e "$j" ] && { say "refusing: $j exists. Move it aside with the old file (mv $j $j.before-restore), then run this again."; exit 2; }; done
  T0=$(date +%s)
  CHECK=$(sqlite3 -cmd ".timeout 10000" "$FILE" "PRAGMA quick_check;" 2>&1 || true)
  [ "$CHECK" = ok ] || { say "restore FAILED: the backup does not pass quick_check: $(printf '%s' "$CHECK" | head -c 200)"; exit 1; }
  mkdir -p "$(dirname "$TO")"
  TMP="$TO.restore-tmp.$$"
  rm -f "$TMP"
  if ! OUT=$(sqlite3 -cmd ".timeout 10000" "$FILE" ".backup '$TMP'" 2>&1); then rm -f "$TMP"; say "restore FAILED: the copy into $TMP did not finish: $(first_line "$OUT")"; exit 1; fi
  CHECK=$(sqlite3 -cmd ".timeout 10000" "$TMP" "PRAGMA quick_check;" 2>&1 || true)
  [ "$CHECK" = ok ] || { rm -f "$TMP"; say "restore FAILED: the restored copy does not pass quick_check"; exit 1; }
  chmod 600 "$TMP"
  mv "$TMP" "$TO"
  say "restored $FILE to $TO in $(( $(date +%s) - T0 )) s (quick_check ok)"
  exit 0
fi

[ -z "${1:-}" ] || { echo "usage: $0 [--list | --restore <file> --to <path>]"; exit 2; }

mkdir -p "$DIR"
chmod 700 "$DIR" 2>/dev/null || true
AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TAG=$(date -u +%Y%m%dT%H%M%SZ)
NEW=""; OFFBOX_FILES=""; ERR=""
for db in $DBS; do
  if refused_path "$db"; then ERR="refused a path that names an env or key file: $db"; say "backup FAILED: $ERR"; break; fi
  base=$(basename "$db" .db)
  if [ ! -f "$db" ]; then
    case " $REQUIRED " in *" $db "*) ERR="$db is missing"; say "backup FAILED: $ERR"; break ;; esac
    say "skipped $db: not on this host"; continue
  fi
  n=0; out="$DIR/$base-$TAG-000.db"
  while [ -e "$out" ]; do n=$((n + 1)); out="$DIR/$base-$TAG-$(printf '%03d' "$n").db"; done
  if ! OUT=$(sqlite3 -cmd ".timeout 10000" "$db" ".backup '$out'" 2>&1); then rm -f "$out"; ERR="the backup of $db did not finish: $(first_line "$OUT")"; say "backup FAILED: $ERR"; break; fi
  chmod 600 "$out"
  # A-15 (second audit 2026-10-18): the copy of a WAL database is a WAL database, and opening it (the check below) left -wal and -shm
  # files beside it that rotation never removed. The copy is switched to an ordinary rollback journal first, and any sidecar is removed.
  sqlite3 -cmd ".timeout 10000" "$out" "PRAGMA journal_mode=DELETE;" >/dev/null 2>&1 || true
  CHECK=$(sqlite3 -cmd ".timeout 10000" "$out" "PRAGMA quick_check;" 2>&1 || true)
  rm -f "$out-wal" "$out-shm" "$out-journal"
  if [ "$CHECK" != ok ]; then ERR="quick_check of the copy of $db: $(printf '%s' "$CHECK" | head -c 120 | tr -d '"\\\n')"; say "backup FAILED: $ERR"; break; fi
  say "backed up $db to $out ($(wc -c < "$out" | tr -d ' ') bytes, quick_check ok)"
  NEW="$NEW $out"
  case "$base" in *mintbank*) ;; *) OFFBOX_FILES="$OFFBOX_FILES $out" ;; esac
  # rotation: the newest KEEP copies of this database (names sort by time)
  COUNT=$(ls -1 "$DIR/$base"-[0-9]*.db 2>/dev/null | wc -l | tr -d ' ')
  if [ "$COUNT" -gt "$KEEP" ]; then ls -1 "$DIR/$base"-[0-9]*.db | sort | head -n $((COUNT - KEEP)) | while IFS= read -r old; do rm -f "$old" "$old-wal" "$old-shm" "$old-journal"; done; fi
  # and any sidecar whose backup is gone (left by runs before A-15)
  for s in "$DIR/$base"-[0-9]*.db-wal "$DIR/$base"-[0-9]*.db-shm "$DIR/$base"-[0-9]*.db-journal; do
    [ -e "$s" ] || continue
    case "$s" in *-wal) b=${s%-wal} ;; *-shm) b=${s%-shm} ;; *) b=${s%-journal} ;; esac
    [ -f "$b" ] || rm -f "$s"
  done
done

DEST=${BURNTICKER_BACKUP_DEST:-}
if [ -z "$DEST" ] && [ -f .env.local ]; then
  DEST=$(grep -E '^(export[[:space:]]+)?BURNTICKER_BACKUP_DEST=' .env.local 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d "\"'" || true)
fi
# F-7 re-review: surrounding spaces trimmed; a value that was set but is blank, or whose target (after rclone:) is empty or starts with
# "-" (an option to scp or rclone), is refused, never passed on
RAW_DEST=$DEST
DEST=$(printf '%s' "$DEST" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
DEST_TARGET=${DEST#rclone:}
OFFBOX="skipped"
if [ -n "$ERR" ]; then OFFBOX="not tried"
elif [ -n "$RAW_DEST" ] && { [ -z "$DEST" ] || [ -z "$DEST_TARGET" ]; }; then OFFBOX="refused"; ERR="refused the destination: BURNTICKER_BACKUP_DEST is set but names no place"; say "backup FAILED: $ERR"
elif [ -z "$DEST" ]; then say "off-box copy SKIPPED: BURNTICKER_BACKUP_DEST is not set (the owner names a destination: docs/burnticker/TODO-OWNER.md). This run copies nothing off the box; a pull from separate storage records itself in data/offbox-pull.json."
elif [ -z "$OFFBOX_FILES" ]; then OFFBOX="nothing to copy"
elif case "$DEST_TARGET" in -*) true ;; *) false ;; esac; then OFFBOX="refused"; ERR="refused the destination: BURNTICKER_BACKUP_DEST starts with -, which scp or rclone would read as an option"; say "backup FAILED: $ERR"
else
  case "$DEST" in
    rclone:*)
      R=$DEST_TARGET
      if command -v rclone >/dev/null 2>&1; then
        OK=1; for f in $OFFBOX_FILES; do limit 600 rclone copy --no-traverse "$f" "$R" >/dev/null 2>&1 || OK=0; done
      else OK=0; say "rclone is not installed"; fi ;;
    *)
      OK=1; limit 900 scp -q -p -o BatchMode=yes -o ConnectTimeout=20 $OFFBOX_FILES "$DEST" 2>/dev/null || OK=0 ;;
  esac
  if [ "$OK" = 1 ]; then OFFBOX="copied"; say "copied off the box:$OFFBOX_FILES"
  else OFFBOX="failed"; ERR="the off-box copy failed"; say "backup FAILED: $ERR (the copies on this host are fine)"; fi
  # A-15 (second audit 2026-10-18): the destination keeps BURNTICKER_BACKUP_OFFBOX_DAYS (default 30) days of copies. Only files named
  # the way this script names them (<db>-<UTC stamp>-<nnn>.db) and older than that are removed; anything else there is left alone.
  # A prune that fails is said in the log and never fails the run (the new copies are already there).
  if [ "$OK" = 1 ]; then
    PAT='*-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-[0-9][0-9][0-9].db'
    PRUNED=1
    case "$DEST" in
      rclone:*) limit 600 rclone delete --min-age "${OFFBOX_DAYS}d" --max-depth 1 --include "$PAT" "$DEST_TARGET" >/dev/null 2>&1 || PRUNED=0 ;;
      # a home-relative path (~/x, or ~) is made relative to the remote login directory, where ssh runs: inside the single quotes
      # below a ~ is never expanded (review, 2026-10-18)
      *:*) H=${DEST%%:*}; P=${DEST#*:}
           case "$P" in "~") P=. ;; "~/"*) P=${P#\~/} ;; esac
           [ -n "$P" ] || P=.
           limit 120 ssh -o BatchMode=yes -o ConnectTimeout=20 "$H" "find '$P' -maxdepth 1 -type f -name '$PAT' -mtime +$OFFBOX_DAYS -delete" >/dev/null 2>&1 || PRUNED=0 ;;
      *) find "$DEST" -maxdepth 1 -type f -name "$PAT" -mtime +"$OFFBOX_DAYS" -exec rm -f {} + 2>/dev/null || PRUNED=0 ;;
    esac
    if [ "$PRUNED" = 1 ]; then say "off-box copies older than $OFFBOX_DAYS days removed"; else say "WARNING: could not remove off-box copies older than $OFFBOX_DAYS days (the new copies are there)"; fi
  fi
fi

# F-7 review: when the last copy left the box (kept across runs) and since when a destination is set, for the keeper's 24-hour note
prev_field() { grep -o "\"$1\":\"[^\"]*\"" "$DIR/last-backup.json" 2>/dev/null | head -n 1 | cut -d'"' -f4; }
LAST_OFF=$(prev_field lastOffBoxAt || true); FIRST_DEST=$(prev_field firstConfiguredAt || true)
[ "$OFFBOX" = copied ] && LAST_OFF=$AT
if [ -n "$RAW_DEST" ]; then DESTV=true; FIRST_DEST=${FIRST_DEST:-$AT}; else DESTV=false; FIRST_DEST=""; fi
jstr() { if [ -n "$1" ]; then printf '"%s"' "$1"; else printf 'null'; fi; }
FILES=$(for f in $NEW; do printf '"%s",' "$f"; done | sed 's/,$//')
if [ -n "$ERR" ]; then OKV=false; ERRV="\"$(printf '%s' "$ERR" | tr -d '"\\\n' | head -c 300)\""; else OKV=true; ERRV=null; fi
printf '{"ok":%s,"at":"%s","files":[%s],"offBox":"%s","destConfigured":%s,"lastOffBoxAt":%s,"firstConfiguredAt":%s,"error":%s}\n' "$OKV" "$AT" "$FILES" "$OFFBOX" "$DESTV" "$(jstr "$LAST_OFF")" "$(jstr "$FIRST_DEST")" "$ERRV" > "$DIR/last-backup.json.tmp"
mv "$DIR/last-backup.json.tmp" "$DIR/last-backup.json"
[ -z "$ERR" ] || exit 1
say "backup done ($OFFBOX off the box)"
