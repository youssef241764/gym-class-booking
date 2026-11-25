#!/usr/bin/env bash
# Deploys ONE service (or all) to Lambda + API Gateway on Floci, the Lab 7 way:
#   1. npm install && npm run zip           -> services/<service>/lambda.zip
#   2. aws lambda create-function / update-function-code
#   3. aws apigatewayv2: HTTP API, Lambda integration, the routes in services/<service>/infra/api-routes.txt,
#      stage $default with auto-deploy, and permission for the API to call the function
#
#   bash infra/deploy-backend.sh booking-service      # each owner deploys their own service
#   bash infra/deploy-backend.sh all                  # all four
set -e
. "$(dirname "$0")/services/_lib.sh"; cd "$ROOT"; check_endpoint
[ -z "$COGNITO_USER_POOL_ID" ] && { fail "Run bash infra/setup-all.sh first"; exit 1; }

TARGET="${1:-}"
if [ -z "$TARGET" ]; then echo "Usage: bash infra/deploy-backend.sh <identity|class-service|booking-service|attendance-service|all>"; exit 1; fi
[ "$TARGET" = "all" ] && TARGET="$SERVICES"
RUNTIME="${LAMBDA_RUNTIME:-nodejs24.x}"
WEBSITE_ORIGIN="${WEBSITE_ORIGIN:-http://localhost:4566}"
EP_PORT=$(echo "$ENDPOINT" | sed -E 's#.*:([0-9]+)/?$#\1#')

