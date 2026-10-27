# Production Docker Split Migration Guide

## Summary
Production moves from a single combined Container App (`ca-app-partyhause-combined`) running `Dockerfile.combined` (nginx + Express sidecar) to two separate Container Apps:
- `ca-web-partyhause-k2xoe7s452aja` → `Dockerfile.frontend` (nginx serving Vite PWA)
- `ca-api-partyhause-k2xoe7s452aja` → `Dockerfile.backend` (Express API)

## Changes Applied
1. **Bicep** `infra/resources.bicep`
   - Removed `module app` for combined app
   - Added `module webApp` with image `partyhause-frontend:latest`, targetPort 80
   - Added `module apiApp` with image `partyhause-api:latest`, targetPort 3001
   - CORS_ALLOWED_ORIGINS now includes web app FQDN
   - Outputs updated to `webUrl`/`apiUrl` per app

2. **GitHub Actions** `.github/workflows/deploy.yml`
   - Env vars: `WEB_APP_NAME`, `API_APP_NAME`, `WEB_APP_FQDN`, `API_APP_FQDN`
   - Build & push two images: `partyhause-frontend` and `partyhause-api`
   - Deploy both apps with `azure/container-apps-deploy-action@v1`
   - Health checks poll API and Web FQDNs separately
   - Frontend built with `VITE_API_URL=https://<API_FQDN>` (cross-origin)

3. **CORS / Client**
   - `src/lib/apiBase.ts` already supports `VITE_API_URL` for cross-origin
   - Bicep sets `CORS_ALLOWED_ORIGINS` to include `https://${publicDomain}`, `https://www...`, and web app FQDN

## Cutover Steps
1. Merge this branch to `main` and push (already done)
2. Run initial Bicep provisioning with `skip-provision=false` to create new apps
3. First deploy will build both images and update both apps
4. Verify health:
   - API: `https://ca-api-partyhause-k2xoe7s452aja.orangecliff-6cf481f7.eastus2.azurecontainerapps.io/api/health`
   - Web: `https://ca-web-partyhause-k2xoe7s452aja.orangecliff-6cf481f7.eastus2.azurecontainerapps.io/`
5. Re-bind custom domain `partyhause.uk` and `www.partyhause.uk` to `ca-web-partyhause-k2xoe7s452aja` using `scripts/bind-azure-custom-domains.sh` (update to web app name)
6. Keep existing combined app running until validation passes, then delete `ca-app-partyhause-combined` manually (Bicep no longer declares it)

## Rollback
If issues arise, redeploy previous `partyhause-combined` image to `ca-app-partyhause-combined` and re-point custom domain back. No DB changes were made.

## Notes
- `VITE_API_URL` is now baked at build time to API FQDN; redeploy frontend if API FQDN changes
- Key Vault secrets are reused; ensure API app identity has Key Vault access (system-assigned identity auto-created by Bicep)
- Local dev continues using `docker-compose.yml` with separate images
