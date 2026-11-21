import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-engine render parity.
 *
 * SEPARATE FROM playwright.config.ts ON PURPOSE
 *   That config runs one project, chromium, and its specs need a live API and a
 *   scratch PostgreSQL database. Adding engines there would run those flows
 *   three times against one database and race them against each other. This
 *   config serves the built static bundle and nothing else, so it needs no
 *   database, no secrets, and can run on any machine that has the browsers.
 *
 * WHAT IT MEASURES
 *   Not screenshots. A pixel diff between Chromium and WebKit is mostly font
 *   rasterisation and tells you nothing actionable. What breaks render across
 *   engines is: an uncaught exception from a feature one engine lacks, an asset
 *   that fails to load, a layout that overflows its viewport, and a CSS
 *   property one engine silently drops. Those are measured directly.
 *
 * THE ENGINE SET
 *   Three engines cover every shipping browser. Chromium is Chrome, Edge, Opera,
 *   Brave and every Android browser. Gecko is Firefox. WebKit is Safari, and on
 *   iOS it is also Chrome, Firefox and Edge, because Apple requires it. So the
 *   two mobile projects below are not extra engines, they are the two engines
 *   again at phone viewports, where overflow and tap-target defects live.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /render-parity\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: './e2e/.artifacts-render',

  // `vite preview` serves dist/ exactly as the nginx container does for the
  // fingerprinted assets. Testing the dev server instead would test a bundle
  // that is never shipped: esbuild in dev, Rollup in build.
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // iOS Safari. Every browser on iOS is this engine.
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
    // Android Chrome.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
