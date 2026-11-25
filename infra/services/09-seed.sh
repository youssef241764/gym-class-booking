#!/usr/bin/env bash
# 09  Demo data: six users (Cognito + gym-users table) and three studios
#   bash infra/services/09-seed.sh                   (safe to run again; run 02 and 03 first)
# Passwords are created on the first run and kept in infra/.generated/seed-credentials.txt
# (git-ignored). Set SEED_PASSWORD=... before the first run to choose one password for all.
set -e
. "$(dirname "$0")/_lib.sh"; cd "$ROOT"; check_endpoint
[ -z "$COGNITO_USER_POOL_ID" ] && { fail "Run 03-cognito.sh first"; exit 1; }

CREDS="$GEN/seed-credentials.txt"
USERS_OUT="$GEN/seed-users.txt"
touch "$CREDS"; : > "$USERS_OUT"
chmod 600 "$CREDS" 2>/dev/null || true
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

step "Users  (Cognito user + group, and a profile row in gym-users)"
grep -v '^#' infra/cognito/seed-users.txt | while read -r email role name; do
  [ -z "$email" ] && continue
  SUB=$(awsl cognito-idp admin-get-user --user-pool-id "$COGNITO_USER_POOL_ID" --username "$email" \
          --query "UserAttributes[?Name=='sub'].Value | [0]" --output text 2>/dev/null || true)
  if [ -z "$SUB" ] || [ "$SUB" = "None" ]; then
    SUB=$(awsl cognito-idp admin-create-user --user-pool-id "$COGNITO_USER_POOL_ID" --username "$email" \
            --message-action SUPPRESS \
            --user-attributes Name=email,Value="$email" "Name=name,Value=$name" Name=email_verified,Value=true \
            --query "User.Attributes[?Name=='sub'].Value | [0]" --output text)
  fi
  PASS=$(grep "^$email " "$CREDS" | cut -d' ' -f2 || true)
  if [ -z "$PASS" ]; then
    PASS="${SEED_PASSWORD:-Gym-$(openssl rand -hex 4)A9}"
    echo "$email $PASS" >> "$CREDS"
  fi
  awsl cognito-idp admin-set-user-password --user-pool-id "$COGNITO_USER_POOL_ID" --username "$email" \
    --password "$PASS" --permanent
  awsl cognito-idp admin-add-user-to-group --user-pool-id "$COGNITO_USER_POOL_ID" --username "$email" --group-name "$role"
  printf '{"userId":{"S":"%s"},"email":{"S":"%s"},"name":{"S":"%s"},"role":{"S":"%s"},"status":{"S":"active"},"createdAt":{"S":"%s"}}' \
    "$SUB" "$email" "$name" "$role" "$NOW" > "$GEN/user-item.json"
  awsl dynamodb put-item --table-name gym-users --item "file://infra/.generated/user-item.json" \
    --condition-expression "attribute_not_exists(userId)" >/dev/null 2>&1 || true
  echo "$email $role $SUB" >> "$USERS_OUT"
  ok "$role  $email"
done
rm -f "$GEN/user-item.json"

step "Studios  (infra/dynamodb/seed-studios.json)"
awsl dynamodb batch-write-item --request-items file://infra/dynamodb/seed-studios.json >/dev/null
ok "Studio A, Studio B, Spin Room"

echo
echo "  Demo sign-in details (also in infra/.generated/seed-credentials.txt):"
sed 's/^/    /' "$CREDS"
