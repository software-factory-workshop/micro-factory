import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReview, deliveryRequest, newDelivery, requestResume, transition } from '../runtime/lib/delivery-state.ts';
import { ownerFromBody, ownerPublication, verifyOwnerStream } from '../runtime/lib/work-owner.ts';
import { workBranch } from '../runtime/lib/work-github.ts';
import { factoryRepositoryUrl } from '../runtime/lib/factory-config.ts';

const owner = 'wrun_owner';
const branch = workBranch(owner);
const a = 'a'.repeat(40);
const h = 'c'.repeat(40);
const task = deliveryRequest.parse({ operationId: '11111111-1111-4111-8111-111111111111', title: 'Jira state', brief: 'Create a useful stateful issue list' });
const revisionId = '22222222-2222-4222-8222-222222222222';
const revisionBrief = 'Address the independent review finding on the same branch';
const proof = { type: 'action.result', data: { status: 'completed', result: { kind: 'tool-result', toolName: 'publish_work', output: { station: 'migrator', sessionId: owner, revisionProtocol: 1, publication: { branch, number: 48, headSha: h, ownerSessionId: owner, targetBranch: 'main', targetHeadSha: a } } } } };

function streamSession(events: unknown[], tail = events.length - 1) {
  return {
    getStreamTailIndex: async () => tail,
    getEventStream: async (_options: { startIndex: number }) => new ReadableStream({ start(controller) { for (const event of events) controller.enqueue(event); controller.close(); } }),
  };
}
function published() {
  const s = newDelivery('tester', task);
  s.publication = { number: 48, url: `${factoryRepositoryUrl}/pull/48`, headSha: h, targetHeadSha: a, targetBranch: 'main', ownerSessionId: owner, branch };
  return s;
}
const blocking = { verdict: 'changes_requested', summary: 'needs work', headSha: h, baseSha: a, targetBranch: 'main', findings: [{ severity: 'blocking', path: 'apps/jira/app/app.vue', message: 'Save fails', evidence: 'reproduced' }], limitations: [] } as const;

test('active owner proof verifies the exact session, branch and PR', async () => {
  const publication = ownerPublication(proof, owner, 48, branch);
  assert.ok(publication);
  assert.equal(publication.ownerSessionId, owner);
  assert.equal(publication.branch, branch);
  assert.equal(publication.targetBranch, 'main');
  const verified = await verifyOwnerStream(streamSession([proof]), owner, 48, branch);
  assert.equal(verified.number, 48);
});

test('completed owner turn keeps verifiable proof without transferring ownership', async () => {
  const verified = await verifyOwnerStream(streamSession([proof, { type: 'turn.completed', data: {} }]), owner, 48, branch);
  assert.equal(verified.number, 48);
  assert.equal(verified.ownerSessionId, owner);
});

test('superseded deployment reproduces the PR 48 revision failure without losing ownership', async () => {
  const dead = { getStreamTailIndex: async () => { throw new Error('fetch failed'); }, getEventStream: async (_options: { startIndex: number }) => new ReadableStream({ start(c) { c.close(); } }) };
  const error = await verifyOwnerStream(dead, owner, 48, branch).catch((e: unknown) => e);
  assert.ok(error instanceof Error);
  assert.match(error.message, /cannot be reached in this deployment/);
});

test('missing or legacy proof stays unavailable and points at a child PR, never a replacement', async () => {
  const empty = await verifyOwnerStream(streamSession([], -1), owner, 48, branch).catch((e: unknown) => e);
  assert.match((empty as Error).message, /unavailable or predates revision support/);
  const legacy = structuredClone(proof);
  delete (legacy.data.result.output as { revisionProtocol?: number }).revisionProtocol;
  assert.equal(ownerPublication(legacy, owner, 48, branch), null);
  assert.equal(ownerPublication(proof, 'wrun_other', 48, branch), null);
  assert.equal(ownerPublication(proof, owner, 49, branch), null);
  assert.equal(ownerPublication(proof, owner, 48, 'factory/other'), null);
  assert.throws(() => ownerFromBody('please adopt my branch'), /No factory owner is recorded/);
});

test('blocked revision keeps its request and resumes the same operation, never a new worker', () => {
  const s = published();
  s.revisionRequests = { [revisionId]: revisionBrief };
  s.cycle++;
  s.operationId = revisionId;
  s.revisionBrief = revisionBrief;
  transition(s, 'revision_starting');
  s.failedPhase = 'revision_starting';
  s.error = 'The original owner cannot be reached in this deployment.';
  transition(s, 'blocked');
  requestResume(s);
  assert.equal(s.phase, 'revision_starting');
  assert.equal(s.operationId, revisionId);
  assert.equal(s.revisionBrief, revisionBrief);
  assert.equal(s.revisionRequests?.[revisionId], revisionBrief);
  assert.equal(s.publication?.ownerSessionId, owner);
});

test('blocking findings derive a stable revision operation across duplicate deliveries', () => {
  const first = published();
  const second = published();
  applyReview(first, { ...blocking, findings: [...blocking.findings] });
  applyReview(second, { ...blocking, findings: [...blocking.findings] });
  assert.equal(first.phase, 'revision_starting');
  assert.equal(first.operationId, second.operationId);
  assert.equal(first.publication?.ownerSessionId, owner);
});
