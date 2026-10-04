#!/usr/bin/env node
/**
 * Compare the per-engine artefacts `e2e/render-parity.spec.ts` writes.
 *
 * WHY THIS IS A SEPARATE STEP
 *   Playwright runs each project in its own process, so no assertion inside the
 *   spec can see two engines at once. Divergence between engines is exactly the
 *   thing the question "does this render the same everywhere" is asking about,
 *   and it is invisible from inside a single run. This reads what all of them
 *   wrote and reports where they disagree.
 *
 * WHAT COUNTS AS DIVERGENCE
 *   Layout boxes are compared only between engines that rendered at the same
 *   viewport width. Comparing a 1280px desktop box against a 390px phone box
 *   would report a difference on every element and mean nothing. Within a
 *   viewport group, a box that differs by more than the tolerance is a real
 *   layout difference: different engines, same width, same element, different
 *   geometry.
 *
 * Usage:
 *   npx playwright test --config=playwright.render.config.ts
 *   node scripts/compare-render-parity.mjs
 *
 * Exit codes: 0 no divergence beyond tolerance, 2 divergence found,
 *             1 no artefacts to compare.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const METRICS_DIR = path.join(process.cwd(), 'e2e', '.artifacts-render', 'metrics');

/**
 * Pixels of difference tolerated between engines at the same viewport.
 *
 * Not zero. Font metrics differ between rasterisers, so a text-sized element
 * legitimately varies by a pixel or two across engines and flagging that would
 * bury the real findings. Four is wide enough to absorb glyph rounding and
 * narrow enough that a dropped CSS property still shows up.
 */
const TOLERANCE_PX = 4;

/** @returns Every artefact, parsed. */
function loadMetrics() {
  if (!existsSync(METRICS_DIR)) return [];
  return readdirSync(METRICS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(METRICS_DIR, name), 'utf8')));
}

/**
 * Group records so only comparable things are compared.
 *
 * @param records All loaded artefacts.
 * @returns Map of "surface@viewportWidth" to the engine records sharing it.
 */
function groupBySurfaceAndViewport(records) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.surface}@${record.viewportWidth}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

/**
 * CSS features that at least one engine refused to support.
 *
 * A feature every engine supports is not interesting. A feature supported by
 * some and not others is the definition of a non-homogeneous render, and is
 * reported whether or not the page currently uses it, because a style that
 * silently does nothing in one browser is the hardest defect class to notice.
 *
 * @param records All loaded artefacts.
 * @returns Rows of { feature, supportedBy, missingFrom }.
 */
function cssDivergence(records) {
  const byFeature = new Map();
  for (const record of records) {
    for (const [feature, supported] of Object.entries(record.cssSupport ?? {})) {
      if (!byFeature.has(feature)) byFeature.set(feature, new Map());
      // One engine answers identically on every surface; last write is the same
      // value as the first.
      byFeature.get(feature).set(record.engine, supported);
    }
  }

  const rows = [];
  for (const [feature, engines] of byFeature) {
    const supportedBy = [...engines].filter(([, ok]) => ok).map(([engine]) => engine);
    const missingFrom = [...engines].filter(([, ok]) => !ok).map(([engine]) => engine);
    if (missingFrom.length > 0) rows.push({ feature, supportedBy, missingFrom });
  }
  return rows.sort((a, b) => a.feature.localeCompare(b.feature));
}

/**
 * Layout boxes that differ between engines at the same viewport.
 *
 * @param groups Output of groupBySurfaceAndViewport.
 * @returns Rows describing each divergent landmark.
 */
function layoutDivergence(groups) {
  const rows = [];

  for (const [key, records] of groups) {
    if (records.length < 2) continue;

    const selectors = new Set();
    for (const record of records) {
      for (const selector of Object.keys(record.landmarks ?? {})) selectors.add(selector);
    }

    for (const selector of selectors) {
      const present = records.filter((record) => record.landmarks?.[selector]);

      // An element one engine rendered and another did not is a bigger finding
      // than a few pixels, so it is reported before any measurement.
      if (present.length !== records.length) {
        rows.push({
          group: key,
          selector,
          kind: 'missing',
          detail: `rendered by ${present.map((r) => r.engine).join(', ') || 'none'}; absent in ${records
            .filter((record) => !record.landmarks?.[selector])
            .map((r) => r.engine)
            .join(', ')}`,
        });
        continue;
      }

      for (const dimension of ['x', 'y', 'width', 'height']) {
        const values = present.map((record) => ({
          engine: record.engine,
          value: record.landmarks[selector][dimension],
        }));
        const numbers = values.map((entry) => entry.value);
        const spread = Math.max(...numbers) - Math.min(...numbers);
        if (spread > TOLERANCE_PX) {
          rows.push({
            group: key,
            selector,
            kind: dimension,
            detail: `${spread}px spread: ${values.map((v) => `${v.engine}=${v.value}`).join(' ')}`,
          });
        }
      }
    }
  }

  return rows;
}

function main() {
  const records = loadMetrics();
  if (records.length === 0) {
    console.error(
      'No render-parity artefacts found. Run:\n  npx playwright test --config=playwright.render.config.ts',
    );
    process.exit(1);
  }

  const engines = [...new Set(records.map((record) => record.engine))].sort();
  const surfaces = [...new Set(records.map((record) => record.surface))].sort();
  console.log(`Engines:  ${engines.join(', ')}`);
  console.log(`Surfaces: ${surfaces.join(', ')}`);
  console.log(`Records:  ${records.length}`);
  console.log();

  const css = cssDivergence(records);
  console.log('CSS feature support divergence');
  if (css.length === 0) {
    console.log('  none: every probed feature is supported by every engine');
  } else {
    for (const row of css) {
      console.log(`  ${row.feature}`);
      console.log(`    supported: ${row.supportedBy.join(', ') || 'none'}`);
      console.log(`    MISSING:   ${row.missingFrom.join(', ')}`);
    }
  }
  console.log();

  const layout = layoutDivergence(groupBySurfaceAndViewport(records));
  console.log(`Layout divergence at equal viewport width (tolerance ${TOLERANCE_PX}px)`);
  if (layout.length === 0) {
    console.log('  none: every landmark matched across engines within tolerance');
  } else {
    for (const row of layout) {
      console.log(`  [${row.group}] ${row.selector} ${row.kind}: ${row.detail}`);
    }
  }
  console.log();

  const diverged = css.length + layout.length;
  console.log(diverged === 0 ? 'PASS: render is homogeneous across engines' : `FOUND: ${diverged} divergence(s)`);
  process.exit(diverged === 0 ? 0 : 2);
}

main();
