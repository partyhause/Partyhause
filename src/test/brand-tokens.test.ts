import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';

describe('Brand tokens - web', () => {
  it('tailwind config resolves coral through the mobile-aligned CSS variables', async () => {
    const cfg = await readFile(join(process.cwd(), 'tailwind.config.ts'), 'utf-8');
    // The token architecture: hexes live in src/tokens/mobile-aligned.css as
    // HSL triples; tailwind only references them. A raw hex here would drift
    // from the mobile palette this file exists to mirror.
    expect(cfg).toContain('500: "hsl(var(--coral-500))"');
    expect(cfg).toContain('700: "hsl(var(--coral-700))"');
  });

  it('CSS variables carry the brand palette', async () => {
    const css = await readFile(join(process.cwd(), 'src/tokens/mobile-aligned.css'), 'utf-8');
    // hsl(9 100% 60%) decodes to #FF5233, hsl(7 79% 42%) to #C02A16 — the
    // docs/BRAND.md coral anchors. The trailing comment names the hex each
    // triple must decode to.
    expect(css).toContain('--coral-500: 9 100% 60%');
    expect(css).toContain('--coral-700: 7 79% 42%');
    expect(css).toContain('--cream-50: 33 20% 91%');
  });

  it('index.css imports the token files before tailwind directives', async () => {
    const css = await readFile(join(process.cwd(), 'src/index.css'), 'utf-8');
    const importPos = css.indexOf("@import './tokens/mobile-aligned.css'");
    const tailwindPos = css.indexOf('@tailwind base;');
    expect(importPos).toBeGreaterThanOrEqual(0);
    expect(tailwindPos).toBeGreaterThan(importPos);
  });
});
