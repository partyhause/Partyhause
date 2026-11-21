// modules/keyvault.bicep — Azure Key Vault for secrets
// Stores DB admin password, Resend API key, Web PubSub connection string, etc.

@description('Azure region')
param location string

@description('Key Vault name (3-24 chars, alphanumeric + hyphens, globally unique)')
param keyVaultName string

@description('Object ID of the deployer (current user/SP) to grant access policy')
param deployerObjectId string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: false
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
    // An empty array is valid on create: the deployer grant is added by the
    // child accessPolicies resource below (additive, never replacing). Omitting
    // the property entirely makes the RP answer BadRequest
    // ("The parameter accessPolicies is not specified") on a fresh vault.
    accessPolicies: []
  }
}

// Additive, never replacing. A vault-scoped accessPolicies child PUT merges
// the listed policies and leaves every policy it does not name in place,
// which is why the deployer grant lives here and not inline on the vault:
// inline accessPolicies REPLACE the whole array on PUT, and the array on the
// live vault also holds the API Container App's out-of-band policy
// (`az keyvault set-policy` at cutover). Declaring the deployer policy inline
// deleted that policy on the next provisioning run, and the running API lost
// secret resolution. The child resource cannot reproduce that failure.
//
// Guard against an unset AZURE_DEPLOYER_OBJECT_ID secret: an empty objectId
// fails the whole vault write with BadRequest ("Invalid value found at
// accessPolicies[0].ObjectId"). No id -> no policy, vault still deploys.
resource deployerAccess 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = if (!empty(deployerObjectId)) {
  name: 'add'
  parent: keyVault
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: deployerObjectId
        permissions: {
          keys: ['get', 'list', 'create', 'delete', 'purge']
          secrets: ['get', 'list', 'set', 'delete', 'purge']
          certificates: ['get', 'list', 'delete', 'purge']
        }
      }
    ]
  }
}

output keyVaultName string = keyVault.name
output keyVaultId string = keyVault.id
output keyVaultUri string = keyVault.properties.vaultUri
