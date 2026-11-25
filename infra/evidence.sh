#!/usr/bin/env bash
# Prints the terminal evidence for the report (evidence/README.md items 1, 2, 9 and 15).
# Usage:  bash infra/evidence.sh [versions|routes|logs|all]
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/infra/services/_lib.sh"
WHAT="${1:-all}"

versions() {
  step "Tool versions"
  printf 'node   %s\n' "$(node -v)"
  printf 'npm    %s\n' "$(npm -v)"
  printf 'git    %s\n' "$(git --version)"
  printf 'aws    %s\n' "$(awsl --version 2>&1)"
  printf 'docker %s\n' "$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'not running')"
  step "Floci identity (awsl sts get-caller-identity)"
  awsl sts get-caller-identity --output table
}

routes() {
  step "API Gateway HTTP APIs"
  awsl apigatewayv2 get-apis --query 'Items[].[Name,ApiId,ProtocolType]' --output table
  for svc in identity booking-service; do
    API_ID=$(awsl apigatewayv2 get-apis --query "Items[?Name=='gym-$svc-api'].ApiId | [0]" --output text)
    step "Routes of gym-$svc-api ($API_ID)"
    awsl apigatewayv2 get-routes --api-id "$API_ID" --query 'sort_by(Items,&RouteKey)[].[RouteKey,Target]' --output table
    step "Stage of gym-$svc-api"
    awsl apigatewayv2 get-stages --api-id "$API_ID" --query 'Items[].[StageName,AutoDeploy,DefaultRouteSettings.ThrottlingRateLimit,DefaultRouteSettings.ThrottlingBurstLimit]' --output table
  done
}

logs() {
  step "Security events in CloudWatch Logs, last hour (LOGIN_FAILED, LOGIN_THROTTLED, HTTP_403)"
  START=$(( ($(date +%s) - 3600) * 1000 ))
  for group in /aws/lambda/gym-identity /aws/lambda/gym-booking-service /aws/lambda/gym-class-service /aws/lambda/gym-attendance-service; do
    for term in LOGIN_FAILED LOGIN_THROTTLED HTTP_403; do
      N=$(awsl logs filter-log-events --log-group-name "$group" --start-time "$START" --filter-pattern "\"$term\"" --query 'length(events)' --output text 2>/dev/null || echo 0)
      printf '  %-38s %-16s %s\n' "$group" "$term" "$N"
    done
  done
  step "Sample lines from /aws/lambda/gym-identity (one JSON line per request, no bodies or tokens)"
  awsl logs filter-log-events --log-group-name /aws/lambda/gym-identity --start-time "$START" \
    --query 'events[-8:].message' --output text | tr '\t' '\n' | cut -c1-220
}

case "$WHAT" in
  versions) versions ;;
  routes) routes ;;
  logs) logs ;;
  all) versions; routes; logs ;;
  *) echo "usage: bash infra/evidence.sh [versions|routes|logs|all]"; exit 1 ;;
esac
