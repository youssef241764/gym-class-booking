#!/usr/bin/env bash
# 08  CloudWatch: log groups, security metric filters, alarms -> SNS topic gym-alerts
#   bash infra/services/08-cloudwatch.sh             (safe to run again)
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint

step "SNS topic gym-alerts  (alarms publish here)"
TOPIC_ARN=$(awsl sns create-topic --name gym-alerts --query TopicArn --output text)
save_output ALARM_TOPIC_ARN "$TOPIC_ARN"
ok "$TOPIC_ARN"

step "Log groups (14 days) with metric filters  (a log line -> a number we can alarm on)"
for svc in $SERVICES; do
  for g in "/aws/lambda/gym-$svc" "/gym/$svc"; do
    awsl logs create-log-group --log-group-name "$g" >/dev/null 2>&1 || true
    awsl logs put-retention-policy --log-group-name "$g" --retention-in-days 14 >/dev/null 2>&1 || true
    while IFS='|' read -r metric pattern; do
      awsl logs put-metric-filter --log-group-name "$g" --filter-name "gym-$metric" \
        --filter-pattern "$pattern" \
        --metric-transformations "metricName=$metric,metricNamespace=GymBooking/Security,metricValue=1,defaultValue=0" >/dev/null 2>&1 || true
    done <<'FILTERS'
AccessDenied|{ $.event = "HTTP_403" }
AuthFailures|{ ($.event = "AUTH_FAILED") || ($.event = "AUTH_MISSING") || ($.event = "LOGIN_FAILED") }
ServerErrors|{ $.event = "UNHANDLED_ERROR" }
ValidationFailures|{ $.event = "VALIDATION_FAILED" }
InternalAccessDenied|{ $.event = "INTERNAL_ACCESS_DENIED" }
FILTERS
    ok "$g"
  done
done

step "Alarms  (5-minute windows)"
while IFS='|' read -r name ns metric threshold desc; do
  awsl cloudwatch put-metric-alarm --alarm-name "$name" --alarm-description "$desc" \
    --namespace "$ns" --metric-name "$metric" --statistic Sum --period 300 --evaluation-periods 1 \
    --threshold "$threshold" --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching --alarm-actions "$TOPIC_ARN" >/dev/null 2>&1 || true
  ok "$name  ($metric >= $threshold)"
done <<'ALARMS'
gym-access-denied-spike|GymBooking/Security|AccessDenied|5|Five or more 403 answers in 5 minutes (someone probing other users' data)
gym-auth-failure-spike|GymBooking/Security|AuthFailures|5|Five or more failed sign-ins in 5 minutes (password guessing)
gym-server-errors|GymBooking/Security|ServerErrors|1|Any unhandled server error
gym-internal-access-denied|GymBooking/Security|InternalAccessDenied|1|Someone called an /internal endpoint without the service key
gym-checkin-bruteforce|GymBooking|CheckInFailures|10|Ten or more wrong check-in codes in 5 minutes
ALARMS
