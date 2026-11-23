const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const importMap = html.match(/<script type="importmap">([^]*?)<\/script>/);
const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"\s*\/>/g)];
const entries = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)];

test('city module preloads start after the import map and before stylesheets', () => {
  assert.ok(importMap);
  assert.ok(preloads.length > 0);
  const stylesheetIndex = html.indexOf('rel="stylesheet"');
  for (const preload of preloads) {
    assert.ok(importMap.index < preload.index);
    assert.ok(preload.index < stylesheetIndex);
  }
  assert.equal(entries.length, 1);
  assert.ok(importMap.index < entries[0].index);
  assert.ok(entries[0].index < stylesheetIndex, 'the module graph starts loading early too');
  assert.match(html, /<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net" crossorigin\s*\/>/);
  const { imports } = JSON.parse(importMap[1]);
  assert.equal(imports.three, imports['three/webgpu'], 'Three.js aliases share one module instance');
});

test('native module entry and imports share canonical preloaded URLs on GitHub Pages', () => {
  const links = preloads.map((match) => match[1]);
  assert.equal(links.length, 34);
  assert.equal(new Set(links).size, links.length, 'each module is preloaded once');
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], './js/main.js');
  assert.ok(links.includes(entries[0][1]));
  assert.equal([...html.matchAll(/<script\b/g)].length, 2, 'only the import map and native entry are needed');
  const base = 'https://example.test/slop-newyork/';
  const urls = new Set(links.map((src) => new URL(src, base).href));
  for (const src of links) {
    assert.match(src, /^\.\/js\/[\w-]+\.js$/, 'preloads use the same unversioned paths as native imports');
    const source = readFileSync(join(__dirname, '..', src), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      const url = new URL(specifier, new URL(src, base));
      assert.ok(urls.has(url.href), `${src} imports an unpreloaded or mismatched URL: ${specifier}`);
    }
  }
});

test('three.js comes from one fixed commit, never a moving branch', () => {
  // (a branch such as "@dev" changes daily, and the CDN can serve its build files from different days at once: the
  // sky's light failed to build that way, and the city went dark)
  const { imports } = JSON.parse(importMap[1]);
  const commits = new Set();
  for (const [name, url] of Object.entries(imports)) {
    const at = url.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/mrdoob\/three\.js@([0-9a-f]{40})\//);
    assert.ok(at, `${name} is pinned to a full commit: ${url}`);
    commits.add(at[1]);
  }
  assert.equal(commits.size, 1, 'the builds and the addons come from the same commit');
});

test('the game is an installable app: a manifest with its icons, and a service worker registered by the entry module', () => {
  const { existsSync } = require('node:fs');
  const root = join(__dirname, '..');
  const link = html.match(/<link rel="manifest" href="([^"]+)"\s*\/>/);
  assert.ok(link, 'index.html links the manifest');
  const manifest = JSON.parse(readFileSync(join(root, link[1]), 'utf8'));
  // (relative, so it works from a folder of a site, as on GitHub Pages)
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(['fullscreen', 'standalone'].includes(manifest.display));
  const sizes = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`);
  for (const need of ['192x192 any', '512x512 any', '512x512 maskable']) assert.ok(sizes.includes(need), `icon ${need}`);
  for (const icon of manifest.icons) assert.ok(existsSync(join(root, icon.src)), `${icon.src} exists`);
  const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)"\s*\/>/);
  assert.ok(touch && existsSync(join(root, touch[1])), 'and the home screen icon for iOS');
  assert.ok(existsSync(join(root, 'sw.js')));
  assert.match(readFileSync(join(root, 'js/main.js'), 'utf8'), /serviceWorker\.register\('\.\/sw\.js'\)/);
  // The worker never serves the game's own files from its copy while the network answers: a new version is never held back
  const worker = readFileSync(join(root, 'sw.js'), 'utf8');
  assert.match(worker, /async function siteFile\(request\) \{\s*try \{\s*const response = await fetch\(request\);/);
});
