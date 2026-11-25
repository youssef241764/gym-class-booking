#!/usr/bin/env bash
# Puts the website on S3 (Lab 7 style) and points it at the four API Gateway URLs.
#   bash infra/deploy-frontend.sh
# Then open  http://localhost:4566/gym-frontend/index.html   (type localhost, not 127.0.0.1)
set -e
. "$(dirname "$0")/services/_lib.sh"; cd "$ROOT"; check_endpoint

step "frontend/js/config.js  (the website picks the API from the page address)"
for k in IDENTITY CLASSES BOOKINGS ATTENDANCE; do
  eval "v=\${${k}_API_URL:-}"
  [ -z "$v" ] && info "no $k API yet - run bash infra/deploy-backend.sh all first"
done
cat > frontend/js/config.js <<JS
// Where are the APIs? (Lab 7 pattern: chosen from the address the page was loaded from)
//   page on port 8080 -> your PC: each service runs with "npm run dev" on ports 3001-3004
//   page on port 4566 -> Floci:   the page comes from S3 and calls API Gateway
// Public values only (web addresses). Never put a secret in this file.
// The FLOCI_API lines are written by infra/deploy-frontend.sh (you can also paste them by hand).
const PC_API = {
  identity: 'http://localhost:3001',
  classes: 'http://localhost:3002',
  bookings: 'http://localhost:3003',
  attendance: 'http://localhost:3004',
};
const FLOCI_API = {
  identity: '${IDENTITY_API_URL:-}',
  classes: '${CLASSES_API_URL:-}',
  bookings: '${BOOKINGS_API_URL:-}',
  attendance: '${ATTENDANCE_API_URL:-}',
};
const onFloci = window.location.port === '4566';
window.GYM_CONFIG = { runtime: onFloci ? 'floci' : 'pc', api: onFloci ? FLOCI_API : PC_API };
JS
ok "frontend/js/config.js"

step "Upload to s3://gym-frontend"
awsl s3 sync frontend s3://gym-frontend --delete \
  --exclude "package.json" --exclude "package-lock.json" --exclude "node_modules/*" --exclude ".DS_Store" >/dev/null
# make sure the browser gets the right file types (some Windows PCs guess wrongly)
awsl s3 cp frontend/index.html s3://gym-frontend/index.html --content-type "text/html; charset=utf-8" >/dev/null
awsl s3 cp frontend/css s3://gym-frontend/css --recursive --content-type text/css >/dev/null
awsl s3 cp frontend/js s3://gym-frontend/js --recursive --content-type text/javascript >/dev/null
awsl s3 cp frontend/img s3://gym-frontend/img --recursive --content-type image/svg+xml >/dev/null
awsl s3 ls s3://gym-frontend --recursive | sed 's/^/    /'
WEBSITE_URL="${ENDPOINT%/}/gym-frontend/index.html"
save_output WEBSITE_URL "$WEBSITE_URL"
echo
ok "Open $WEBSITE_URL"
echo "  Changed a frontend file later? Run this script again, then press Ctrl+F5 (Cmd+Shift+R on Mac)."
