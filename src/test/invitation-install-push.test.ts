/**
 * The invitation email asks for a reply first and an install second.
 *
 * WHY THE ORDER IS TESTED AND NOT JUST THE PRESENCE
 *   Replying is the thing the host needs, and the host is the paying customer.
 *   An install prompt of equal weight competes with the RSVP, and a guest who
 *   does neither is a worse outcome than one who replies and never installs.
 *   So position is the requirement, not decoration, and a later edit that
 *   promotes the install above the reply should fail here.
 *
 * WHY EMPTY MUST RENDER NOTHING
 *   There is no App Store URL yet: `apps/mobile/eas.json` has no `ascAppId`
 *   and no App Store Connect record exists. A placeholder would put a button
 *   in front of every recipient that 404s, which is the exact defect class
 *   this repository keeps finding, a control that looks complete and leads
 *   nowhere. Absent is honest; broken is not.
 *
 * WHY THERE IS NO ANDROID LINK
 *   `docs/mobile-ios-launch/07-ios-app-store-launch-requirements.md:82` names
 *   an Android launch a submission blocker, so at 1.0 there is nothing for an
 *   Android guest to install. That is precisely why RSVP stays answerable in
 *   a browser with no account, and why this prompt is an upsell and never a
 *   requirement.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_INSTALL_COPY,
  APP_STORE_URL,
  hasAppStoreLink,
} from '../../packages/core/src/app-install';

const ROOT = path.resolve(__dirname, '../..');
const RENDERER = fs.readFileSync(path.join(ROOT, 'server/lib/invitation-renderer.ts'), 'utf8');
const RSVP_PAGE = fs.readFileSync(path.join(ROOT, 'src/components/JoinEventPage.tsx'), 'utf8');

describe('the store link', () => {
  it('is empty until an App Store Connect record exists', () => {
    // If this fails because somebody filled it in, that is correct and the
    // expectation should flip. It fails on a *placeholder*, which is the
    // thing worth catching.
    expect(APP_STORE_URL).toBe('');
    expect(hasAppStoreLink()).toBe(false);
  });

  it('is not a guessed URL', () => {
    // A guessed apps.apple.com/id0000 renders a button that 404s for every
    // recipient of every invitation.
    expect(APP_STORE_URL).not.toMatch(/apps\.apple\.com/);
    expect(APP_STORE_URL).not.toMatch(/example|placeholder|TODO|REPLACE/i);
  });

  it('has one definition, shared by every surface', () => {
    // Three copies of a store URL is how emailTemplates came to exist twice
    // with different contents.
    const core = fs.readFileSync(path.join(ROOT, 'packages/core/src/app-install.ts'), 'utf8');
    expect(core).toMatch(/export const APP_STORE_URL/);
    expect(RENDERER).toMatch(/from '@partyhause\/core\/app-install'/);
    expect(RENDERER).not.toMatch(/apps\.apple\.com/);
  });

  it('is reached through the narrow subpath, not the package root', () => {
    // The root barrel re-exports the HTTP transport, which uses DOM types such
    // as BodyInit. tsconfig.server.json declares types: ["node"] and no DOM
    // lib, so a root import drags a browser type graph into the server build
    // and fails on a line unrelated to email.
    expect(RENDERER).not.toMatch(/from '@partyhause\/core'/);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'packages/core/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    expect(pkg.exports['./app-install']).toBeTruthy();
  });
});

describe('copy', () => {
  it('gives a reason rather than making a request', () => {
    // "Get our app" is an ask. "Check-in happens in the app" is information,
    // and only the second survives a guest asking why.
    expect(APP_INSTALL_COPY.body).toMatch(/check-in/i);
    expect(APP_INSTALL_COPY.body.toLowerCase()).not.toMatch(/download our|please install/);
  });

  it('does not promise an Android build that does not exist', () => {
    const core = fs.readFileSync(path.join(ROOT, 'packages/core/src/app-install.ts'), 'utf8');
    expect(core).not.toMatch(/play\.google\.com/);
    for (const value of Object.values(APP_INSTALL_COPY)) {
      expect(value.toLowerCase()).not.toContain('android');
      expect(value.toLowerCase()).not.toContain('google play');
    }
  });
});

describe('the renderer', () => {
  it('hides the whole block when there is no link', () => {
    expect(RENDERER).toMatch(/hasAppStoreLink\(\)\s*\?/);
    expect(RENDERER).toMatch(/:\s*''/);
  });

  it('places the install after the RSVP action, never before', () => {
    // Position is the requirement. An edit that promotes the install above
    // the reply should fail here rather than ship.
    const html = RENDERER.slice(RENDERER.indexOf('const html = `<!doctype html>'));
    const rsvpAt = html.indexOf('preview.actionLabel');
    const installAt = html.indexOf('${installHtml}');
    expect(rsvpAt).toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(rsvpAt);
  });

  it('keeps the RSVP button as the only styled call to action', () => {
    // One button. The install is a text link, which is what makes it
    // secondary to the eye as well as in the markup.
    const buttons = RENDERER.match(/background:#c02a16;color:#fff/g) ?? [];
    expect(buttons).toHaveLength(1);
  });

  it('escapes every value it interpolates', () => {
    // Invitation HTML is assembled by hand and mailed to people who did not
    // ask for it, so an unescaped interpolation is a stored-XSS vector with a
    // delivery mechanism attached.
    const block = RENDERER.slice(RENDERER.indexOf('const installHtml'), RENDERER.indexOf('const html ='));
    for (const token of ['APP_INSTALL_COPY.heading', 'APP_INSTALL_COPY.body', 'APP_INSTALL_COPY.action', 'APP_STORE_URL']) {
      expect(block, `${token} is interpolated unescaped`).toMatch(
        new RegExp(`escapeHtml\\(${token.replace('.', '\\.')}\\)`),
      );
    }
  });

  it('mirrors the block into the plain-text part', () => {
    // A text/plain alternative that omits the ask is a different email to
    // anyone whose client prefers it.
    const plain = RENDERER.slice(RENDERER.indexOf('const plainText'));
    expect(plain).toMatch(/hasAppStoreLink\(\)/);
    expect(plain).toMatch(/APP_INSTALL_COPY\.body/);
  });
});

// The RSVP page block was written and reverted.
//
// src/test/bundle-chunk-graph.test.ts:426 asserts the RSVP page contains no
// /install/i, under the heading "keeps social join, native promotion, and
// generic invitation APIs out of RSVP". That is grounded in the approved
// scope: docs/mobile-ios-launch/01-product-scope.md:106 gives an exhaustive
// list of what the page may show before submission, and an install prompt is
// not on it, while :103 says opening the route "does not install or open the
// native app".
//
// Putting the prompt there is therefore a scope amendment, not a UI change,
// and README.md:47-49 requires eight documents to move together for one. The
// email carries it; the RSVP page waits on that decision.
