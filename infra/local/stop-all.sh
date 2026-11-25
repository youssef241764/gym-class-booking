#!/bin/sh
# Stops anything still running from an earlier start (emulator on 4566, services on
# 3001-3004, website on 8080), so a fresh start does not hit "port already in use".
#   sh infra/local/stop-all.sh
for p in 4566 3001 3002 3003 3004 8080; do
  pids=$(lsof -ti tcp:$p -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; echo "stopped what was running on port $p"; fi
done
exit 0
