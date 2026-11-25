#!/bin/sh
# PREVIEW ONLY - for a laptop WITHOUT Docker.
# Starts moto (an open-source AWS emulator written in Python) on http://localhost:4566,
# the same address Floci uses, so setup-all.sh and "npm run dev" work unchanged.
# Lambda functions need Docker, so on this emulator you run the services on your PC.
# It also installs a copy of the AWS CLI inside the project, used when "aws" is not installed.
# The graded deployment uses Floci:  docker compose -f infra/floci/docker-compose.yml up -d
set -e
cd "$(dirname "$0")"
if ! .venv/bin/python -c "import moto.server" 2>/dev/null || ! .venv/bin/python -c "import awscli" 2>/dev/null; then
  echo "Installing moto + AWS CLI into infra/local/.venv (first run only, needs internet)..."
  [ -x .venv/bin/python ] || python3 -m venv .venv
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/python -m pip install --quiet "moto[server]" awscli
fi
# free port 4566 if an older emulator is still running
old=$(lsof -ti tcp:4566 -sTCP:LISTEN 2>/dev/null || true)
[ -n "$old" ] && kill $old 2>/dev/null && sleep 1
MOTO_ACCOUNT_ID=000000000000 .venv/bin/python -m moto.server -H 127.0.0.1 -p 4566 > .venv/moto.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' INT TERM EXIT
i=0
until curl -s -o /dev/null http://127.0.0.1:4566/moto-api/ || [ $i -ge 60 ]; do sleep 1; i=$((i+1)); done
echo "AWS emulator (moto) running on http://localhost:4566 - keep this terminal open."
wait $PID
