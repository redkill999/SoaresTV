#!/bin/sh
# healthcheck.sh — usable as a container HEALTHCHECK or an external monitor.
# Exits 0 when /health returns HTTP 200 with { "ok": true }, non-zero otherwise.
set -eu
URL="${1:-http://127.0.0.1:8787/health}"
BODY=$(curl -fsS --max-time 5 "$URL") || exit 1
echo "$BODY" | grep -q '"ok":true' || exit 2
echo "healthy: $BODY"
