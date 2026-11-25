const fs = require('fs');
const path = require('path');
const ROOT = '/Users/oluwaferanmi/Partyhause';
const INCLUDE_RE = /include\(\s*['"]([^'"]+)['"]\s*\)/;
const PATH_CALL_RE = /path\(\s*['"]([^'"]*)['"]/g;
const visited = new Set();
const routes = new Map();
function normalise(p) {
  if (!p) return null;
  let s = p.split('?')[0];
  s = s.replace(/\{\}/g, ':p').replace(/:[A-Za-z_][A-Za-z0-9_]*\??/g, ':p').replace(/<[A-Za-z]+:([A-Za-z_][A-Za-z0-9_]*)>/g, ':$1');
  s = s.replace(/\/+/g, '/').replace(/\/$/, '');
  return s || '/';
}
function collectRoutesFromFile(file, prefix) {
  if (visited.has(file)) return;
  visited.add(file);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  PATH_CALL_RE.lastIndex = 0;
  let m;
  while ((m = PATH_CALL_RE.exec(text))) {
    const routePath = m[1];
    const callStart = m.index;
    const lineEnd = text.indexOf('\n', callStart);
    const line = text.slice(callStart, lineEnd === -1 ? text.length : lineEnd);
    INCLUDE_RE.lastIndex = 0;
    const inc = INCLUDE_RE.exec(line);
    if (inc) {
      const included = path.join(ROOT, 'django', inc[1].split('.')[0], 'urls.py');
      const combined = normalise(prefix + '/' + routePath);
      collectRoutesFromFile(included, combined === '/' ? '' : combined);
      continue;
    }
    const full = normalise(prefix + '/' + routePath);
    const verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    for (const v of verbs) {
      const key = `${v} ${full}`;
      if (!routes.has(key)) routes.set(key, new Set());
      routes.get(key).add('<spread>');
    }
  }
}
collectRoutesFromFile(path.join(ROOT, 'django', 'partyhause', 'urls.py'), '');
console.log('Total routes:', routes.size);
const check = [
  'GET /api/mvp/events',
  'GET /api/mvp/events/:p',
  'POST /api/mvp/events',
  'GET /api/mvp/events/:p/invitations',
  'POST /api/mvp/events/:p/invitations/send',
  'GET /api/users/username-available',
  'POST /api/users/me/onboarding/skip',
  'GET /api/partyboard/tasks',
  'POST /api/send-email',
  'GET /api/billing/entitlement',
  'GET /api/mvp/account/deletion/:p',
];
for (const c of check) {
  console.log(c, '->', routes.has(c) ? 'FOUND' : 'MISSING');
}
