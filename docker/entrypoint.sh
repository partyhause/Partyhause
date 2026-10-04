#!/bin/bash
# Combined-image entrypoint: start the API sidecar, wait for it to answer,
# then run nginx in the foreground as the container's main process.
#
# WHY THE READINESS GATE
#   nginx starts in milliseconds; the Express process takes seconds to mount
#   26 routers. Without the gate the first requests after a revision swap hit
#   a 502 from a proxy with no upstream, which reads as an outage rather than
#   a boot. The Container App's own startup probe (absent from the module —
#   see the hazard note in infra/modules/container-app.bicep) would cover this,
#   but a gate in here is correct regardless of what the platform does.
#
# WHY THE GATE IS BOUNDED
#   If the API never becomes healthy (bad DATABASE_URL, a failed migration),
#   nginx must still start: a static-serving shell with a 502 on /api is far
#   more diagnosable than a container stuck in CrashLoopBackOff, and the boot
#   log carries the API's actual error either way.
#
# SIGNALS
#   tini (the PID 1 from Dockerfile.combined) forwards SIGTERM to this script,
#   which forwards it to both children; nginx shuts down cleanly and the node
#   process dies with it.

set -u

LOG_FILE="${API_LOG_FILE:-/tmp/ph-api.log}"

# ---- API sidecar -----------------------------------------------------------
# The tsx CLI, not bare `node`: the server imports its own modules without
# file extensions (`./lib/jwt-secret`), which ESM only resolves with a
# loader. tsx registers one when the CLI runs; bare node fails with
# ERR_MODULE_NOT_FOUND on the first extensionless import.
tsx server/index.ts >"$LOG_FILE" 2>&1 &
API_PID=$!

elapsed=0
until curl -sf -m 2 "http://localhost:${PORT:-3001}/api/health" >/dev/null 2>&1; do
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
  echo "[entrypoint] API ready on :${PORT:-3001} (pid $API_PID)"
else
  echo "[entrypoint] WARNING: API sidecar is not running; /api will 502" >&2
fi

# ---- nginx, foreground -----------------------------------------------------
# Replace this process with nginx so signals from tini land on nginx directly.
exec nginx -g "daemon off;"
