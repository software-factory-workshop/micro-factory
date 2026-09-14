import { readFile, access, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const authored = JSON.parse(await readFile('vercel.json', 'utf8'));
const agents = ['migrator', 'quality-gate', 'security-gate'];
assert.deepEqual(Object.keys(authored.services).sort(), ['web', ...agents].sort(), 'Expected one outer web workflow service and exactly three independent agent services');
assert.equal(authored.services.web.framework, 'nuxtjs');
assert.equal(authored.services.web.root, '.');
assert.deepEqual(authored.rewrites.at(-1), { source: '/(.*)', destination: { service: 'web' } }, 'The final catch-all must route cockpit, API and outer Workflow endpoints to Nuxt');
for (const name of agents) {
  const service = authored.services[name];
  assert.equal(service.framework, 'eve');
  assert.equal(service.root, `agents/${name}`);
  assert(!('routePrefix' in service), 'routePrefix is a generated Build Output field, not an authored Vercel service property');
  assert(authored.rewrites.some(route => route.source === `/${name}/(.*)` && route.destination?.service === name), `Missing public route for ${name}`);
  assert(service.routes.some(route => route.src === `^/${name}/(.*)$` && route.transforms?.some(transform => transform.type === 'request.path' && transform.op === 'set' && transform.args === '/$1')), `Missing namespace stripping for ${name}`);
  await access(`agents/${name}/agent/agent.ts`);
  const entries = await readdir(`agents/${name}/agent`);
  assert(!entries.includes('subagents'), `${name} must be an independent root, not a dispatcher`);
}
for (const prefix of ['/eve/v1', '/factory']) {
  assert(authored.rewrites.some(route => route.source === `${prefix}/(.*)` && route.destination?.service === 'migrator'), `Missing compatibility route for ${prefix}`);
}

// The Nuxt service owns WDK entrypoints. Eve builds its own workflow entrypoints
// separately in each service; a Nuxt-only CI build must not pretend to build them.
const config = JSON.parse(await readFile('.vercel/output/config.json', 'utf8'));
assert.equal(config.version, 3);
const files = await readdir('.vercel/output/functions', { recursive: true });
assert(files.some(file => file.includes('.well-known/workflow/v1/flow') && file.endsWith('.vc-config.json')), 'Outer Vercel Workflow flow function is missing');
assert(files.some(file => file.includes('.well-known/workflow/v1/step') && file.endsWith('.vc-config.json')), 'Outer Vercel Workflow step function is missing');
assert(!authored.rewrites.some(route => route.source.startsWith('/api/factory/') || route.source.startsWith('/.well-known/workflow/')), 'Outer workflow endpoints must remain on the Nuxt service');
console.log('Verified three independent Eve roots, compatibility routing, and outer Nuxt Workflow functions.');
