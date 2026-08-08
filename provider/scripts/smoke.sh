#!/usr/bin/env bash
# Smoke test: adapter server without a browser must boot degraded and
# fail closed on /v1/chat/completions.
set -u
cd /d/hermes/chatgpt-web-provider
CHROME_LAUNCH_AT_STARTUP=false CHROME_CDP_PORT=9299 ADAPTER_PORT=8765 LOG_LEVEL=warn \
  ./node_modules/.bin/tsx src/index.ts > /tmp/adapter-smoke.log 2>&1 &
ADAPTER_PID=$!
echo "adapter pid=$ADAPTER_PID"
for i in $(seq 1 20); do
  if curl -s http://127.0.0.1:8765/health > /dev/null 2>&1; then break; fi
  sleep 0.5
done
echo "--- /health (no browser) ---"
curl -s http://127.0.0.1:8765/health | head -c 500; echo
echo "--- /v1/models ---"
curl -s http://127.0.0.1:8765/v1/models; echo
echo "--- POST chat (expect 503 BROWSER_UNAVAILABLE) ---"
curl -s -w "\nHTTP=%{http_code}\n" -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"chatgpt-web","messages":[{"role":"user","content":"hi"}]}'
echo "--- POST stream=true (expect 400 INVALID_REQUEST) ---"
curl -s -w "\nHTTP=%{http_code}\n" -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"chatgpt-web","messages":[{"role":"user","content":"hi"}],"stream":true}'
echo "--- POST bad body (expect 400) ---"
curl -s -w "\nHTTP=%{http_code}\n" -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"chatgpt-web"}'
kill $ADAPTER_PID 2>/dev/null
echo "--- server log tail ---"
tail -5 /tmp/adapter-smoke.log
