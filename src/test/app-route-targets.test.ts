/**
 * Every route App.tsx registers must point at a screen that exists.
 *
 * WHAT THIS SUITE DEFENDS
 *   App.tsx lazy-imports each screen and mounts it under a route. On
 *   2026-10-25 the journey shipped with `PaymentStep` imported and routed
 *   but the file never written: Vite answered the transform request for
 *   App.tsx with a 500 ("Failed to resolve import") and every page in the
 *   app failed to load, because App.tsx is the module every page loads.
 *   The error lived in the dev-server log, not in any test, and typecheck
 *   did not catch it because the import was lazy — `tsc` resolves it, but
 *   the workflow that would have run `tsc` had not been run for the
 *   uncommitted change. This suite makes the class loud instead: a route
 *   whose target is missing fails here, at the exact boundary that broke.
 *
 * WHY THIS IS A FILE-EXISTENCE TEST AND NOT A RENDER TEST
 *   Rendering each route would need a router, a store and a fetch stack
 *   per screen; existence is the contract that actually broke, and it is
 *   the one a rewrite can silently violate by renaming a screen file
 *   without touching App.tsx. The regexes are anchored to App.tsx only,
 *   where routes and imports meet.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APP_TSX = path.resolve(ROOT, 'src/App.tsx');

/** `@/` alias, as vite.config.ts and tsconfig.app.json define it. */
function aliasTarget(specifier: string): string {
  return path.resolve(ROOT, 'src', specifier.replace(/^@\//, ''));
}

describe('App.tsx: every lazy route target exists on disk', () => {
  const source = fs.readFileSync(APP_TSX, 'utf-8');

  const dynamicImports = [...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map(
    (m) => m[1],
  );

  it('finds the lazy imports at all, so the suite rots loudly instead of passing empty', () => {
    // App.tsx has ~20 lazy screens today. A refactor to eager imports or a
    // bundler-level route map would drive this to zero and silently
    // dis-arm the suite; the floor forces that refactor to touch this file.
    expect(dynamicImports.length).toBeGreaterThanOrEqual(10);
  });

  it('resolves every lazy import to a file that exists', () => {
    expect(dynamicImports.length).toBeGreaterThan(0);
    const missing = dynamicImports.filter((spec) => {
      if (!spec.startsWith('@/')) return false; // package imports resolve via node_modules
      const base = aliasTarget(spec);
      return (
        !fs.existsSync(base) &&
        !fs.existsSync(`${base}.ts`) &&
        !fs.existsSync(`${base}.tsx`) &&
        !fs.existsSync(path.join(base, 'index.ts')) &&
        !fs.existsSync(path.join(base, 'index.tsx'))
      );
    });
    expect(missing, `route screens missing on disk: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the named export each import destructures', () => {
    // `import("...x").then(m => ({ default: m.PaymentStep }))` — the file
    // existing is not enough; the export the route renders must be there
    // too, or the route mounts `undefined` and React throws at render.
    const destructured = [
      ...source.matchAll(/import\(\s*["'](@\/[^"']+)["']\s*\)\.then\(\s*m\s*=>\s*\(\{\s*default:\s*m\.(\w+)\s*\}\)\s*\)/g),
    ];
    expect(destructured.length).toBeGreaterThan(0);
    const broken = destructured.filter(([, spec, name]) => {
      const base = aliasTarget(spec);
      const candidates = [`${base}.ts`, `${base}.tsx`].filter((p) => fs.existsSync(p));
      if (candidates.length === 0) return false; // missing file is the previous test's failure
      const text = candidates.map((p) => fs.readFileSync(p, 'utf-8')).join('\n');
      return !new RegExp(`\\b${name}\\b`).test(text);
    });
    expect(broken, `screens missing their named export: ${broken.map((b) => b.slice(1).join(' → ')).join(', ')}`).toEqual([]);
  });
});
