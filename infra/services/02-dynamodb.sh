#!/usr/bin/env bash
# 02  DynamoDB tables (definitions in infra/dynamodb/tables/*.json)
#   bash infra/services/02-dynamodb.sh               (safe to run again)
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint

step "DynamoDB tables  (on-demand billing, keys and indexes from the JSON files)"
for f in infra/dynamodb/tables/*.json; do
  t=$(basename "$f" .json)
  if awsl dynamodb describe-table --table-name "$t" >/dev/null 2>&1; then
    ok "exists  $t"
  else
    awsl dynamodb create-table --cli-input-json "file://$f" >/dev/null
    awsl dynamodb wait table-exists --table-name "$t"
    ok "created $t"
  fi
done

step "Time to live  (old login attempts, audit lines and notifications delete themselves)"
while read -r t attr; do
  [ -z "$t" ] && continue
  awsl dynamodb update-time-to-live --table-name "$t" \
    --time-to-live-specification "Enabled=true,AttributeName=$attr" >/dev/null 2>&1 || true
  ok "$t ($attr)"
done < infra/dynamodb/ttl.txt

step "Point-in-time recovery  (restore business tables after a mistake)"
while read -r t; do
  [ -z "$t" ] && continue
  awsl dynamodb update-continuous-backups --table-name "$t" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null 2>&1 || true
  ok "$t"
done < infra/dynamodb/pitr.txt
