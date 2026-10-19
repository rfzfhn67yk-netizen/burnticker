#!/bin/sh
# Probe the public Burnticker endpoints the uptime monitors watch (ops-2, 2026-10-12; docs/burnticker/OPS-EDGE.md "Uptime monitors").
# Read-only GETs, the same checks the monitors run, printed one per line. Exit 0 when every check passes, 1 otherwise.
#
#   sh scripts/ops/probe-burnticker.sh                  from any machine (the Mac is fine)
#   sh scripts/ops/probe-burnticker.sh --box            ON the Burnticker VPS as mct, from ~/meme-coin-trader: also walks the status chain
#                                                       (keeper unit → publish dir → publish timer → /var/www) and says which link broke
#   --base URL          the site (default https://burnticker.com)
#   --status-base URL   the status host (default https://status.burnticker.com)
#   --deficit-base URL  the $DEFICIT host (default https://deficit.burnticker.com)
#   --max-age SEC       how old status.json may be before the check fails (default 300; the keeper rewrites it about once a minute)
#
# Nothing secret is read or printed. In --box mode the log tails are passed through a filter that hides any api-key in a URL.
set -u
BASE="https://burnticker.com"; STATUS_BASE="https://status.burnticker.com"; DEFICIT_BASE="https://deficit.burnticker.com"; MAX_AGE=300; BOX=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --status-base) STATUS_BASE="$2"; shift 2 ;;
    --deficit-base) DEFICIT_BASE="$2"; shift 2 ;;
    --max-age) MAX_AGE="$2"; shift 2 ;;
    --box) BOX=1; shift ;;
    *) echo "unknown flag $1"; exit 2 ;;
  esac
done
command -v curl >/dev/null 2>&1 || { echo "curl is not installed"; exit 2; }
T=$(mktemp -d "${TMPDIR:-/tmp}/bt-probe.XXXXXX"); trap 'rm -rf "$T"' EXIT INT TERM
FAILS=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
info() { printf 'INFO  %s\n' "$*"; }

