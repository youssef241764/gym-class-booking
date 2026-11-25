#!/usr/bin/env bash
# 01  KMS key, Secrets Manager secrets and SSM Parameter Store (business rules)
#   bash infra/services/01-kms-secrets-ssm.sh        (safe to run again)
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint

step "KMS key alias/gym-reports  (encrypts the CSV report exports in S3)"
KEY_ARN=$(awsl kms describe-key --key-id alias/gym-reports --query KeyMetadata.Arn --output text 2>/dev/null || true)
if [ -z "$KEY_ARN" ] || [ "$KEY_ARN" = "None" ]; then
  KEY_ID=$(awsl kms create-key --description "Gym Class Booking - report exports" --query KeyMetadata.KeyId --output text)
  awsl kms create-alias --alias-name alias/gym-reports --target-key-id "$KEY_ID"
  awsl kms enable-key-rotation --key-id "$KEY_ID" >/dev/null 2>&1 || true
  KEY_ARN=$(awsl kms describe-key --key-id "$KEY_ID" --query KeyMetadata.Arn --output text)
  ok "created $KEY_ARN"
else
  ok "exists  $KEY_ARN"
fi
save_output KMS_KEY_ARN "$KEY_ARN"

step "Secrets Manager  (one random key per service for /internal calls, Brevo e-mail key)"
for svc in $SERVICES; do
  name="gym/$svc/internal-key"
  if awsl secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
    ok "exists  $name"
  else
    awsl secretsmanager create-secret --name "$name" \
      --description "Service-to-service key for the /internal endpoints of $svc" \
      --secret-string "$(openssl rand -hex 32)" >/dev/null
    ok "created $name"
  fi
done
name="gym/booking-service/brevo-api-key"
if awsl secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
  if [ -n "$BREVO_API_KEY" ]; then
    awsl secretsmanager put-secret-value --secret-id "$name" --secret-string "$BREVO_API_KEY" >/dev/null
    ok "updated $name"
  else
    ok "exists  $name"
  fi
else
  awsl secretsmanager create-secret --name "$name" --description "Brevo transactional e-mail API key" \
    --secret-string "${BREVO_API_KEY:-DISABLED}" >/dev/null
  ok "created $name  (value: ${BREVO_API_KEY:+your key}${BREVO_API_KEY:-DISABLED - e-mails are skipped})"
fi

step "SSM Parameter Store  (business rules in services/*/infra/ssm-policy.json, read by the services at run time)"
for svc in class-service booking-service attendance-service; do
  awsl ssm put-parameter --name "/gym/$svc/policy" --type String --overwrite \
    --value "file://services/$svc/infra/ssm-policy.json" >/dev/null
  ok "/gym/$svc/policy"
done
