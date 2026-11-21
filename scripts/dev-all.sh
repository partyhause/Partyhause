#!/bin/bash
# PartyHause local dev: Django API + web + (optional) Mailpit in one command.
#
#   npm run dev:all
#
# What it does:
#   1. Frees API_PORT (default 8001) and WEB_PORT (default 5173).
#   2. Starts Mailpit (local SMTP catcher) if the binary exists and nothing
#      already listens on SMTP_PORT (default 1025). Skipped silently otherwise.
#   3. Starts the Django API on :$API_PORT and waits until /api/health answers.
#   4. Starts Vite, then supervises both until one exits or Ctrl-C.
#
# Knobs (all optional): API_PORT, WEB_PORT, SMTP_HOST, SMTP_PORT,
# MAILPIT_UI_PORT, API_READY_TIMEOUT_SECS, DATABASE_URL.
#
# macOS ships bash 3.2, so this script avoids `wait -n` and associative
# arrays on purpose.

set -u

API_PORT="${API_PORT:-8001}"
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
  local port="$1"
  if port_open "$port"; then
    local pid
    pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
      log "freeing port $port (pid $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
  fi
}

cleanup() {
  log "stopping..."
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${VITE_PID:-}" ] && kill "$VITE_PID" 2>/dev/null || true
  [ -n "${MAILPIT_PID:-}" ] && kill "$MAILPIT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---- 1. Free the web/API ports -------------------------------------------
free_port "$API_PORT"
free_port "$WEB_PORT"

# ---- 2. Mailpit (local SMTP catcher) -------------------------------------
if ! port_open "$SMTP_PORT"; then
  if command -v mailpit >/dev/null 2>&1; then
    log "starting mailpit on :$SMTP_PORT / :$MAILPIT_UI_PORT..."
    mailpit --smtp-bind-addr "127.0.0.1:$SMTP_PORT" \
      --http-bind-addr "127.0.0.1:$MAILPIT_UI_PORT" >/tmp/ph-mailpit.log 2>&1 &
    MAILPIT_PID="$!"
  else
    log "mailpit not found on PATH — skipping SMTP catcher"
  fi
fi

# ---- 3. Django API, with readiness gate ----------------------------------
log "starting Django API on :$API_PORT..."
(cd django && DATABASE_URL="${DATABASE_URL:-postgresql://oluwaferanmi@localhost:5432/partyhause_dev}" \
  python manage.py runserver "127.0.0.1:$API_PORT") >/tmp/ph-api.log 2>&1 &
API_PID="$!"

elapsed=0
until curl -sf -m 2 "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; do
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge "$READY_TIMEOUT" ]; then
    log "ERROR: API did not become ready on :$API_PORT within ${READY_TIMEOUT}s"
    log "see /tmp/ph-api.log"
    exit 1
  fi
  sleep 1
done
log "API ready: http://localhost:$API_PORT/api/health"

# ---- 4. Vite --------------------------------------------------------------
log "starting web on :$WEB_PORT..."
npx vite --port "$WEB_PORT" >/tmp/ph-web.log 2>&1 &
VITE_PID="$!"

sleep 3
if ! kill -0 "$VITE_PID" 2>/dev/null; then
  log "ERROR: Vite failed to start — see /tmp/ph-web.log"
  exit 1
fi

# ---- 5. Supervise ----------------------------------------------------------
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
  sleep 5
  if ! kill -0 "$API_PID" 2>/dev/null; then
    log "API process exited; see /tmp/ph-api.log"
    exit 1
  fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    log "Vite process exited; see /tmp/ph-web.log"
    exit 1
  fi
done
