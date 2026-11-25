#!/usr/bin/env bash
# Empties all gym-* tables and adds the demo data again (same start for every demo or test run).
#   bash infra/reset-data.sh
set -e
. "$(dirname "$0")/services/_lib.sh"; cd "$ROOT"; check_endpoint
step "Delete the gym-* tables"
for f in infra/dynamodb/tables/*.json; do
  t=$(basename "$f" .json)
  if awsl dynamodb delete-table --table-name "$t" >/dev/null 2>&1; then
    awsl dynamodb wait table-not-exists --table-name "$t"; ok "deleted $t"
  fi
done
bash infra/services/02-dynamodb.sh
bash infra/services/09-seed.sh