# get <url> → sets CODE, TIME; body in $T/body, headers in $T/head
get() {
  r=$(curl -s -m 20 -o "$T/body" -D "$T/head" -w '%{http_code} %{time_total}' "$1" 2>/dev/null) || r="000 0"
  CODE=${r%% *}; TIME=${r#* }
}
header() { grep -i "^$1:" "$T/head" 2>/dev/null | tail -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }
# seconds since an ISO time (node, else python3; empty when neither exists)
age_of() {
  if command -v node >/dev/null 2>&1; then node -e 'const t=Date.parse(process.argv[1]);console.log(Number.isFinite(t)?Math.round((Date.now()-t)/1000):"")' "$1"
  elif command -v python3 >/dev/null 2>&1; then python3 -c 'import sys,datetime;s=sys.argv[1].replace("Z","+00:00");print(round((datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(s)).total_seconds()))' "$1" 2>/dev/null
  fi
}

page() {   # page <label> <url>: 200 expected
  get "$2"
  if [ "$CODE" = 200 ]; then pass "$1  $2  200 in ${TIME}s"; else fail "$1  $2  HTTP $CODE (expected 200)"; fi
}
doc() {    # doc <label> <url> <schema>: 200 and the schema string in the body
  get "$2"
  if [ "$CODE" != 200 ]; then fail "$1  $2  HTTP $CODE (expected 200 with $3)"; return 1; fi
  if grep -q "\"$3\"" "$T/body"; then pass "$1  $2  200, $3, in ${TIME}s"; else fail "$1  $2  200 but the body does not name $3"; return 1; fi
}
fresh() {  # fresh <label>: the generatedAt of the last body is younger than MAX_AGE
  g=$(sed -n 's/.*"generatedAt": *"\([^"]*\)".*/\1/p' "$T/body" | head -1)
  [ -n "$g" ] || { fail "$1  no generatedAt in the document"; return; }
  a=$(age_of "$g")
  if [ -z "$a" ]; then info "$1  written at $g (no node or python3 here to work out its age)"
  elif [ "$a" -le "$MAX_AGE" ]; then pass "$1  written ${a}s ago (limit ${MAX_AGE}s)"
  else fail "$1  written ${a}s ago at $g (limit ${MAX_AGE}s): the keeper has stopped publishing"; fi
}

echo "probe $(date -u '+%Y-%m-%d %H:%M:%SZ')  base $BASE  status $STATUS_BASE  deficit $DEFICIT_BASE"
page "home        " "$BASE/"
if [ -n "$(header cf-ray)" ]; then info "the site answers through Cloudflare (cf-ray present)"; else info "the site answers directly, not through Cloudflare (no cf-ray header)"; fi
if [ -n "$(header content-security-policy-report-only)" ]; then info "a report-only content security policy is sent on /"; fi
page "app         " "$BASE/burnticker"
doc  "api         " "$BASE/api/burnticker/v1/current-status" "burnticker.current-status/v1" && {
  rl=$(header ratelimit-remaining); [ -n "$rl" ] && info "the API's rate limit has $rl requests left for this address (read bucket)"
}
page "status page " "$STATUS_BASE/"
doc  "status.json " "$STATUS_BASE/status.json" "burnticker.ops-status/v1" && fresh "status.json "
doc  "status apex " "$BASE/status/status.json" "burnticker.ops-status/v1" || true
page "deficit     " "$DEFICIT_BASE/"
get "$DEFICIT_BASE/status.json"; if [ "$CODE" = 200 ]; then pass "deficit json  $DEFICIT_BASE/status.json  200"; else fail "deficit json  $DEFICIT_BASE/status.json  HTTP $CODE"; fi

if [ "$BOX" = 1 ]; then
  echo "--- the status chain on this host (keeper → publish dir → publish timer → /var/www → Caddy)"
  cd "$(dirname "$0")/../.." || exit 2
  red() { sed -E 's/([?&](api-key|api_key|apikey|key|token)=)[^&" ]+/\1<hidden>/g'; }
  PUB="${BURNTICKER_PUBLISH_DIR:-data/burnticker-site}"; WWW="${BURNTICKER_WWW:-/var/www/burnticker}"
  if command -v systemctl >/dev/null 2>&1; then
    for u in mct-burnticker-keeper.service mct-burnticker-publish.timer mct-burnticker-web.service; do
      a=$(systemctl --user is-active "$u" 2>/dev/null); e=$(systemctl --user is-enabled "$u" 2>/dev/null)
      if [ "$a" = active ]; then pass "unit $u is active ($e)"; else fail "unit $u is ${a:-unknown} (${e:-not installed})"; fi
    done
    n=$(systemctl --user show mct-burnticker-keeper.service -p NRestarts --value 2>/dev/null); [ -n "$n" ] && [ "$n" != 0 ] && info "the keeper has restarted $n times since it was started (a restart loop means it exits at start; read its log)"
  fi
  for f in "$PUB/status/status.json" "$WWW/status/status.json"; do
    if [ -f "$f" ]; then
      m=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"); a=$(( $(date +%s) - m ))
      if [ "$a" -le "$MAX_AGE" ]; then pass "$f written ${a}s ago"; else fail "$f last written ${a}s ago"; fi
    else fail "$f does not exist"; fi
  done
  if [ -d "$WWW/status" ]; then
    if [ -w "$WWW/status" ]; then pass "$WWW/status is writable by $(id -un)"; else fail "$WWW/status is NOT writable by $(id -un) (owner: $(ls -ld "$WWW/status" | awk '{print $3":"$4}')); as root: chown -R mct:mct $WWW"; fi
  else fail "$WWW/status does not exist (sh scripts/ops/deploy-sites.sh --pages-only, as mct)"; fi
  [ -f logs/burnticker-keeper.log ] && { echo "--- last 8 lines of logs/burnticker-keeper.log"; tail -n 8 logs/burnticker-keeper.log | red | cut -c1-220; }
  [ -f logs/burnticker-publish.log ] && { echo "--- last 8 lines of logs/burnticker-publish.log"; tail -n 8 logs/burnticker-publish.log | red | cut -c1-220; }
fi

if [ "$FAILS" = 0 ]; then echo "all checks passed"; exit 0; fi
echo "$FAILS check(s) failed"; exit 1
