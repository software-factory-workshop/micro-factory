import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyRegistry, reserveStation, bindStation } from '../runtime/lib/station-registry.ts';
import { emptyDocument, changeRecord } from '../shared/cockpit.ts';

const request = { operationId: '12345678-1234-4234-8234-123456789012', title: 'Fix the filter', brief: 'Keep the original task and its acceptance checks.' };

test('clearing or editing cockpit history cannot reroute the original owner', () => {
  const registry = emptyRegistry();
  reserveStation(registry, 'migrator', 'address', request);
  bindStation(registry, 'migrator', 'address', 'owner-session');
  const cockpit = emptyDocument();
  changeRecord(cockpit, 'runs', 'owner-session', { label: 'Wrong display metadata', station: 'quality-gate', rootAgent: 'quality-gate' }, 0);
  assert.equal(registry.sessions['owner-session'], 'migrator');
  changeRecord(cockpit, 'runs', 'owner-session', null, 1);
  assert.equal(registry.sessions['owner-session'], 'migrator');
});

test('station retries reuse their owner and reject conflicting request bodies', () => {
  const registry = emptyRegistry();
  assert.equal(reserveStation(registry, 'migrator', 'address', request).start, true);
  assert.equal(reserveStation(registry, 'migrator', 'address', request).start, false);
  assert.throws(() => reserveStation(registry, 'migrator', 'address', { ...request, brief: 'Different work' }), /different station request/);
  bindStation(registry, 'migrator', 'address', 'owner-session');
  assert.deepEqual(reserveStation(registry, 'migrator', 'address', request), { start: false, sessionId: 'owner-session' });
  assert.throws(() => bindStation(registry, 'migrator', 'address', 'replacement-session'), /another session/);
});

test('a session binding cannot be changed to another root', () => {
  const registry = emptyRegistry();
  reserveStation(registry, 'migrator', 'work', request);
  bindStation(registry, 'migrator', 'work', 'owner-session');
  reserveStation(registry, 'quality-gate', 'review', { operationId: request.operationId, prNumber: 18 });
  assert.throws(() => bindStation(registry, 'quality-gate', 'review', 'owner-session'), /another root/);
});
