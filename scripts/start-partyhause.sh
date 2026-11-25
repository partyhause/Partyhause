#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "🚀 Starting PartyHause stack..."
docker compose -p partyhause up --build
