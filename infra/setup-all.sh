#!/usr/bin/env bash
# Builds every AWS resource the Gym Class Booking System needs, then adds demo data.
# Run it from the project folder (Git Bash on Windows, Terminal on macOS):
#
#   docker compose -f infra/floci/docker-compose.yml up -d
#   bash infra/setup-all.sh
#
# Each step is a small script in infra/services/ that you can also run (and explain) on its own.
# Everything is safe to run again.
set -e
. "$(dirname "$0")/services/_lib.sh"; cd "$ROOT"
check_endpoint
echo "Target: $ENDPOINT  (account $(awsl sts get-caller-identity --query Account --output text))"

for s in 01-kms-secrets-ssm 02-dynamodb 03-cognito 04-s3 05-sqs 06-eventbridge 07-iam 08-cloudwatch 09-seed; do
  bash "infra/services/$s.sh"
done
bash infra/write-env.sh

echo
echo "Done. Next:"
echo "  On Floci (cloud):  bash infra/deploy-backend.sh all && bash infra/deploy-frontend.sh"
echo "  On your PC:        npm run dev in each services/<name> folder, then cd frontend && npm start"
