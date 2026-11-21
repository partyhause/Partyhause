import { test, expect } from '@playwright/test';

const EMAIL = 'e2e-login@partyhause.local';
const PASSWORD = 'password123';

test('sign in → trace clearAuth callers', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[PAGE ERROR] ${err.message}`));

  await page.addInitScript(() => {
    const origClearAuth = (window as any).clearAuth;
    // Patch localStorage.removeItem to trace clears
    const origRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function (k: string) {
      origRemoveItem(k);
      if (k.includes('partyhause_auth')) {
        const stack = new Error().stack?.split('\n').slice(1, 6).join(' | ');
        (window as any).logStorage?.(`[REMOVE] ${k}\n  ${stack}`);
      }
    };
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k: string, v: string) {
      origSetItem(k, v);
      if (k.includes('partyhause_auth')) {
        (window as any).logStorage?.(`[SET] ${k}=${v.substring(0, 50)}`);
      }
    };
  });

  await page.exposeFunction('logStorage', (msg: string) => {
    logs.push(msg);
  });

  await page.goto('/auth/login');
  await expect(page.locator('#auth-email')).toBeVisible();

  await page.locator('#auth-email').fill(EMAIL);
  await page.locator('#auth-password').fill(PASSWORD);
  await page.locator('button:has-text("Sign In")').click();

  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => ({
    url: window.location.href,
    hasToken: localStorage.getItem('partyhause_auth_token') != null,
    hasUser: localStorage.getItem('partyhause_auth_user') != null,
  }));
  console.log('STATE:', JSON.stringify(state, null, 2));
  console.log('LOGS:', JSON.stringify(logs, null, 2));

  expect(state.hasToken).toBe(true);
  expect(state.hasUser).toBe(true);
});
