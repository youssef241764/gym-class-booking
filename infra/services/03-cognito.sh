#!/usr/bin/env bash
# 03  Amazon Cognito: user pool, web app client and the three role groups
#   bash infra/services/03-cognito.sh                (safe to run again)
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint

step "Cognito user pool gym-users-pool"
POOL_ID=$(awsl cognito-idp list-user-pools --max-results 60 \
  --query "UserPools[?Name=='gym-users-pool'].Id | [0]" --output text)
if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then
  POOL_ID=$(awsl cognito-idp create-user-pool --pool-name gym-users-pool \
    --username-attributes email \
    --policies "PasswordPolicy={MinimumLength=10,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}" \
    --admin-create-user-config AllowAdminCreateUserOnly=true \
    --schema Name=name,AttributeDataType=String,Mutable=true \
    --query UserPool.Id --output text)
  ok "created $POOL_ID"
else
  ok "exists  $POOL_ID"
fi

step "App client gym-web  (no client secret: the browser never talks to Cognito directly)"
CLIENT_ID=$(awsl cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --max-results 60 \
  --query "UserPoolClients[?ClientName=='gym-web'].ClientId | [0]" --output text)
if [ -z "$CLIENT_ID" ] || [ "$CLIENT_ID" = "None" ]; then
  CLIENT_ID=$(awsl cognito-idp create-user-pool-client --user-pool-id "$POOL_ID" --client-name gym-web \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --access-token-validity 60 --id-token-validity 60 --refresh-token-validity 1 \
    --token-validity-units AccessToken=minutes,IdToken=minutes,RefreshToken=days \
    --prevent-user-existence-errors ENABLED \
    --query UserPoolClient.ClientId --output text)
  ok "created $CLIENT_ID"
else
  ok "exists  $CLIENT_ID"
fi

step "Groups = roles  (the role is read from the signed token, never from the browser)"
precedence=1
for g in admin trainer member; do
  awsl cognito-idp create-group --user-pool-id "$POOL_ID" --group-name "$g" \
    --precedence $precedence --description "$g role" >/dev/null 2>&1 || true
  ok "$g"
  precedence=$((precedence + 1))
done

save_output COGNITO_USER_POOL_ID "$POOL_ID"
save_output COGNITO_CLIENT_ID "$CLIENT_ID"
