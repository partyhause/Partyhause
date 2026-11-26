#!/bin/bash
#
# Full manual deployment for PartyHause — the exact workflow deploy.yml runs,
# in one script, entirely on the cloud (build and push both happen inside/on
# ACR; nothing but the final image-tag update touches the local tree).
#
# WHY THIS EXISTS
#   GitHub Actions is billing-locked (every run since 2026-09-03 fails in
#   seconds without compiling anything), so deploys are manual. Until now the
#   manual path was a stack of `az acr build` commands with NO GATES AT ALL:
#   code that did not typecheck, or that broke the contract audit, could still
#   be built into an image and shipped to production. This script runs the
#   same gate chain the CI workflow runs before anything is built.
#
# WHAT IT RUNS, IN ORDER (mirrors .github/workflows/deploy.yml exactly)
#   Gates (identical to the build-and-test job):
#     1. npm ci --legacy-peer-deps
#     2. npx prisma generate
#     3. npm run test:migrations          (needs DATABASE_URL; skipped if unset)
#     4. npm run lint
#     5. npm run build:check              (typecheck + contract audit + vite build)
#     6. npm run test:run
#     7. npm run doctor:mobile
#     8. npm run build:ios:export
#   Build & deploy (identical to the deploy job, using the combined image):
#     9. az acr build --file Dockerfile.combined   (web + API in one image)
#    10. az containerapp update                     (SHA-tagged revision)
#    11. Health checks: /api/health/ and / on the container FQDN
#
# SECRETS / ENV REQUIRED
#   DATABASE_URL                — optional; without it step 3 is skipped (CI
#                                 runs it against a service Postgres; locally
#                                 point it at your dev database).
#   AZURE_CREDENTIALS not needed: you are already logged in with `az login`.
#
# COMBINED IMAGE / TOPOLOGY
#   One Container App serves frontend and backend together: nginx owns port 80
#   and serves the static bundle with the full cache policy in nginx.conf, and
#   proxies /api/* to the Django API sidecar on localhost:8001 in the same
#   container. VITE_API_URL is passed EMPTY so the bundle sends same-origin
#   relative requests (src/lib/apiBase.ts:9-12) and no CORS configuration is
#   consulted. One revision update moves both tiers.

set -euo pipefail

cd "$(dirname "$0")/.."

SUBSCRIPTION="${AZURE_SUBSCRIPTION:-4dec0cc6-78c7-434c-b6c7-3ed2e8075d62}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-partyhause-prod}"
APP_NAME="${AZURE_APP_NAME:-ca-app-partyhause-combined}"
ACR_NAME="${AZURE_ACR_NAME:-acrpartyhausejvt4gqrth7cuc}"
# The API keeps its container FQDN in CORS_ALLOWED_ORIGINS so the app stays
# reachable from a URL that is guaranteed to exist even if a custom-domain
# binding is ever removed.
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-partyhause.uk}"

SHA="$(git rev-parse HEAD)"
IMAGE_TAG="$SHA"

step() {
  echo ""
  echo "==> $1"
}

command -v az >/dev/null 2>&1 || { echo "ERROR: az CLI not found on PATH." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH." >&2; exit 1; }

# ---------------------------------------------------------------------------
# Subscription. The account defaults to a different subscription, and querying
# the wrong one returns empty results that read exactly like "not configured".
# ---------------------------------------------------------------------------
step "Selecting subscription $SUBSCRIPTION"
az account set --subscription "$SUBSCRIPTION"

# ---------------------------------------------------------------------------
# Gates — identical to the build-and-test job in deploy.yml. Any failure here
# stops the deploy; nothing has been built yet.
# ---------------------------------------------------------------------------
step "Gate 1/8: npm ci --legacy-peer-deps"
npm ci --legacy-peer-deps

step "Gate 2/8: npx prisma generate"
npx prisma generate

if [ -n "${DATABASE_URL:-}" ]; then
  step "Gate 3/8: npm run test:migrations (DATABASE_URL set)"
  npm run test:migrations
else
  step "Gate 3/8: SKIPPED (DATABASE_URL unset — CI runs this against its service Postgres)"
fi

step "Gate 4/8: npm run lint"
npm run lint

step "Gate 5/8: npm run build:check (typecheck + contract audit + vite build)"
npm run build:check

step "Gate 6/8: npm run test:run"
npm run test:run

step "Gate 7/8: npm run doctor:mobile"
npm run doctor:mobile

step "Gate 8/8: npm run build:ios:export"
npm run build:ios:export

# ---------------------------------------------------------------------------
# Build & deploy — identical to the deploy job, using the combined image.
# Everything here happens on Azure: az acr build uploads the working tree and
# builds inside ACR, so what ships is the local tree, and the gate chain above
# is what makes it trustworthy.
# ---------------------------------------------------------------------------
step "az acr build --file Dockerfile.combined (web + API in one image)"
# VITE_* are inlined at build time; VITE_API_URL is passed EMPTY for
# same-origin (nginx proxies /api). Omit the VITE_ENTRA_* args — they are
# bundled but inert, and setting them before the JWKS validation is built
# breaks auth (see AGENTS.md, Auth section).
az acr build \
  --registry "$ACR_NAME" \
  --image partyhause-combined:latest \
  --image "partyhause-combined:$IMAGE_TAG" \
  --file docker/Dockerfile.combined \
  --build-arg VITE_API_URL="" \
  --build-arg VITE_APP_NAME="PartyHause" \
  --build-arg "VITE_APP_URL=https://$PUBLIC_DOMAIN" \
  .

step "az containerapp update (SHA-tagged revision)"
az containerapp update \
  -n "$APP_NAME" \
  -g "$RESOURCE_GROUP" \
  --image "$ACR_NAME.azurecr.io/partyhause-combined:$IMAGE_TAG"

# ---------------------------------------------------------------------------
# Health checks — poll the container FQDN, not the custom domain, so a
# failure is unambiguous about what broke.
# ---------------------------------------------------------------------------
APP_FQDN="$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" --query 'properties.configuration.ingress.fqdn' -o tsv)"
BASE_URL="https://$APP_FQDN"

health_check() {
  local name="$1" path="$2"
  echo "Polling $BASE_URL$path ..."
  for i in $(seq 1 24); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL$path" || echo "000")
    echo "attempt $i: HTTP $code"
    if [ "$code" = "200" ]; then
      echo "$name is healthy."
      return 0
    fi
    sleep 5
  done
  echo "ERROR: $name did not become healthy in time." >&2
  return 1
}

step "Health check: API"
health_check "API" "/api/health/"

step "Health check: Web (static shell)"
health_check "Web" "/"

echo ""
echo "Deployed."
echo "  - Combined app: $BASE_URL"
echo "  - Web (custom domain): https://$PUBLIC_DOMAIN/"
echo "  - API health: $BASE_URL/api/health/"
echo "  - Image: $ACR_NAME.azurecr.io/partyhause-combined:$IMAGE_TAG"

