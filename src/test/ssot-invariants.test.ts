/**
 * The single-source-of-truth architecture, asserted rather than assumed.
 *
 * WHY THIS SUITE EXISTS
 *   The contract layer removed a measured 38 duplicate type declarations, and
 *   a duplicate is cheap to reintroduce: two files that each typecheck are two
 *   files that pass CI, and a field added to one and not the other is invisible
 *   until a client reads `undefined`. Nothing structural prevents the next
 *   person from writing `export interface Guest` in a feature folder.
 *
 *   So the invariants are checked mechanically, and the divergences that remain
 *   are enumerated here with their reasons rather than left to be rediscovered.
 *   An allowed exception with a citation is documentation. An allowed exception
 *   with no reason is where the drift starts.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   It does not fail on the pre-existing duplicates. Several predate the
 *   contract layer, some are genuinely different shapes that share a name, and
 *   failing on them would mean either a large unrelated refactor in this change
 *   or a suite somebody skips. They are pinned at their current count instead,
 *   so the number can fall and cannot quietly rise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

/** Every first-party source file, excluding tests and generated output. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'ios', 'android', '.expo'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'test') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const root of ['src', 'server', 'packages/core/src', 'apps/mobile']) walk(path.join(ROOT, root));
  return out;
}

const FILES = sourceFiles();
const rel = (file: string) => path.relative(ROOT, file);
const read = (file: string) => fs.readFileSync(file, 'utf8');

/** Source with comments removed, so prose describing old code is not a match. */
function code(file: string): string {
  return read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Files declaring a given exported type or interface at top level. */
function declarers(name: string): string[] {
  const pattern = new RegExp(`^export (?:interface|type) ${name}\\b`, 'm');
  return FILES.filter((file) => pattern.test(read(file))).map(rel).sort();
}

describe('one transport', () => {
  it('nothing calls fetch except the two places that must', () => {
    // packages/core's transport IS the shared client, so it calls fetch by
    // definition. event-extraction is the LLM call, the only outbound request
    // to a third party the server makes. Everything else goes through one of
    // those two.
    const ALLOWED = new Set([
      'packages/core/src/http/transport.ts',
      'server/lib/event-extraction.ts',
      // Pre-existing. The only email sender that was ever correct, and the one
      // the web's four broken senders were measured against. It predates the
      // shared client reaching mobile and is listed rather than silently
      // permitted.
      'apps/mobile/lib/email.ts',
    ]);

    const offenders = FILES.filter((file) => /(^|[^.\w])fetch\s*\(/.test(code(file)))
      .map(rel)
      .filter((file) => !ALLOWED.has(file) && !file.includes('/mcp/'));

    expect(offenders, 'these bypass the shared transport').toEqual([]);
  });
});

describe('zod stays server-side', () => {
  it('no client module imports zod at runtime', () => {
    // The contracts subpath is server-only and types are re-exported with
    // `export type`, which TypeScript erases. That keeps zod out of both
    // bundles and keeps the two zod majors apart: root resolves 3.x and
    // apps/mobile/node_modules holds 4.x via eslint-plugin-react-hooks.
    const KNOWN_DEAD = new Set([
      // Both predate the contract layer and have zero production importers.
      // src/lib/validation.ts is imported only by src/test/hardening.test.ts;
      // the three schemas in src/lib/games.ts have no consumer of any kind.
      // Listed, not permitted: they should be deleted.
      'src/lib/validation.ts',
      'src/lib/games.ts',
    ]);

    const importers = FILES.filter((file) => /from ['"]zod['"]/.test(read(file)))
      .map(rel)
      .filter((file) => !file.startsWith('server/') && !file.includes('contracts/'))
      .filter((file) => !KNOWN_DEAD.has(file));

    expect(importers, 'zod reaching a client bundle').toEqual([]);
  });

  it('the bundle really has no zod in it', () => {
    const dist = path.join(ROOT, 'dist/assets');
    if (!fs.existsSync(dist)) return;
    const leaked = fs
      .readdirSync(dist)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /ZodError|ZodObject/.test(fs.readFileSync(path.join(dist, f), 'utf8')));
    expect(leaked).toEqual([]);
  });
});

describe('the contract owns the wire shapes it defines', () => {
  it('EntitlementView has exactly one declaration', () => {
    // This one was introduced by the billing work and briefly had two: one in
    // server/lib/entitlement.ts and one inferred from zod. Nothing pinned them
    // together, so a field added to either was invisible to the other. The
    // server now imports the inferred type, which makes the duplication
    // structurally impossible rather than merely tested for.
    expect(declarers('EntitlementView')).toEqual(['packages/core/src/contracts/billing.ts']);
    expect(code(path.join(ROOT, 'server/lib/entitlement.ts'))).toMatch(
      /from '@partyhause\/core\/contracts\/billing'/,
    );
  });

  it.each([
    ['SubscriptionStatus', ['packages/core/src/contracts/billing.ts']],
    ['SubscriptionSource', ['packages/core/src/contracts/billing.ts']],
    ['SubscriptionPlan', ['packages/core/src/contracts/billing.ts']],
    ['PaywallReason', ['packages/core/src/contracts/billing.ts', 'packages/core/src/paywall-copy.ts']],
  ])('%s has exactly one declaration', (name, expected) => {
    expect(declarers(name)).toEqual(expected);
  });

  it('the server reaches contracts by subpath, never the package root', () => {
    // The root barrel re-exports the HTTP transport, which uses DOM types such
    // as BodyInit. tsconfig.server.json declares types: ["node"] and no DOM
    // lib, so a root import drags a browser type graph into the server build
    // and fails on a line unrelated to whatever was being imported.
    const rootImporters = FILES.filter((f) => rel(f).startsWith('server/'))
      .filter((f) => /from ['"]@partyhause\/core['"]/.test(read(f)))
      .map(rel);
    expect(rootImporters, 'server importing the core root').toEqual([]);
  });
});

describe('mirrors that remain, and why', () => {
  it('ChatTurnResult is duplicated but pinned to the server by a test', () => {
    // server/lib/event-chat.ts declares it and contracts/ai.ts mirrors it.
    // Acceptable only because src/test/ai-planner-parity.test.ts compares the
    // template vocabulary against KNOWN_TEMPLATE_IDS and the transcript bounds
    // against MAX_MESSAGES / MAX_MESSAGE_CHARS, so the two cannot drift
    // silently. Remove that test and this duplication becomes a defect.
    expect(declarers('ChatTurnResult')).toEqual([
      'packages/core/src/contracts/ai.ts',
      'server/lib/event-chat.ts',
    ]);
    const parity = read(path.join(ROOT, 'src/test/ai-planner-parity.test.ts'));
    expect(parity).toMatch(/KNOWN_TEMPLATE_IDS/);
    expect(parity).toMatch(/MAX_MESSAGES/);
  });

  it('legal constants are triplicated and pinned by a test', () => {
    // Pre-existing. Web, server and packages/core each hold a copy, held
    // together only by src/test/legal-surfaces.test.ts, which also asserts the
    // published HTML carries the same version string.
    expect(declarers('SignupConsent').length).toBeGreaterThan(1);
    expect(fs.existsSync(path.join(ROOT, 'src/test/legal-surfaces.test.ts'))).toBe(true);
  });

  it('pre-existing domain duplicates do not increase', () => {
    // A ratchet, not a pass. These predate the contract layer: some are
    // genuinely different shapes sharing a name (the store's Guest is a
    // view-model, contracts/guest.ts is the wire shape), and fixing them is a
    // separate change. The count may fall and must not rise.
    const counts = Object.fromEntries(
      ['Guest', 'Poll', 'PollOption', 'TimelineBlock'].map((n) => [n, declarers(n).length]),
    );
    expect(counts).toEqual({ Guest: 3, Poll: 2, PollOption: 3, TimelineBlock: 2 });
  });
});
