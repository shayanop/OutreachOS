import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

function origin(name) {
  const url = new URL(process.env[name]);
  assert.equal(url.protocol, 'https:', `${name} must use HTTPS`);
  assert.equal(url.href, `${url.origin}/`, `${name} must be an origin without credentials or a path`);
  return url.origin;
}

function revision() {
  const value = process.env.GITHUB_SHA ?? '';
  assert.match(value, /^[a-f0-9]{40}$/, 'Expected the Git revision to deploy');
  return value;
}

function get(url, options = {}) {
  return fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000), ...options });
}

async function waitForRelease(name, probe) {
  const deadline = Date.now() + 360_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await probe();
    } catch (error) {
      lastError = error;
      await delay(8_000);
    }
  }
  throw new Error(`${name} did not become ready: ${lastError?.message ?? 'no response'}`);
}

async function triggerRender() {
  let hook;
  try {
    hook = new URL(process.env.RENDER_DEPLOY_HOOK_URL);
  } catch {
    throw new Error('RENDER_DEPLOY_HOOK_URL is not a valid URL');
  }
  assert.ok(
    hook.origin === 'https://api.render.com' && /^\/deploy\/srv-[a-z0-9]+$/.test(hook.pathname)
    && hook.searchParams.has('key') && !hook.username && !hook.password,
    'Expected a Render service deploy hook',
  );
  hook.searchParams.set('ref', revision());
  const response = await fetch(hook, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  }).catch(() => { throw new Error('Render deploy hook could not be reached'); });
  assert.ok(response.ok, `Render rejected the deploy hook (HTTP ${response.status})`);
  console.log('Render accepted the deployment request.');
}

async function checkBackend() {
  const api = origin('PROD_API_URL');
  const web = origin('PROD_WEB_URL');
  await waitForRelease('Render', async () => {
    const health = await get(`${api}/health`);
    assert.equal(health.status, 200, 'Health status');
    assert.equal(await health.text(), 'ok', 'Health response');
    assert.equal(health.headers.get('x-outreachos-revision'), revision(), 'Deployed API revision');
  });

  const [spec, pipeline, admin] = await Promise.all([
    get(`${api}/openapi.json`),
    get(`${api}/me/pipeline?user_id=ci-smoke-${randomUUID()}`, { headers: { Origin: web } }),
    get(`${api}/admin/stats`),
  ]);
  assert.equal(spec.status, 200, 'OpenAPI is available');
  const apiSpec = await spec.json();
  assert.ok(apiSpec.paths['/chat'].post.responses['200'], 'Chat POST contract exists');
  assert.deepEqual(apiSpec.components.schemas.ChatIn.required.sort(), ['message', 'thread_id', 'user_id']);
  assert.deepEqual(Object.keys(apiSpec.components.schemas.TokenUsage.properties).sort(), ['in', 'out']);
  assert.equal(pipeline.status, 200, 'Neon-backed read succeeds');
  const rows = await pipeline.json();
  assert.ok(Array.isArray(rows) && rows.length === 0, 'Smoke user starts with an empty pipeline');
  assert.ok(['*', web].includes(pipeline.headers.get('access-control-allow-origin')), 'Vercel CORS');
  assert.equal(admin.status, 401, 'Admin endpoint rejects unauthenticated requests');
  console.log('Render revision, API contract, Neon read, CORS, and admin protection verified.');
}

async function checkFrontend() {
  const web = origin('PROD_WEB_URL');
  const api = origin('PROD_API_URL');
  await waitForRelease('Vercel', async () => {
    const marker = await get(`${web}/release.json?revision=${revision()}`);
    assert.equal(marker.status, 200, 'Frontend release marker is available');
    assert.equal((await marker.json()).revision, revision(), 'Deployed frontend revision');
  });
  const [home, admin, config] = await Promise.all([
    get(`${web}/`), get(`${web}/admin`), get(`${web}/config.js`),
  ]);
  assert.equal(home.status, 200, 'Customer page is public');
  assert.match(await home.text(), /<title>GrowthPilot/);
  assert.equal(admin.status, 200, 'Admin page loads');
  assert.match(await admin.text(), /<title>GrowthPilot/);
  assert.equal(config.status, 200, 'Production config loads');
  const configText = await config.text();
  assert.ok(configText.includes(api), 'Frontend targets the verified Render API');
  assert.match(configText, /window\.USE_MOCK\s*=\s*false/);
  console.log('Vercel revision, customer and admin pages, and production API URL verified.');
}

const commands = { 'trigger-render': triggerRender, backend: checkBackend, frontend: checkFrontend };
const command = commands[process.argv[2]];
if (!command) throw new Error('Use trigger-render, backend, or frontend');
await command();
