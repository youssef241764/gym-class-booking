#!/usr/bin/env bash
# Shared settings for every infra script (Lab 8 style).
# In every new terminal run:   source infra/services/_lib.sh
# It sets the dummy Floci keys and gives you the short command  awsl  (= aws pointed at Floci).

export AWS_ACCESS_KEY_ID=test          # Floci accepts any value. These are NOT secrets.
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1
export AWS_PAGER=""                    # never open "less" for long output
export MSYS_NO_PATHCONV=1              # Git Bash on Windows: keep paths like /api/health as they are
unset AWS_PROFILE

export ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export ACCOUNT=000000000000
export REGION=us-east-1

# Project folder and generated files (git-ignored)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT
export GEN="$ROOT/infra/.generated"
mkdir -p "$GEN"
export OUTPUTS="$GEN/outputs.env"

# The four services. Each one is owned by one student and deployed on its own.
export SERVICES="identity class-service booking-service attendance-service"

# awsl = aws pointed at Floci. "tr -d '\r'" removes the Windows line ending that
# aws.exe adds in Git Bash, so IDs saved with $( ... ) are clean on every OS.
# Uses the AWS CLI you installed; if there is none, the copy that
# infra/local/start-emulator.sh installs inside the project (infra/local/.venv).
# That copy is started as "python -m awscli", which also works when the
# project path contains spaces.
AWS_PY=""
if command -v aws >/dev/null 2>&1; then AWS_BIN=aws
elif [ -x "$ROOT/infra/local/.venv/bin/python" ] && "$ROOT/infra/local/.venv/bin/python" -c "import awscli" 2>/dev/null; then
  AWS_PY="$ROOT/infra/local/.venv/bin/python"; AWS_BIN="$AWS_PY"
else AWS_BIN=aws; fi
export AWS_BIN AWS_PY
awsl() {
  if [ -n "$AWS_PY" ]; then
    "$AWS_PY" -m awscli --endpoint-url "$ENDPOINT" --region "$REGION" "$@" | tr -d '\r'
  else
    "$AWS_BIN" --endpoint-url "$ENDPOINT" --region "$REGION" "$@" | tr -d '\r'
  fi
  return "${PIPESTATUS[0]}"
}

step() { printf '\n\033[36m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
info() { printf '  ..   %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; }

# Save NAME=value in infra/.generated/outputs.env (replaces an older value).
save_output() {
  touch "$OUTPUTS"
  grep -v "^$1=" "$OUTPUTS" > "$OUTPUTS.tmp" || true
  echo "$1=$2" >> "$OUTPUTS.tmp"
  mv "$OUTPUTS.tmp" "$OUTPUTS"
}
load_outputs() { if [ -f "$OUTPUTS" ]; then set -a; . "$OUTPUTS"; set +a; fi; }

# gym-class-service, gym-booking-service, ... (identity -> gym-identity)
fn_name() { echo "gym-$1"; }
# Name used in frontend/js/config.js and in outputs.env
api_key() {
  case "$1" in
    identity) echo IDENTITY ;; class-service) echo CLASSES ;;
    booking-service) echo BOOKINGS ;; attendance-service) echo ATTENDANCE ;;
  esac
}
port_of() {
  case "$1" in
    identity) echo 3001 ;; class-service) echo 3002 ;;
    booking-service) echo 3003 ;; attendance-service) echo 3004 ;;
  esac
}

# Is the emulator answering?
check_endpoint() {
  if ! command -v "$AWS_BIN" >/dev/null 2>&1; then
    fail "AWS CLI not found. macOS: brew install awscli   Windows: the AWS CLI MSI installer"
    echo "       (or run sh infra/local/start-emulator.sh once: it installs a copy inside the project)"
    exit 1
  fi
  if ! awsl sts get-caller-identity --query Account --output text >/dev/null 2>&1; then
    fail "Nothing answers on $ENDPOINT."
    echo "       Start Floci first:  docker compose -f infra/floci/docker-compose.yml up -d"
    echo "       (no Docker? preview emulator:  sh infra/local/start-emulator.sh)"
    exit 1
  fi
}

load_outputs
