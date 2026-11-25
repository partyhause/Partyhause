#!/bin/bash
# Combined-image entrypoint: start the Django API sidecar, wait for it to
# answer /api/health, then run nginx in the foreground as the container's
# main process.
#
# WHY THE READINESS GATE
#   nginx starts in milliseconds; Django takes seconds to mount routers.
#   Without the gate the first requests after a revision swap hit a 502 from
#   a proxy with no upstream, which reads as an outage rather than a boot.
#
# WHY THE GATE IS BOUNDED
#   If the API never becomes healthy (bad DATABASE_URL, a failed migration),
#   nginx must still start: a static-serving shell with a 502 on /api is far
#   more diagnosable than a container stuck in CrashLoopBackOff.
#
# SIGNALS
#   tini (PID 1) forwards SIGTERM to this script, which forwards it to both
#   children; nginx shuts down cleanly and the python process dies with it.

set -u

LOG_FILE="${API_LOG_FILE:-/tmp/ph-api.log}"

cd /app/django

# ---- API sidecar -----------------------------------------------------------
gunicorn partyhause.wsgi:application \
  --bind 127.0.0.1:8001 --workers 2 --threads 4 --timeout 120 \
  >"$LOG_FILE" 2>&1 &
API_PID=$!

elapsed=0
until curl -sf -m 2 "http://127.0.0.1:8001/api/health/" >/dev/null 2>&1; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[entrypoint] API exited during startup; log follows:" >&2
    cat "$LOG_FILE" >&2
    # nginx still serves the shell; the API sidecar stays dead.
    break
  fi
  sleep 1
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge "${API_READY_TIMEOUT_SECS:-60}" ]; then
    echo "[entrypoint] API not healthy after ${elapsed}s; starting nginx anyway" >&2
    break
  fi
done

if kill -0 "$API_PID" 2>/dev/null; then
  echo "[entrypoint] API ready on :8001 (pid $API_PID)"
else
  echo "[entrypoint] WARNING: API sidecar is not running; /api will 502" >&2
fi

# ---- nginx, foreground -----------------------------------------------------
exec nginx -g "daemon off;"
