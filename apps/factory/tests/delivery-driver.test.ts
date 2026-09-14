import test from 'node:test';
import assert from 'node:assert/strict';
import { newDelivery, transition } from '../runtime/lib/delivery-state.ts';
import { reserveDriver, electDriver, ownsDriver, finishIfTerminal } from '../runtime/lib/delivery-driver-state.ts';

function delivery() {
  return newDelivery('operator', { operationId: '12345678-1234-4234-8234-123456789012', title: 'Useful change', brief: 'Implement a useful verified change through the factory.', maxRevisions: 3 });
}

test('a lost start receipt can elect only one driver for a generation', () => {
  const state = delivery();
  const reserved = reserveDriver(state, 'https://pinned.vercel.app', undefined, 1000)!;
  assert.equal(reserveDriver(state, 'https://new.vercel.app', undefined, 2000), null);
  const retry = reserveDriver(state, 'https://new.vercel.app', undefined, 62000)!;
  assert.equal(retry.generation, reserved.generation);
  assert.equal(retry.origin, 'https://pinned.vercel.app');
  assert.equal(electDriver(state, retry.generation, 'run-a'), true);
  assert.equal(electDriver(state, retry.generation, 'run-b'), false);
  assert.equal(ownsDriver(state, retry.generation, 'run-a'), true);
  assert.equal(reserveDriver(state, 'https://new.vercel.app', undefined, 100000), null);
});

test('completed driver generation can be resumed without changing station ownership', () => {
  const state = delivery();
  state.sessionId = 'worker-session';
  const first = reserveDriver(state, 'https://pinned.vercel.app', undefined, 1000)!;
  electDriver(state, first.generation, 'run-a');
  const resumed = reserveDriver(state, 'https://updated.vercel.app', 'run-a', 2000)!;
  assert.notEqual(resumed.generation, first.generation);
  assert.equal(state.sessionId, 'worker-session');
  assert.equal(electDriver(state, first.generation, 'run-a'), false);
  assert.equal(electDriver(state, resumed.generation, 'run-b'), true);
});

test('cancelled or human-review delivery never starts or elects a driver', () => {
  for (const phase of ['cancelled', 'human_review'] as const) {
    const state = delivery();
    const reserved = reserveDriver(state, 'https://pinned.vercel.app', undefined, 1000)!;
    transition(state, phase);
    assert.equal(electDriver(state, reserved.generation, 'run-a'), false);
    assert.equal(reserveDriver(state, 'https://pinned.vercel.app', undefined, 100000), null);
  }
});


test('resume between terminal observation and finish keeps the existing driver alive', () => {
  const state = delivery();
  state.sessionId = 'original-worker';
  const driver = reserveDriver(state, 'https://pinned.vercel.app', undefined, 1000)!;
  electDriver(state, driver.generation, 'run-a');
  transition(state, 'human_review'); // advanceDelivery returned false.
  transition(state, 'owner_resuming'); // /resume committed before finishDriver.
  assert.equal(reserveDriver(state, 'https://pinned.vercel.app', undefined, 2000), null);
  assert.equal(finishIfTerminal(state, driver.generation, 'run-a'), false);
  assert.equal(ownsDriver(state, driver.generation, 'run-a'), true);
  assert.equal(state.sessionId, 'original-worker');
});

test('revision after finish starts a new driver and a stale finish cannot stop it', () => {
  const state = delivery();
  const previous = reserveDriver(state, 'https://pinned.vercel.app', undefined, 1000)!;
  electDriver(state, previous.generation, 'run-a');
  transition(state, 'human_review');
  assert.equal(finishIfTerminal(state, previous.generation, 'run-a'), true);
  transition(state, 'revision_starting'); // /revise committed after finish CAS.
  const next = reserveDriver(state, 'https://pinned.vercel.app', undefined, 2000)!;
  assert.notEqual(next.generation, previous.generation);
  electDriver(state, next.generation, 'run-b');
  assert.equal(finishIfTerminal(state, previous.generation, 'run-a'), true);
  assert.equal(ownsDriver(state, next.generation, 'run-b'), true);
});