deploy_one() {
  svc="$1"
  FN=$(fn_name "$svc")
  ROLE_ARN="arn:aws:iam::$ACCOUNT:role/gym-$svc-role"
  KEY=$(api_key "$svc")

  step "$svc  1/3  zip the code  (cd services/$svc && npm install && npm run zip)"
  (cd "services/$svc" && npm install --no-audit --no-fund --loglevel=error && npm run zip --silent)
  ok "services/$svc/lambda.zip"

  step "$svc  2/3  Lambda function $FN  ($RUNTIME, handler lambda.handler, timeout 20 s)"
  # Settings for the cloud copy. No keys: on Lambda the IAM role gives permission.
  printf '{"Variables":{"NODE_ENV":"production","SERVICE_NAME":"%s","CORS_ORIGINS":"%s","COGNITO_USER_POOL_ID":"%s","COGNITO_CLIENT_ID":"%s","LOG_GROUP_NAME":"/gym/%s","REPORTS_KMS_KEY_ID":"%s","PUBLIC_AWS_ENDPOINT_URL":"%s","CLASS_SERVICE_FUNCTION":"gym-class-service","BOOKING_SERVICE_FUNCTION":"gym-booking-service","ATTENDANCE_SERVICE_FUNCTION":"gym-attendance-service","EMAIL_SENDER_ADDRESS":"%s","RATE_LIMIT_MAX":"%s"}}' \
    "$svc" "$WEBSITE_ORIGIN" "$COGNITO_USER_POOL_ID" "$COGNITO_CLIENT_ID" "$svc" "$KMS_KEY_ARN" "$ENDPOINT" "${EMAIL_SENDER_ADDRESS:-no-reply@example.com}" "${RATE_LIMIT_MAX:-300}" \
    > "$GEN/lambda-env-$svc.json"
  if awsl lambda get-function --function-name "$FN" >/dev/null 2>&1; then
    awsl lambda update-function-code --function-name "$FN" --zip-file "fileb://services/$svc/lambda.zip" >/dev/null
    awsl lambda wait function-updated-v2 --function-name "$FN" 2>/dev/null || sleep 3
    awsl lambda update-function-configuration --function-name "$FN" --role "$ROLE_ARN" --timeout 20 --memory-size 256 \
      --environment "file://infra/.generated/lambda-env-$svc.json" >/dev/null
    awsl lambda wait function-updated-v2 --function-name "$FN" 2>/dev/null || sleep 3
    ok "updated $FN"
  else
    awsl lambda create-function --function-name "$FN" --runtime "$RUNTIME" --handler lambda.handler \
      --role "$ROLE_ARN" --zip-file "fileb://services/$svc/lambda.zip" --timeout 20 --memory-size 256 \
      --environment "file://infra/.generated/lambda-env-$svc.json" \
      --description "Gym Class Booking - $svc" --tags "project=gym-class-booking,service=$svc" >/dev/null
    awsl lambda wait function-active-v2 --function-name "$FN" 2>/dev/null || sleep 5
    ok "created $FN"
  fi

  # Background work: SQS messages and the 15-minute schedule also run on Lambda.
  case "$svc" in
    class-service) QUEUES="gym-class-events" ;;
    booking-service) QUEUES="gym-booking-events gym-notifications" ;;
    attendance-service) QUEUES="gym-attendance-events" ;;
    *) QUEUES="" ;;
  esac
  for q in $QUEUES; do
    QURL=$(awsl sqs get-queue-url --queue-name "$q" --query QueueUrl --output text)
    QARN=$(awsl sqs get-queue-attributes --queue-url "$QURL" --attribute-names QueueArn --query Attributes.QueueArn --output text)
    N=$(awsl lambda list-event-source-mappings --function-name "$FN" --event-source-arn "$QARN" \
          --query 'length(EventSourceMappings)' --output text 2>/dev/null || echo 0)
    if [ "$N" = "0" ] || [ "$N" = "None" ]; then
      awsl lambda create-event-source-mapping --function-name "$FN" --event-source-arn "$QARN" \
        --batch-size 10 --function-response-types ReportBatchItemFailures >/dev/null
    fi
    ok "SQS $q -> $FN"
  done
  if [ "$svc" = "attendance-service" ]; then
    RULE_ARN=$(awsl events put-rule --name gym-attendance-autoclose --schedule-expression "rate(15 minutes)" \
      --state ENABLED --description "Close sessions trainers forgot to close" --query RuleArn --output text)
    FN_ARN=$(awsl lambda get-function --function-name "$FN" --query Configuration.FunctionArn --output text)
    printf '[{"Id":"attendance-lambda","Arn":"%s","Input":"{\\"action\\":\\"scheduled-task\\",\\"task\\":\\"auto-close\\"}"}]' "$FN_ARN" > "$GEN/schedule-targets.json"
    awsl events put-targets --rule gym-attendance-autoclose --targets "file://infra/.generated/schedule-targets.json" >/dev/null
    awsl lambda add-permission --function-name "$FN" --statement-id events-autoclose --action lambda:InvokeFunction \
      --principal events.amazonaws.com --source-arn "$RULE_ARN" >/dev/null 2>&1 || true
    ok "EventBridge schedule rate(15 minutes) -> $FN"
  fi

  step "$svc  3/3  API Gateway HTTP API $FN-api"
  API_ID=$(awsl apigatewayv2 get-apis --query "Items[?Name=='$FN-api'].ApiId | [0]" --output text)
  if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
    API_ID=$(awsl apigatewayv2 create-api --name "$FN-api" --protocol-type HTTP --query ApiId --output text)
    ok "created API $API_ID"
  else
    ok "API exists $API_ID"
  fi
  INTEGRATION_ID=$(awsl apigatewayv2 get-integrations --api-id "$API_ID" --query 'Items[0].IntegrationId' --output text)
  if [ -z "$INTEGRATION_ID" ] || [ "$INTEGRATION_ID" = "None" ]; then
    INTEGRATION_ID=$(awsl apigatewayv2 create-integration --api-id "$API_ID" \
      --integration-type AWS_PROXY --payload-format-version 2.0 \
      --integration-uri "arn:aws:lambda:$REGION:$ACCOUNT:function:$FN" \
      --query IntegrationId --output text)
  fi
  ok "integration $INTEGRATION_ID -> $FN"
  EXISTING=$(awsl apigatewayv2 get-routes --api-id "$API_ID" --query 'Items[].RouteKey' --output text | tr '\t' '\n')
  COUNT=0
  while read -r ROUTE; do
    case "$ROUTE" in ''|'#'*) continue ;; esac
    if ! printf '%s\n' "$EXISTING" | grep -Fxq "$ROUTE"; then
      awsl apigatewayv2 create-route --api-id "$API_ID" --route-key "$ROUTE" --target "integrations/$INTEGRATION_ID" >/dev/null
    fi
    COUNT=$((COUNT + 1))
  done < "services/$svc/infra/api-routes.txt"
  ok "$COUNT routes from services/$svc/infra/api-routes.txt (everything else: 404 from API Gateway)"
  if ! awsl apigatewayv2 get-stages --api-id "$API_ID" --query 'Items[].StageName' --output text | grep -q '\$default'; then
    # API Gateway throttling in front of the app's own rate limiter (Lab 8)
    awsl apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy \
      --default-route-settings ThrottlingBurstLimit=50,ThrottlingRateLimit=25 >/dev/null
  fi
  ok "stage \$default (auto-deploy, throttling 25 req/s, burst 50)"
  awsl lambda add-permission --function-name "$FN" --statement-id apigw-invoke \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$API_ID/*" >/dev/null 2>&1 || true
  ok "only this API may call $FN"

  API_URL="http://$API_ID.execute-api.localhost.floci.io:$EP_PORT"
  save_output "${KEY}_API_ID" "$API_ID"
  save_output "${KEY}_API_URL" "$API_URL"
  info "API URL: $API_URL"
  HEALTH=""
  for i in 1 2 3 4 5 6; do
    HEALTH=$(curl -s --max-time 30 "$API_URL/api/health" || true)
    case "$HEALTH" in *'"status":"ok"'*) break ;; esac
    sleep 3
  done
  case "$HEALTH" in
    *'"runtime":"lambda"'*) ok "GET /api/health -> $HEALTH" ;;
    *) info "GET /api/health did not answer yet ($HEALTH). Try again in a minute: curl $API_URL/api/health" ;;
  esac
}

for svc in $TARGET; do deploy_one "$svc"; done
rm -f "$GEN"/lambda-env-*.json "$GEN/schedule-targets.json"
echo
echo "Next: bash infra/deploy-frontend.sh   (puts the website on S3 and points it at these APIs)"
