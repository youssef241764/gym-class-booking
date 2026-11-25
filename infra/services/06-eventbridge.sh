#!/usr/bin/env bash
# 06  EventBridge: bus gym-events, one rule per event flow, rule -> SQS queue
#   bash infra/services/06-eventbridge.sh            (safe to run again; run 05 first)
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint

step "Event bus gym-events"
awsl events create-event-bus --name gym-events >/dev/null 2>&1 || true
ok "gym-events"

step "Rules  (pattern files in infra/eventbridge/, targets are SQS queues)"
grep -v '^#' infra/eventbridge/rules.txt | while read -r rule queue; do
  [ -z "$rule" ] && continue
  RULE_ARN=$(awsl events put-rule --name "$rule" --event-bus-name gym-events \
    --event-pattern "file://infra/eventbridge/$rule.json" --state ENABLED --query RuleArn --output text)
  QURL=$(awsl sqs get-queue-url --queue-name "$queue" --query QueueUrl --output text)
  QARN=$(awsl sqs get-queue-attributes --queue-url "$QURL" --attribute-names QueueArn --query Attributes.QueueArn --output text)
  awsl events put-targets --rule "$rule" --event-bus-name gym-events --targets "Id=$queue-target,Arn=$QARN" >/dev/null
  # Queue policy: only EventBridge, and only this rule, may send to the queue.
  POLICY="{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Sid\\\":\\\"from-$rule\\\",\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":{\\\"Service\\\":\\\"events.amazonaws.com\\\"},\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"$QARN\\\",\\\"Condition\\\":{\\\"ArnEquals\\\":{\\\"aws:SourceArn\\\":\\\"$RULE_ARN\\\"}}}]}"
  printf '{"Policy":"%s"}' "$POLICY" > "$GEN/queue-policy.json"
  awsl sqs set-queue-attributes --queue-url "$QURL" --attributes "file://infra/.generated/queue-policy.json"
  ok "$rule -> $queue"
done
rm -f "$GEN/queue-policy.json"

step "Archive  (keeps every event for 7 days so it can be replayed)"
awsl events create-archive --archive-name gym-events-archive \
  --event-source-arn "arn:aws:events:$REGION:$ACCOUNT:event-bus/gym-events" --retention-days 7 >/dev/null 2>&1 || true
ok "gym-events-archive"
