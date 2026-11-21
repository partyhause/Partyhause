#!/usr/bin/env node
/**
 * Static validation of the Expo/EAS project identity and the App Store
 * surfaces. Runs in CI as `npm run doctor:mobile` and locally by hand.
 *
 * WHY THIS EXISTS
 *   Both GitHub workflows run this step, and before 2026-09-23 it referenced
 *   a script that did not exist, so the workflows failed at it once Actions
 *   billing unlocked. It is deliberately static (node:fs only, no Expo CLI,
 *   no mobile node_modules) because CI installs the root workspace and not
 *   apps/mobile, and because the property worth pinning in CI is structural:
 *   do the identity files exist, agree with each other, and carry the values
 *   an EAS build resolves by.
 *
 * What it checks:
 *   - app.json carries extra.eas.projectId (UUID) and owner, which
 *     eas.json's appVersionSource: "remote" cannot resolve a build without
 *   - app.config.ts spreads `...config` and does not set a literal `extra`,
 *     which would silently drop the project id from every build manifest
 *   - eas.json declares appVersionSource, a production build profile with
 *     auto-increment, and submit.production.ios.appleTeamId
 *   - the AASA file exists, parses, claims /join/*, and its appID is
 *     <appleTeamId>.<bundleIdentifier>, matching both other files
 *   - iOS and Android share one bundle identifier
 *   - the encryption-compliance key is declared, so export stops stalling
 *     on the ITSAppUsesNonExemptEncryption prompt
 *
 * Deeper guarantees (that a build actually starts, that the bundle exports)
 * belong to `src/test/eas-build-config.test.ts` and
 * `npm run build:ios:export`; this script is the cheap gate in front of them.
 *
 * Exit 0 when every check passes; exit 1 with a list otherwise.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP_JSON = path.join(ROOT, 'apps/mobile/app.json');
const APP_CONFIG = path.join(ROOT, 'apps/mobile/app.config.ts');
const EAS_JSON = path.join(ROOT, 'apps/mobile/eas.json');
const AASA = path.join(ROOT, 'public/.well-known/apple-app-site-association');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const failures = [];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function check(label, ok) {
  if (!ok) failures.push(label);
}

function configCodeNoComments() {
  return fs
    .readFileSync(APP_CONFIG, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
}

let appJson;
let easJson;
let aasa;

try {
  appJson = readJson(APP_JSON).expo;
} catch (err) {
  failures.push(`app.json unreadable: ${err.message}`);
}
try {
  easJson = readJson(EAS_JSON);
} catch (err) {
  failures.push(`eas.json unreadable: ${err.message}`);
}
try {
  aasa = readJson(AASA);
} catch (err) {
  failures.push(`AASA unreadable: ${err.message}`);
}

// --- EAS project identity (appVersionSource: "remote" requires these) ------
const projectId = appJson && appJson.extra && appJson.extra.eas && appJson.extra.eas.projectId;
check('app.json: extra.eas.projectId is missing (run `npm run eas:init` in apps/mobile)', Boolean(projectId));
check('app.json: extra.eas.projectId is not a UUID', Boolean(projectId) && UUID_RE.test(String(projectId)));
check('app.json: owner is missing', Boolean(appJson && appJson.owner));

// --- app.config.ts must not clobber the spread ------------------------------
let configCode = null;
try {
  configCode = configCodeNoComments();
} catch (err) {
  failures.push(`app.config.ts unreadable: ${err.message}`);
}
if (configCode !== null) {
  check('app.config.ts: no `...config` spread; app.json fields would not reach the build', configCode.includes('...config'));
  check('app.config.ts: sets a literal `extra`, which drops extra.eas.projectId', !/\bextra\s*:/.test(configCode));
}

// Bundle id and the infoPlist keys are set in app.config.ts, which overrides
// app.json wholesale, so app.json is not their authoritative source. Read
// them from the resolved-through-spread config file instead.
function fromConfig(pattern) {
  if (configCode === null) return null;
  const m = configCode.match(pattern);
  return m ? m[1] : null;
}

const bundleId = fromConfig(/bundleIdentifier:\s*"([^"]+)"/) ?? (appJson && appJson.ios && appJson.ios.bundleIdentifier) ?? null;
const usesNonExemptEncryption = fromConfig(/ITSAppUsesNonExemptEncryption:\s*(true|false)/) ?? null;

// --- eas.json ---------------------------------------------------------------
if (easJson) {
  check('eas.json: cli.appVersionSource is not "remote"', (easJson.cli && easJson.cli.appVersionSource) === 'remote');
  const prod = easJson.build && easJson.build.production;
  check('eas.json: build.production profile is missing', Boolean(prod));
  check('eas.json: production profile has no auto-increment', Boolean(prod && (prod.autoIncrement || (prod.ios && prod.ios.autoIncrement))));
  const teamId = easJson.submit && easJson.submit.production && easJson.submit.production.ios && easJson.submit.production.ios.appleTeamId;
  check('eas.json: submit.production.ios.appleTeamId is missing', Boolean(teamId) && typeof teamId === 'string');

  // --- Cross-file agreement: bundle id and the AASA appID -------------------
  check('app.config.ts: ios.bundleIdentifier is missing', Boolean(bundleId));
  const androidPackage = appJson && appJson.android && appJson.android.package;
  if (bundleId && androidPackage) {
    check(`bundle identifiers disagree: ios=${bundleId} android=${androidPackage}`, bundleId === androidPackage);
  }

  if (aasa && teamId && bundleId) {
    const expectedAppId = `${teamId}.${bundleId}`;
    // Modern AASA nests details under applinks; older formats were flat.
    const source = (aasa.applinks && Array.isArray(aasa.applinks.details)) ? aasa.applinks.details : aasa.details;
    const details = Array.isArray(source) ? source : [];
    const appIds = new Set();
    for (const entry of details) {
      if (entry.appID) appIds.add(entry.appID);
      if (Array.isArray(entry.appIDs)) for (const id of entry.appIDs) appIds.add(id);
    }
    check(`AASA: no appID entry for ${expectedAppId}`, appIds.has(expectedAppId));
    const paths = new Set();
    for (const entry of details) {
      if (Array.isArray(entry.paths)) for (const p of entry.paths) paths.add(p);
      if (entry.component && entry.component['/']) paths.add(entry.component['/']);
    }
    check('AASA: claims no /join/* path', paths.has('/join/*'));
  }

  // --- Export-compliance prompt ---------------------------------------------
  check('app.config.ts: ITSAppUsesNonExemptEncryption is not declared', usesNonExemptEncryption === 'false');
}

if (failures.length > 0) {
  console.error('mobile doctor: FAILED');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('mobile doctor: OK');
