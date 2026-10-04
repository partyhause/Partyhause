import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

/**
 * Pins the two provisioning invariants that keep declared infrastructure
 * from deleting state that was set out of band.
 *
 * 1. Key Vault access policies are ADDITIVE. An inline accessPolicies array
 *    on the vault resource is a PUT that replaces the whole array, and the
 *    live vault holds the API Container App's policy granted out of band with
 *    `az keyvault set-policy`. Provisioning with an inline array deleted that
 *    policy and the running API lost secret resolution. The grant must go
 *    through the vaults/accessPolicies child resource, whose PUT merges.
 *
 * 2. Web PubSub networkACLs are declared. A PUT that omits the property
 *    deletes the live Deny-by-default posture and silently rewidens the
 *    service to allow-all.
 */
describe('provisioning must not delete out-of-band live state', () => {
  it('grants the deployer policy through the additive accessPolicies child resource', () => {
    const kv = source('infra/modules/keyvault.bicep');
    expect(kv).toMatch(
      /resource deployerAccess 'Microsoft\.KeyVault\/vaults\/accessPolicies@2023-07-01'/,
    );
    // The child resource type PUTs merge; any other name or an inline array
    // on the vault would replace.
    expect(kv).toContain("name: 'add'");
  });

  it('the vault resource itself declares no inline accessPolicies array', () => {
    const kv = source('infra/modules/keyvault.bicep');
    const start = kv.indexOf("resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01'");
    const end = kv.indexOf("resource deployerAccess");
    expect(start, 'vault resource not found').toBeGreaterThan(-1);
    expect(end, 'deployer policy resource not found').toBeGreaterThan(start);
    // Comment lines are stripped before matching: the vault block carries
    // explanatory comments about the child resource, and the invariant is
    // about declarations, not prose. An inline `accessPolicies` property still
    // matches and still fails.
    const vaultBlock = kv
      .slice(start, end)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(vaultBlock).not.toMatch(/accessPolicies/);
  });

  it('the web pubsub template holds its deny-by-default network ACLs', () => {
    const wps = source('infra/modules/webpubsub.bicep');
    expect(wps).toContain("defaultAction: 'Deny'");
    expect(wps).toContain("'ServerConnection', 'ClientConnection', 'RESTAPI', 'Trace'");
  });
});
