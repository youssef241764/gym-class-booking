#!/usr/bin/env bash
# 05  SQS queues, each with a dead-letter queue (DLQ) for messages that keep failing
#   bash infra/services/05-sqs.sh                    (safe to run again)
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint

step "SQS queues + DLQs  (encrypted, a message moves to the DLQ after 5 failed tries)"
for q in gym-class-events gym-booking-events gym-attendance-events gym-notifications; do
  DLQ_URL=$(awsl sqs create-queue --queue-name "$q-dlq" \
    --attributes MessageRetentionPeriod=1209600,SqsManagedSseEnabled=true --query QueueUrl --output text)
  DLQ_ARN=$(awsl sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)
  printf '{"VisibilityTimeout":"60","MessageRetentionPeriod":"345600","SqsManagedSseEnabled":"true","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}"}' "$DLQ_ARN" > "$GEN/sqs-attributes.json"
  QURL=$(awsl sqs create-queue --queue-name "$q" --attributes "file://infra/.generated/sqs-attributes.json" --query QueueUrl --output text)
  ok "$q (+ $q-dlq)"
done
rm -f "$GEN/sqs-attributes.json"
