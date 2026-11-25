#!/usr/bin/env bash
# Sends the saved test events of one service to its Lambda function on Floci (Lab 7, Part 6).
#   bash infra/invoke-events.sh booking-service
# Each file in services/<service>/events/ is one HTTP request in API Gateway format.
. "$(dirname "$0")/services/_lib.sh"; cd "$ROOT"
svc="${1:?Usage: bash infra/invoke-events.sh <service>}"
FN=$(fn_name "$svc")
mkdir -p out
for f in services/$svc/events/*.json; do
  n=$(basename "$f" .json)
  awsl lambda invoke --function-name "$FN" --payload "fileb://$f" out/$n.json >/dev/null
  printf '%-40s %s\n' "$n" "$(grep -o '"statusCode": *[0-9]*' out/$n.json)  $(cut -c1-120 out/$n.json | grep -o '\\"code\\":\\"[A-Z_]*' | head -1)"
done
