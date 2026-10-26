// Checks for the website version: offline file list, security policy, install manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(join(project, 'vercel.json'), 'utf8'));
const www = join(project, config.outputDirectory);

function filesIn(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full) : [relative(www, full).replace(/\\/g, '/')];
  });
}

function precacheList() {
  const sw = readFileSync(join(www, 'sw.js'), 'utf8');
  const block = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1];
  return [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
}

test('every website file is saved for offline use, and every listed file exists', () => {
  const listed = new Set(precacheList());
  const missing = filesIn(www).filter(f => f !== 'sw.js' && !listed.has(f));
  assert.deepEqual(missing, [], 'add these to PRECACHE in sw.js');
  for (const path of listed) {
    if (path === './') continue;
    assert.ok(existsSync(join(www, path)), `${path} is listed in sw.js but does not exist`);
  }
});

test('the security policy allows exactly the inline theme script in index.html', () => {
  const html = readFileSync(join(www, 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1, 'index.html should have exactly one inline script');
  const hash = `'sha256-${createHash('sha256').update(inline[0][1], 'utf8').digest('base64')}'`;
  const csp = config.headers.flatMap(r => r.headers).find(h => h.key === 'Content-Security-Policy').value;
  assert.ok(csp.includes(hash), `update the script-src hash in vercel.json to ${hash}`);
});

test('install manifest is valid and its icons exist', () => {
  const manifest = JSON.parse(readFileSync(join(www, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
  assert.ok(manifest.icons.some(i => i.sizes === '192x192'));
  for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap(s => s.icons)]) {
    assert.ok(existsSync(join(www, icon.src)), `${icon.src} missing`);
  }
});
