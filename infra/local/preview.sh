#!/bin/sh
# ONE command for the no-Docker preview on your PC:   npm run preview
#   1. stop old runs  2. npm install everywhere  3. start the emulator (moto)
#   4. create all AWS resources + demo users (setup-all.sh)  5. start services + website
# Then open http://localhost:8080. Ctrl+C (or the stop button) ends it.
cd "$(dirname "$0")/../.."
echo "== 1/5 stopping old runs";        sh infra/local/stop-all.sh
for s in class-service booking-service attendance-service; do [ -d "services/$s" ] || { echo "   services/$s is missing: merge its owner's branch into main first (see README)"; exit 1; }; done
echo "== 2/5 npm install everywhere";   npm run install-all --silent || exit 1
echo "== 3/5 starting the AWS emulator (first time: installs moto + AWS CLI, a few minutes)"
sh infra/local/start-emulator.sh > /tmp/gym-emulator.log 2>&1 &
EMU=$!
trap 'kill $EMU 2>/dev/null; sh infra/local/stop-all.sh >/dev/null' INT TERM EXIT
i=0
until curl -s -o /dev/null http://127.0.0.1:4566/moto-api/; do
  sleep 2; i=$((i+1))
  if ! kill -0 $EMU 2>/dev/null; then echo "Emulator failed to start:"; cat /tmp/gym-emulator.log; exit 1; fi
  [ $i -ge 300 ] && { echo "Emulator did not start in 10 minutes"; cat /tmp/gym-emulator.log; exit 1; }
done
echo "== 4/5 creating AWS resources + demo users (about 2 minutes)"
bash infra/setup-all.sh || exit 1
echo "== 5/5 starting the services and the website"
node infra/local/run-all.mjs
