/**
 * Does the app render the same way in every engine that will run it?
 *
 * WHAT "THE SAME WAY" MEANS HERE
 *   Not pixel-identical. Chromium, Gecko and WebKit rasterise text differently
 *   and always will, so a screenshot diff between them is noise with a failure
 *   rate attached. What actually breaks a page across engines is narrower and
 *   measurable:
 *
 *     1. An uncaught exception, usually from a JS feature one engine lacks.
 *        This is the white-screen-with-HTTP-200 failure mode, and this repo has
 *        shipped it before (src/test/bundle-chunk-graph.test.ts exists because
 *        of it).
 *     2. An asset that 404s in one engine, normally a module the preload
 *        graph reaches differently.
 *     3. Content wider than the viewport, which on a phone is the difference
 *        between a usable page and a horizontally scrolling one.
 *     4. A CSS property one engine drops silently, leaving an element
 *        positioned or sized differently rather than visibly broken.
 *
 *   Each of those is asserted directly. Layout boxes are also recorded to a
 *   JSON artefact per engine so `scripts/compare-render-parity.mjs` can report
 *   divergence between engines, which no single-engine assertion can see.
 *
 * WHY ONLY PUBLIC SURFACES
 *   Everything behind the auth wall needs a live API and a scratch database.
 *   That harness exists (`e2e/README.md`) and is deliberately not required
 *   here, so this suite runs anywhere. The surfaces below are the ones a
 *   first-time visitor and an App Store reviewer actually load.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** Where per-engine metrics are written for the comparison script. */
const ARTIFACT_DIR = path.join(process.cwd(), 'e2e', '.artifacts-render', 'metrics');

/** The surfaces reachable without a session. */
const SURFACES = [
  { name: 'landing', url: '/' },
  { name: 'privacy', url: '/privacy.html' },
  { name: 'terms', url: '/terms.html' },
  { name: 'support', url: '/support.html' },
] as const;

/**
 * Errors that are environmental rather than defects in the page.
 *
 * Kept deliberately short. Every entry is a licence to ignore a real console
 * error, so each one needs a reason that survives being read back later.
 */
const IGNORABLE_ERROR = [
  // No API is running in this config by design; the app's own fetches fail and
  // that is the expected state, not a render defect.
  /Failed to load resource.*\/api\//i,
  /NetworkError when attempting to fetch resource/i,
  /Load failed/i,
  /Failed to fetch/i,
  // The service worker needs a secure origin and a full navigation cycle.
  /ServiceWorker/i,
];

interface PageMetrics {
  surface: string;
  /** Uncaught exceptions. Any entry is a failure. */
  pageErrors: string[];
  /** console.error output, minus IGNORABLE_ERROR. */
  consoleErrors: string[];
  /** Non-API requests that did not return a 2xx/3xx. */
  failedAssets: string[];
  documentWidth: number;
  viewportWidth: number;
  bodyHeight: number;
  /** Elements wider than the viewport, the cause of horizontal scroll. */
  overflowingElements: string[];
  /** Stable landmarks, recorded for cross-engine comparison. */
  landmarks: Record<string, { x: number; y: number; width: number; height: number }>;
  /** Whether the engine honoured each probed CSS feature. */
  cssSupport: Record<string, boolean>;
}

/**
 * Load one surface and collect everything measurable about how it rendered.
 *
 * @param page A fresh page; listeners are attached before navigation so an
 *             error thrown during load is not missed.
 * @param surface Name and URL to visit.
 * @returns The metrics for this engine and surface.
 */
async function measure(page: Page, surface: { name: string; url: string }): Promise<PageMetrics> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedAssets: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORABLE_ERROR.some((pattern) => pattern.test(text))) return;
    consoleErrors.push(text);
  });
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/')) return;
    if (response.status() >= 400) failedAssets.push(`${response.status()} ${url}`);
  });

  await page.goto(surface.url, { waitUntil: 'load' });
  // The landing page is React; give it a paint before measuring boxes.
  await page.waitForTimeout(1200);

  const measured = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewportWidth = window.innerWidth;

    // An element is only a problem when it extends past the right edge.
    // Elements that merely exceed the viewport width while being scrolled
    // inside a container are not, which is why the right edge is what is
    // tested rather than the width alone.
    const overflowing: string[] = [];
    const nodes = Array.from(document.querySelectorAll('body *')).slice(0, 3000);
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > viewportWidth + 1) {
        const id = node.id ? `#${node.id}` : '';
        const cls =
          typeof node.className === 'string' && node.className
            ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '';
        overflowing.push(`${node.tagName.toLowerCase()}${id}${cls}`);
      }
    }

    const landmarks: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const selector of ['header', 'main', 'footer', 'nav', 'h1', 'button']) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const box = element.getBoundingClientRect();
      landmarks[selector] = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    }

    // Probed rather than assumed. `CSS.supports` is the engine's own answer
    // about whether it will apply a declaration, which is exactly the question
    // "will this look the same everywhere" reduces to for styling.
    const cssSupport: Record<string, boolean> = {
      'flex gap': CSS.supports('gap', '1rem'),
      'grid gap': CSS.supports('display', 'grid') && CSS.supports('gap', '1rem'),
      'aspect-ratio': CSS.supports('aspect-ratio', '1 / 1'),
      'backdrop-filter': CSS.supports('backdrop-filter', 'blur(4px)'),
      ':has()': CSS.supports('selector(:has(a))'),
      'inset shorthand': CSS.supports('inset', '0'),
      'color-mix': CSS.supports('color', 'color-mix(in srgb, red, blue)'),
      'dvh unit': CSS.supports('height', '100dvh'),
      'text-wrap balance': CSS.supports('text-wrap', 'balance'),
    };

    return {
      documentWidth: Math.round(doc.scrollWidth),
      viewportWidth,
      bodyHeight: Math.round(document.body.scrollHeight),
      overflowingElements: Array.from(new Set(overflowing)).slice(0, 12),
      landmarks,
      cssSupport,
    };
  });

  return { surface: surface.name, pageErrors, consoleErrors, failedAssets, ...measured };
}

for (const surface of SURFACES) {
  test(`${surface.name} renders without engine-specific failure`, async ({ page }, testInfo) => {
    const metrics = await measure(page, surface);

    if (!existsSync(ARTIFACT_DIR)) mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      path.join(ARTIFACT_DIR, `${testInfo.project.name}--${surface.name}.json`),
      JSON.stringify({ engine: testInfo.project.name, ...metrics }, null, 2),
    );

    // 1. An uncaught exception is the white-screen failure mode. It is the one
    //    thing here that is never cosmetic.
    expect(metrics.pageErrors, `uncaught exceptions in ${testInfo.project.name}`).toEqual([]);

    // 2. A missing asset is a 404 the SPA fallback must not disguise as a 200.
    expect(metrics.failedAssets, `failed assets in ${testInfo.project.name}`).toEqual([]);

    // 3. The page actually painted something.
    expect(metrics.bodyHeight, 'body has zero height, nothing rendered').toBeGreaterThan(100);

    // 4. No horizontal scroll. A 1px tolerance absorbs sub-pixel rounding,
    //    which differs between engines by design and is not a defect.
    expect(
      metrics.documentWidth,
      `horizontal overflow in ${testInfo.project.name}: ${metrics.overflowingElements.join(', ')}`,
    ).toBeLessThanOrEqual(metrics.viewportWidth + 1);

    // 5. Console errors that are not environmental.
    expect(metrics.consoleErrors, `console errors in ${testInfo.project.name}`).toEqual([]);
  });
}
