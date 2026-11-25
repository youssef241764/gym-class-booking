#!/usr/bin/env bash
# ONE command for the Floci (cloud) deployment, Labs 7 + 8:   npm run cloud
#   1. stop the no-Docker preview (it uses the same port 4566)
#   2. start Floci with Docker   3. create all AWS resources + demo users
#   4. deploy the 4 Lambdas + API Gateway APIs   5. put the website on S3   6. check everything
cd "$(dirname "$0")/.."
echo "== 1/6 stopping the preview (if running)"
sh infra/local/stop-all.sh
if ! command -v aws >/dev/null 2>&1 && ! infra/local/.venv/bin/python -c "import awscli" 2>/dev/null; then
  echo "   no AWS CLI found: installing a copy into infra/local/.venv"
  python3 -m venv infra/local/.venv && infra/local/.venv/bin/python -m pip install --quiet awscli || exit 1
fi
for s in class-service booking-service attendance-service; do [ -d "services/$s" ] || { echo "   services/$s is missing: merge its owner's branch into main first (see README)"; exit 1; }; done
echo "== 2/6 starting Floci (first time: downloads the Floci image, a few minutes)"
docker compose -f infra/floci/docker-compose.yml up -d || { echo "Docker is not running: open Docker Desktop and try again"; exit 1; }
. infra/services/_lib.sh
i=0
until awsl sts get-caller-identity --query Account --output text >/dev/null 2>&1; do
  sleep 3; i=$((i+1)); [ $i -ge 100 ] && { echo "Floci did not answer on $ENDPOINT"; docker logs --tail 30 floci; exit 1; }
done
echo "   Floci is up: account $(awsl sts get-caller-identity --query Account --output text). Floci Dash: http://localhost:4566/_floci/ui"
echo "== 3/6 AWS resources + demo users";  bash infra/setup-all.sh || exit 1
echo "== 4/6 backends -> Lambda + API Gateway"; bash infra/deploy-backend.sh all || exit 1
echo "== 5/6 website -> S3";                bash infra/deploy-frontend.sh || exit 1
echo "== 6/6 checks";                       bash infra/check-deployment.sh
echo
echo "Website: http://localhost:4566/gym-frontend/index.html"
echo "Demo users and passwords: infra/.generated/seed-credentials.txt"
