# PartyHause Deployment State Document

**Generated**: 2026-09-20
**Status**: Pre-deployment (infrastructure not yet provisioned)
**Subscription**: `45bc20c4-efcb-4bd4-9c70-ee1dcf271880` (Azure subscription 1)
**User**: `oluwaferanmi@quantumindssi.com`
**Tenant**: `6a76f872-74c9-4882-88db-700c910b7cee` (Default Directory)

---

## Application Overview

**PartyHause** - Event planning platform with:
- Web: React 18.3.1 + Vite PWA (port 5173)
- API: Express 4.22.1 + TypeScript (port 3001)
- Mobile: Expo SDK 54 / React Native 0.81 (not yet built)
- Database: PostgreSQL 15 (Azure Flexible Server)
- Realtime: Azure Web PubSub (native WebSocket)
- Email: Azure Communication Services (primary) + Resend (fallback)
- Auth: Self-hosted JWT (HS256, bcryptjs cost 12)
- Storage: Azure Blob Storage

---

## Infrastructure (Bicep - Subscription Scope)

### Resource Group
- **Name**: `rg-partyhause-prod` (to be created)
- **Location**: `eastus2`

### Resources to be Created

| Resource | Name Pattern | Region | SKU/Config |
|----------|-------------|--------|------------|
| Log Analytics Workspace | `log-partyhause-{suffix}` | eastus2 | PerGB2018, 30-day retention |
| Key Vault | `kvph{suffix}` | eastus2 | Standard, deployer access policy |
| Container Registry | `acrpartyhause{suffix}` | eastus2 | Basic, admin enabled |
| PostgreSQL Flexible Server | `psqlph-{suffix}` | **centralus** | General Purpose, 2 vCores, 32GB |
| Storage Account | `stph{suffix}` | eastus2 | Standard LRS, blob containers |
| Web PubSub | `wps-partyhause-{suffix}` | eastus2 | Free tier, hub `partyhause` |
| Container Apps Env | `cae-partyhause-{suffix}` | eastus2 | Log Analytics integrated |
| Web Container App | `ca-web-partyhause-{suffix}` | eastus2 | 0.5 vCPU, 1GiB, min:1 max:3 |
| API Container App | `ca-api-partyhause-{suffix}` | eastus2 | 0.5 vCPU, 1GiB, min:1 max:3 |
| Azure Comm Services | `acsmail-partyhause-{suffix}` | global | Email service + domains |
| Azure OpenAI | `oai-partyhause-{suffix}` | eastus2 | S0, gpt-5-mini GlobalStandard |

### Key Configuration Details

**PostgreSQL**: Deployed in `centralus` (subscription restriction from eastus2). Cross-region latency acceptable.

**ACR**: Admin user enabled (required for `az acr build` credential fetch).

**Container Apps**: `minReplicas: 1` parameterized (previously reset to 0 by redeployment).

**Email**: ACS with AzureManagedDomain (immediate) + CustomerManaged `partyhause.uk` (requires DNS verification).

**Secrets**: All stored in Key Vault, referenced by Container Apps via `secretRef`.

---

## Required Deployment Parameters

### Must Provide at Deploy Time (no Key Vault yet)

| Parameter | Description | Source |
|-----------|-------------|--------|
| `postgresAdminPassword` | PostgreSQL admin password | **Provide inline** |
| `RESEND_API_KEY` | Resend API key (fallback email) | **Provide inline** |
| `jwtSecret` | HS256 JWT signing key (32+ chars) | **Provide inline** |
| `invitationTokenSecret` | HMAC key for invite tokens (32+ chars) | **Provide inline** |
| `entraApiClientSecret` | Entra B2C API client secret | Optional, empty OK |

### Pre-configured in `main.parameters.json`

| Parameter | Value |
|-----------|-------|
| `location` | `eastus2` |
| `resourceGroupName` | `rg-partyhause-prod` |
| `environmentTag` | `prod` |
| `postgresAdminLogin` | `partyadmin` |
| `postgresDbName` | `partyhause` |
| `RESEND_FROM_EMAIL` | `PartyHause <noreply@partyhause.uk>` |
| `entraTenantId` | `""` (empty) |
| `entraApiClientId` | `""` (empty) |
| `entraSpaClientId` | `""` (empty) |
| `entraSignUpSignInPolicy` | `B2C_1_susi` |
| `deployerObjectId` | `7adb1e8d-4944-4714-8192-fe2efa8a34bc` |

---

## Build-time Variables (for `az acr build` Web Image)

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://ca-api-partyhause-{suffix}.eastus2.azurecontainerapps.io` |
| `VITE_APP_NAME` | `PartyHause` |
| `VITE_APP_URL` | `https://partyhause.uk` |
| `VITE_ENTRA_TENANT_ID` | (omit) |
| `VITE_ENTRA_SPA_CLIENT_ID` | (omit) |
| `VITE_ENTRA_POLICY` | (omit) |

---

## Current State

