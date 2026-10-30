#!/bin/sh
# PRINT THE UFW RULES THAT ADMIT ONLY CLOUDFLARE TO PORTS 80 AND 443 (audit 2026-10-19 I-6). PRINTS ONLY: it never runs ufw, never needs
# root and changes nothing. The owner reads the output and applies it on the Burnticker VPS as root (docs/burnticker/runbook.md "Admit only
# Cloudflare at the origin"). The tailnet rules (SSH from the tailnet only, the tailnet interface) and everything else ufw holds are not touched.
#
#   sh scripts/ops/cloudflare-ufw-rules.sh                 fetch https://www.cloudflare.com/ips-v4 and /ips-v6 and print the rules
#   sh scripts/ops/cloudflare-ufw-rules.sh --from DIR      read DIR/ips-v4 and DIR/ips-v6 instead (a saved copy; the tests use this)
#   sh scripts/ops/cloudflare-ufw-rules.sh --remove-only   print only the commands that delete the Cloudflare rules again (the undo)
#
# Every line it reads must be an IPv4 or IPv6 CIDR; one bad line, an empty list or a failed fetch prints nothing but the reason and exits 1,
# so a half list is never printed. The list is also compared with CLOUDFLARE_RANGES in src/lib/burnticker/api/clientIp.ts (the ranges the
# API trusts for CF-Connecting-IP); a difference is printed as a warning, because both must be updated together.
set -eu
cd "$(dirname "$0")/../.."
FROM=""; REMOVE_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --remove-only) REMOVE_ONLY=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
done
TMP="$(mktemp -d "${TMPDIR:-/tmp}/cf-ufw.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
for v in 4 6; do
  if [ -n "$FROM" ]; then
    [ -f "$FROM/ips-v$v" ] || { echo "no $FROM/ips-v$v; nothing printed" >&2; exit 1; }
    cp "$FROM/ips-v$v" "$TMP/v$v"
  else
    curl -fsS --max-time 15 "https://www.cloudflare.com/ips-v$v" -o "$TMP/v$v" || { echo "could not fetch https://www.cloudflare.com/ips-v$v; nothing printed" >&2; exit 1; }
  fi
  # one CIDR per line; blank lines and trailing spaces are dropped, anything else that is not a CIDR is a refusal
  awk '{ sub(/[ \t\r]+$/, "") } NF' "$TMP/v$v" > "$TMP/c$v"
  if [ "$v" = 4 ]; then re='^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$'; else re='^[0-9a-fA-F]*:[0-9a-fA-F:]*/[0-9]{1,3}$'; fi
  bad=$(grep -Evc "$re" "$TMP/c$v" || true)
  [ "$bad" = 0 ] || { echo "ips-v$v has $bad line(s) that are not CIDRs (first: $(grep -Ev "$re" "$TMP/c$v" | head -1)); nothing printed" >&2; exit 1; }
  [ -s "$TMP/c$v" ] || { echo "ips-v$v is empty; nothing printed" >&2; exit 1; }
done
cat "$TMP/c4" "$TMP/c6" > "$TMP/all"

# the API's copy of the ranges (a warning only: the firewall rules follow Cloudflare's published list)
if [ -f src/lib/burnticker/api/clientIp.ts ]; then
  sed -n '/CLOUDFLARE_RANGES: readonly string\[\] = \[/,/\];/p' src/lib/burnticker/api/clientIp.ts | grep -oE '"[0-9a-fA-F:./]+"' | tr -d '"' | sort > "$TMP/app"
  sort "$TMP/all" > "$TMP/pub"
  if ! cmp -s "$TMP/app" "$TMP/pub"; then
    echo "# WARNING: Cloudflare's list differs from CLOUDFLARE_RANGES in src/lib/burnticker/api/clientIp.ts; update that list (and"
    echo "#          deploy/caddy/cloudflare.proposed.caddy) too. Only in Cloudflare's list: $(comm -13 "$TMP/app" "$TMP/pub" | tr '\n' ' ')"
    echo "#          Only in the app's list: $(comm -23 "$TMP/app" "$TMP/pub" | tr '\n' ' ')"
  fi
fi

N=$(wc -l < "$TMP/all" | tr -d ' ')
if [ "$REMOVE_ONLY" = 1 ]; then
  echo "# Undo: delete the $N Cloudflare rules (run as root). Put the public rules back first if you want the origin open again:"
  echo "#   ufw allow 80/tcp && ufw allow 443/tcp"
  while IFS= read -r c; do echo "ufw delete allow proto tcp from $c to any port 80,443"; done < "$TMP/all"
  exit 0
fi
echo "# Admit only Cloudflare to ports 80 and 443 on this host: $N ranges from Cloudflare's published lists, read $(date -u +%Y-%m-%dT%H:%MZ)."
echo "# Run as root on the Burnticker VPS, in this order. The SSH rule (22 from the tailnet only) and the tailnet interface rule are not touched."
echo "# 1. allow each Cloudflare range first, so the site never has a moment with no way in:"
while IFS= read -r c; do echo "ufw allow proto tcp from $c to any port 80,443 comment 'cloudflare'"; done < "$TMP/all"
echo "# 2. then remove the rules that admit everyone (ufw prints 'Could not delete non-existent rule' for any that is already gone):"
echo "ufw delete allow 80/tcp"
echo "ufw delete allow 443/tcp"
echo "# 3. check: the list shows SSH from the tailnet, the tailnet interface, and the Cloudflare ranges on 80,443; nothing else on 80 or 443"
echo "ufw status numbered"
