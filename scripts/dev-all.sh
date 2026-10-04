#!/bin/bash
# PartyHause local dev: API + web + (optional) Mailpit in one command.
#
#   npm run dev:all
#
# What it does:
#   1. Frees API_PORT (default 3001) and WEB_PORT (default 5173).
#   2. Starts Mailpit (local SMTP catcher) if the binary exists and nothing
#      already listens on SMTP_PORT (default 1025). Skipped silently otherwise.
#   3. Starts the API (npm run dev:api) and waits until /api/health answers.
#   4. Starts Vite, then supervises all three until one exits or Ctrl-C.
#
# Knobs (all optional): PORT / API_PORT, WEB_PORT, SMTP_HOST, SMTP_PORT,
# MAILPIT_UI_PORT, API_READY_TIMEOUT_SECS.
#
# macOS ships bash 3.2, so this script avoids `wait -n` and associative
# arrays on purpose.

set -u

API_PORT="${API_PORT:-${PORT:-3001}}"
WEB_PORT="${WEB_PORT:-5173}"
SMTP_HOST="${SMTP_HOST:-localhost}"
SMTP_PORT="${SMTP_PORT:-1025}"
MAILPIT_UI_PORT="${MAILPIT_UI_PORT:-8025}"
READY_TIMEOUT="${API_READY_TIMEOUT_SECS:-60}"

API_PID=""
VITE_PID=""
MAILPIT_PID=""

log() {
  echo "[dev:all] $1"
}

port_open() {
  (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

free_port() {
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti:"$1" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      log "freeing port $1 (pids: $pids)"
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
      sleep 1
    fi
  fi
}

cleanup() {
  log "shutting down..."
  # Only signal processes this script started; the port sweep above already
  # handled stale holders.
  for pid in "$VITE_PID" "$API_PID" "$MAILPIT_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---- 1. Free the web/API ports -------------------------------------------
free_port "$API_PORT"
free_port "$WEB_PORT"

# ---- 2. Mailpit (local SMTP catcher, http://localhost:8025) ---------------
# The API's SMTP dev transport only activates when SMTP_HOST is reachable, so
# starting the catcher here is what makes outbound mail visible locally.
if ! port_open "$SMTP_PORT"; then
  if command -v mailpit >/dev/null 2>&1; then
    log "starting Mailpit (SMTP :$SMTP_PORT, UI :$MAILPIT_UI_PORT)..."
    mailpit --smtp "127.0.0.1:$SMTP_PORT" --listen "127.0.0.1:$MAILPIT_UI_PORT" >/tmp/ph-mailpit.log 2>&1 &
    MAILPIT_PID="$!"
    sleep 2
    if port_open "$SMTP_PORT"; then
      log "Mailpit UI at http://localhost:$MAILPIT_UI_PORT"
    else
      log "WARNING: Mailpit failed to bind :$SMTP_PORT (see /tmp/ph-mailpit.log); mail falls back to API-log links"
      MAILPIT_PID=""
    fi
  else
    log "mailpit not installed; auth links still print to the API log (brew install mailpit for a mail UI)"
  fi
else
  log "SMTP :$SMTP_PORT already in use; assuming a catcher is running"
fi

# ---- 3. API, with readiness gate ------------------------------------------
log "starting API on :$API_PORT..."
PORT="$API_PORT" SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" npm run dev:api >/tmp/ph-api.log 2>&1 &
API_PID="$!"

elapsed=0
until curl -sf -m 2 "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    log "ERROR: API exited before becoming ready. Tail of /tmp/ph-api.log:"
    tail -20 /tmp/ph-api.log
    exit 1
  fi
  if [ "$elapsed" -ge "$READY_TIMEOUT" ]; then
    log "ERROR: API not ready after ${READY_TIMEOUT}s. Tail of /tmp/ph-api.log:"
    tail -20 /tmp/ph-api.log
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
log "API ready: http://localhost:$API_PORT/api/health"

# ---- 4. Vite ---------------------------------------------------------------
log "starting web on :$WEB_PORT..."
npx vite --port "$WEB_PORT" >/tmp/ph-web.log 2>&1 &
VITE_PID="$!"

sleep 3
if ! kill -0 "$VITE_PID" 2>/dev/null; then
  log "ERROR: Vite exited early. Tail of /tmp/ph-web.log:"
  tail -20 /tmp/ph-web.log
  exit 1
fi

# ---- 5. Supervise -----------------------------------------------------------
echo ""
echo "  web      http://localhost:$WEB_PORT"
echo "  api      http://localhost:$API_PORT/api/health"
if port_open "$SMTP_PORT"; then
  echo "  mail UI  http://localhost:$MAILPIT_UI_PORT"
fi
echo "  logs     /tmp/ph-api.log  /tmp/ph-web.log  /tmp/ph-mailpit.log"
echo ""
log "both servers running. Ctrl-C to stop."

while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    log "ERROR: API exited (see /tmp/ph-api.log)"
    exit 1
  fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    log "ERROR: web server exited (see /tmp/ph-web.log)"
    exit 1
  fi
  sleep 2
done