### ✅ Completed
- Azure CLI authenticated (subscription `45bc20c4-efcb-4bd4-9c70-ee1dcf271880`)
- Bicep templates reviewed and understood
- Resource group does not exist (clean deployment)
- Key Vault from `main.parameters.json` is in **different subscription** (inaccessible)

### ⚠️ Blockers
1. **No Key Vault exists** in this subscription - secrets must be provided inline for initial deploy
2. **Custom domain `partyhause.uk`** DNS not verified - ACS custom domain will remain unlinked
3. **AcrPull role** not auto-assigned (`manageAcrPullAssignment` defaults `false`)

### 🔄 Next Steps
1. Provide 4-5 secret values inline
2. Run subscription-scoped deployment
3. Build and push container images via `az acr build`
4. Update Container Apps to specific image tags
5. Verify deployment health endpoints

---

## Deployment Command (Template)

```bash
az deployment sub create \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --parameters postgresAdminPassword="<PASSWORD>" \
  --parameters RESEND_API_KEY="<RESEND_KEY>" \
  --parameters jwtSecret="<JWT_SECRET_32_PLUS_CHARS>" \
  --parameters invitationTokenSecret="<INVITE_SECRET_32_PLUS_CHARS>" \
  --parameters entraApiClientSecret="" \
  --parameters deployerObjectId="7adb1e8d-4944-4714-8192-fe2efa8a34bc"
```

---

## Post-Deployment Actions

1. **Container Images**:
   ```bash
   # API
   az acr build -r acrpartyhause{suffix} -f Dockerfile.api -t partyhause-api:latest -t partyhause-api:{sha} .
   
# Web (with build args)
    az acr build -r acrpartyhause{suffix} -f Dockerfile \
      --build-arg VITE_API_URL="https://ca-api-partyhause-{suffix}.eastus2.azurecontainerapps.io" \
      --build-arg VITE_APP_NAME="PartyHause" \
      --build-arg VITE_APP_URL="https://partyhause.uk" \
      -t partyhause-web:latest -t partyhause-web:{sha} .
   ```

2. **Update Container Apps**:
   ```bash
   az containerapp update -n ca-web-partyhause-{suffix} -g rg-partyhause-prod \
     --image acrpartyhause{suffix}.azurecr.io/partyhause-web:{sha}
   az containerapp update -n ca-api-partyhause-{suffix} -g rg-partyhause-prod \
     --image acrpartyhause{suffix}.azurecr.io/partyhause-api:{sha}
   ```

3. **Verify**:
   - `GET /api/health` on API
   - Web app loads at container FQDN
   - Realtime negotiate endpoint works
   - Database migrations apply (`prisma migrate deploy`)

---

## Known Issues / Gaps (from AGENTS.md)

1. **Two HTTP clients** - Web (`src/lib/api-client.ts`) and Mobile (`packages/core/`) diverge
2. **Web routing split** - React Router + `currentPage` state machine (`| string` weakens typing)
3. **5 routers unused on web** - `timeline`, `event-templates`, `connections`, `cost-split`, `ai` (mobile)
4. **424 lint warnings** - mostly `no-explicit-any`
5. **Mobile**: 3,600 lines unreachable, 3 empty `onPress` handlers, 1 route push to non-existent `/settings/profile`
6. **No health probes** defined in Container App module
7. **Storage public blob access** enabled (intentional for `event-invites` container)
8. **Git remote** is `upstream-clean`, not `origin` - deploys from local tree via `az acr build`

---

## Environment Variables Reference (API Container App)

Runtime env vars set in `resources.bicep:308-358`:

- `NODE_ENV=production`
- `PORT=3001`
- `CORS_ALLOWED_ORIGINS` - comma-separated: custom domain + www + container FQDN
- `POSTGRES_*` - host, port, db, user, password (secret), DATABASE_URL (secret)
- `AZURE_STORAGE_*` - account, container, blob endpoint, connection string (secret)
- `WEBPUBSUB_ENDPOINT`, `WEBPUBSUB_CONNECTION_STRING` (secret)
- `JWT_SECRET` (secret), `INVITATION_TOKEN_SECRET` (secret)
- `ENTRA_*` - tenant, client ID, client secret (secret), policy
- `ACS_CONNECTION_STRING` (secret), `ACS_SENDER_ADDRESS`, `ACS_SENDER_DISPLAY_NAME`
- `RESEND_API_KEY` (secret), `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` (secret), `AZURE_OPENAI_API_VERSION`
- `VITE_APP_URL=https://partyhause.uk` (for email links)

---

## Verification Checklist

- [ ] Resource group created
- [ ] All 11 resources provisioned
- [ ] Key Vault accessible with deployer permissions
- [ ] ACR credentials work for `az acr build`
- [ ] API container starts (check logs for Prisma generate + migrate)
- [ ] Web container serves PWA (check nginx config)
- [ ] `/api/health` returns 200
- [ ] `/api/realtime/negotiate` returns Web PubSub URL
- [ ] Database schema matches Prisma (run migrations)
- [ ] Seed data applied
- [ ] Custom domain DNS verified → re-deploy with `linkCustomEmailDomain=true`
- [ ] AcrPull role assigned to Container Apps managed identities