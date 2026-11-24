import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext, Script } from 'node:vm';

const root = new URL('../web/', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const files = readdirSync(root, { withFileTypes: true });

test('browser scripts parse as JavaScript', () => {
  for (const file of files.filter((entry) => entry.isFile() && entry.name.endsWith('.js'))) {
    assert.doesNotThrow(() => new Script(read(file.name), { filename: file.name }));
  }
});

test('customer and admin pages reference their local assets in load order', () => {
  for (const [page, script] of [['index.html', 'app.js'], ['admin.html', 'admin.js']]) {
    const html = read(page);
    assert.match(html, /<title>GrowthPilot/);
    assert.match(html, /href="style\.css"/);
    const configPosition = html.indexOf('src="config.js"');
    assert.ok(configPosition >= 0 && html.indexOf(`src="${script}"`) > configPosition, page);
    assert.ok(read(script).length > 0);
  }
});

test('config uses the correct API for both localhost and production', () => {
  for (const [hostname, api] of [
    ['localhost', 'http://127.0.0.1:8000'],
    ['127.0.0.1', 'http://127.0.0.1:8000'],
    ['outreachos-web-indol.vercel.app', 'https://growthpilot-api-7ppc.onrender.com'],
  ]) {
    const context = { location: { hostname }, window: {} };
    runInNewContext(read('config.js'), context);
    assert.equal(context.window.API_BASE, api);
    assert.equal(context.window.USE_MOCK, false);
  }
});

test('public copy has no em dashes, and config contains no credentials', () => {
  const emDash = String.fromCodePoint(8212);
  for (const file of files.filter((entry) => entry.isFile() && /\.(html|js|css)$/.test(entry.name))) {
    const code = read(file.name);
    assert.ok(!code.includes(emDash) && !/&mdash;|&#8212;|&#x2014;|\\u2014/i.test(code), file.name);
  }
  assert.doesNotMatch(read('config.js'), /sk-ant-|postgres(?:ql)?:\/\/|npg_/i);
});
