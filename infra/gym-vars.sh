#!/usr/bin/env bash
# Puts the deployment values in your terminal (like lab7-vars.sh):
#   source infra/gym-vars.sh
# Then e.g.:  curl $BOOKINGS_API_URL/api/health
. "$(dirname "${BASH_SOURCE[0]}")/services/_lib.sh"
for svc in $SERVICES; do
  KEY=$(api_key "$svc")
  ID=$(awsl apigatewayv2 get-apis --query "Items[?Name=='gym-$svc-api'].ApiId | [0]" --output text 2>/dev/null)
  if [ -n "$ID" ] && [ "$ID" != "None" ]; then
    export "${KEY}_API_ID=$ID"
    export "${KEY}_API_URL=http://$ID.execute-api.localhost.floci.io:$(echo "$ENDPOINT" | sed -E 's#.*:([0-9]+)/?$#\1#')"
  fi
done
env | grep -E '^(IDENTITY|CLASSES|BOOKINGS|ATTENDANCE)_API_URL=|^COGNITO_|^WEBSITE_URL=' | sort
