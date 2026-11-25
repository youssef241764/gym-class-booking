#!/usr/bin/env bash
# Checks the Floci deployment and says how to fix anything that fails (like check-lab7.sh).
#   bash infra/check-deployment.sh
. "$(dirname "$0")/services/_lib.sh"; cd "$ROOT"
PASS=0; FAILED=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
nope() { printf '  \033[31mFAIL\033[0m %s\n       fix: %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }

step "Floci"
ACC=$(awsl sts get-caller-identity --query Account --output text 2>/dev/null)
[ "$ACC" = "$ACCOUNT" ] && pass "Floci answers on $ENDPOINT (account $ACC)" \
  || nope "Floci does not answer" "docker compose -f infra/floci/docker-compose.yml up -d"

step "Data, identity and permissions"
N=$(awsl dynamodb list-tables --query 'length(TableNames[?starts_with(@, `gym-`)])' --output text 2>/dev/null)
[ "$N" -ge 13 ] 2>/dev/null && pass "$N DynamoDB tables gym-*" || nope "DynamoDB tables missing ($N of 13)" "bash infra/services/02-dynamodb.sh"
[ -n "$COGNITO_USER_POOL_ID" ] && awsl cognito-idp describe-user-pool --user-pool-id "$COGNITO_USER_POOL_ID" >/dev/null 2>&1 \
  && pass "Cognito user pool $COGNITO_USER_POOL_ID" || nope "Cognito user pool missing" "bash infra/services/03-cognito.sh"
for svc in $SERVICES; do
  A=$(awsl iam list-attached-role-policies --role-name "gym-$svc-role" --query 'AttachedPolicies[].PolicyName' --output text 2>/dev/null)
  case "$A" in *"gym-$svc-access"*) pass "role gym-$svc-role has only policy gym-$svc-access" ;;
    *) nope "role gym-$svc-role / policy gym-$svc-access" "bash infra/services/07-iam.sh" ;; esac
done

step "Lambda + API Gateway (one per service)"
for svc in $SERVICES; do
  FN=$(fn_name "$svc"); KEY=$(api_key "$svc"); eval "URL=\${${KEY}_API_URL:-}"
  S=$(awsl lambda get-function --function-name "$FN" --query Configuration.State --output text 2>/dev/null)
  [ "$S" = "Active" ] && pass "$FN is Active" || nope "$FN not Active ($S)" "bash infra/deploy-backend.sh $svc"
  if [ -z "$URL" ]; then nope "no API URL for $svc" "bash infra/deploy-backend.sh $svc"; continue; fi
  H=$(curl -s --max-time 30 "$URL/api/health")
  case "$H" in *'"runtime":"lambda"'*) pass "T1 $svc GET /api/health answers runtime lambda" ;;
    *) nope "T1 $svc /api/health ($H)" "aws logs: awsl logs tail /aws/lambda/$FN --since 10m" ;; esac
done

step "API behaviour (identity and booking APIs)"
if [ -n "$IDENTITY_API_URL" ]; then
  B=$(curl -s --max-time 30 -X POST -H 'content-type: application/json' -d '{"email":"not-an-email"}' "$IDENTITY_API_URL/api/auth/login")
  case "$B" in *VALIDATION_FAILED*) pass "T2 invalid login body -> 400 VALIDATION_FAILED" ;; *) nope "T2 validation ($B)" "check services/identity/controllers/users.js" ;; esac
  B=$(curl -s --max-time 30 -X DELETE "$IDENTITY_API_URL/api/health")
  case "$B" in *'"message":"Not Found"'*|*'Not Found'*) pass "T3 DELETE /api/health -> 404 from API Gateway (route not listed)" ;; *) nope "T3 unknown route ($B)" "routes come from services/*/infra/api-routes.txt" ;; esac
fi
if [ -n "$BOOKINGS_API_URL" ]; then
  C=$(code "$BOOKINGS_API_URL/api/bookings/mine")
  [ "$C" = "401" ] && pass "T4 GET /api/bookings/mine without a token -> 401" || nope "T4 expected 401, got $C" "auth.authenticate in services/booking-service/routes/bookings.js"
  C=$(code -X POST -H 'content-type: application/json' -d '{"classIds":[]}' "$BOOKINGS_API_URL/internal/booking-counts")
  [ "$C" = "404" ] && pass "T5 /internal/* is not reachable from outside (404)" || nope "T5 /internal answered $C" "remove /internal routes from services/*/infra/api-routes.txt"
  O=$(curl -s -D - -o /dev/null --max-time 30 -X OPTIONS -H 'Origin: http://localhost:4566' -H 'Access-Control-Request-Method: POST' "$BOOKINGS_API_URL/api/bookings" | tr -d '\r' | grep -i '^access-control-allow-origin')
  case "$O" in *localhost:4566*) pass "T6 OPTIONS from our website -> $O" ;; *) nope "T6 CORS for http://localhost:4566 ($O)" "CORS_ORIGINS on the Lambda function" ;; esac
  R=$(curl -s -D - -o /dev/null --max-time 30 -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' "$BOOKINGS_API_URL/api/bookings" | tr -d '\r')
  O=$(printf '%s\n' "$R" | grep -i '^access-control-allow-origin')
  if [ -z "$R" ]; then nope "T7 the booking API did not answer" "bash infra/deploy-backend.sh booking-service"
  elif [ -z "$O" ]; then pass "T7 OPTIONS from evil.example -> no Access-Control-Allow-Origin"
  else nope "T7 CORS allows evil.example" "CORS_ORIGINS must list only our website"; fi
fi

step "Website on S3"
W="${ENDPOINT%/}/gym-frontend"
[ "$(code "$W/index.html")" = "200" ] && pass "index.html is served" || nope "index.html not served" "bash infra/deploy-frontend.sh"
CFG=$(curl -s --max-time 10 "$W/js/config.js")
if [ -n "$IDENTITY_API_URL" ] && printf '%s' "$CFG" | grep -q "$IDENTITY_API_URL"; then pass "the uploaded config.js points at your identity API"
else nope "config.js does not contain $IDENTITY_API_URL" "bash infra/deploy-frontend.sh"; fi
C=$(code "$W/.env"); [ "$C" != "200" ] && pass "no .env in the website (answer $C)" || nope ".env is public!" "delete it: awsl s3 rm s3://gym-frontend/.env"
C=$(code "${ENDPOINT%/}/gym-reports/reports/"); [ "$C" != "200" ] && pass "gym-reports is private (answer $C)" || nope "gym-reports is readable" "bash infra/services/04-s3.sh"

echo
echo "Result: $PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
