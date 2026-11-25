#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICES=(partyhause-db partyhause-mailpit partyhause-django partyhause-web)
PROJECT="partyhause"

while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Checking PartyHause services..."
  down=()
  for svc in "${SERVICES[@]}"; do
    status=$(docker compose -p "$PROJECT" ps -q "$svc" | xargs -r docker inspect -f '{{.State.Status}}' 2>/dev/null || echo "absent")
    if [[ "$status" != "running" && "$status" != "healthy" ]]; then
      echo "⚠️  $svc is $status"
      down+=("$svc")
    else
      echo "✅ $svc is $status"
    fi
  done

  if [[ ${#down[@]} -gt 0 ]]; then
    echo "🔄 Restarting down services: ${down[*]}"
    docker compose -p "$PROJECT" restart "${down[@]}"
  fi

  sleep 15
done
