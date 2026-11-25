#!/usr/bin/env bash
# 07  IAM: one role per service, each with its own least-privilege policy (Lab 7 style)
#   role   = the "badge" a Lambda function wears        (infra/iam/trust-policy.json)
#   policy = the list of doors that badge opens          (services/<service>/infra/iam-policy.json)
#   bash infra/services/07-iam.sh                    (safe to run again)
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint

for svc in $SERVICES; do
  ROLE="gym-$svc-role"
  POLICY="gym-$svc-access"
  POLICY_ARN="arn:aws:iam::$ACCOUNT:policy/$POLICY"
  step "$ROLE  +  $POLICY"

  if awsl iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    ok "role exists"
  else
    awsl iam create-role --role-name "$ROLE" \
      --assume-role-policy-document file://infra/iam/trust-policy.json \
      --description "Execution role for $svc (least privilege)" >/dev/null
    ok "role created"
  fi

  if awsl iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
    # Policy exists: publish the JSON file as the new default version, drop old versions.
    for v in $(awsl iam list-policy-versions --policy-arn "$POLICY_ARN" \
                 --query 'Versions[?IsDefaultVersion==`false`].VersionId' --output text); do
      awsl iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$v" >/dev/null 2>&1 || true
    done
    awsl iam create-policy-version --policy-arn "$POLICY_ARN" \
      --policy-document "file://services/$svc/infra/iam-policy.json" --set-as-default >/dev/null
    ok "policy updated from services/$svc/infra/iam-policy.json"
  else
    awsl iam create-policy --policy-name "$POLICY" \
      --policy-document "file://services/$svc/infra/iam-policy.json" >/dev/null
    ok "policy created from services/$svc/infra/iam-policy.json"
  fi

  awsl iam attach-role-policy --role-name "$ROLE" --policy-arn "$POLICY_ARN"
  ok "policy attached to role"
done
