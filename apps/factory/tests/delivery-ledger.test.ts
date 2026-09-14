import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DELIVERY_HISTORY,
  admissionRecoveryAction,
  answerOwnerQuestion,
  askOwnerQuestion,
  beginRevision,
  canTransition,
  claimAdvance,
  commitAdvance,
  deliveryReceiptSchema,
  deliveryRequest,
  newDelivery,
  normalizeDelivery,
  requestResume,
  recordAdmissionFailure,
  retryAdmission,
  transition,
  terminal,
  workStateValues,
  workStateForPhase,
} from '../runtime/lib/delivery-state.ts';

const task = deliveryRequest.parse({
  operationId: '11111111-1111-4111-8111-111111111111',
  title: 'Ledger test',
  brief: 'Exercise the work ledger with a durable factory transition.',
});

function delivery() {
  return newDelivery('ledger-test', task);
}

test('new work has a canonical projection and an admission receipt', () => {
  const state = delivery();
  const receipt = state.pendingReceipts?.[0];

  assert.equal(state.schemaVersion, 1);
  assert.equal(state.kind, 'code_change');
  assert.equal(state.state, 'queued');
  assert.equal(state.phase, 'worker_starting');
  assert.equal(state.attempt, 1);
  assert.deepEqual(state.observation, { lastEventIndex: -1, lastEventAt: state.createdAt });
  assert.equal(receipt?.from, null);
  assert.equal(receipt?.to, 'worker_starting');
  assert.equal(receipt?.state, 'dispatched');
  deliveryReceiptSchema.parse(receipt);
});

test('failed outer admission is traceable and same-operation retry reuses the delivery', () => {
  const state = delivery();
  const deliveryId = state.id;
  const recovery = admissionRecoveryAction(state.id, state.request);

  recordAdmissionFailure(state, new Error('Outer workflow POST returned HTTP 500'));

  assert.equal(deliveryId, newDelivery('ledger-test', task).id);
  assert.equal(recovery.body.operationId, task.operationId);
  assert.equal(state.phase, 'blocked');
  assert.equal(state.state, 'failed');
  assert.equal(state.failedPhase, 'worker_starting');
  assert.match(state.error || '', /Outer workflow admission failed/);
  assert.deepEqual(recovery, {
    method: 'POST',
    path: '/factory/delivery',
    body: task,
    description: 'Retry the original request with the same operationId. The deterministic delivery ID is reused and outer admission is retried.',
  });

  assert.equal(retryAdmission(state), true);
  assert.equal(state.id, deliveryId);
  assert.equal(recovery.body, task);
  assert.equal(state.request.operationId, recovery.body.operationId);
  assert.equal(state.phase, 'worker_starting');
  assert.equal(state.failedPhase, undefined);
  assert.equal(state.admissionFailure, undefined);
  assert.equal(retryAdmission(state), false);
});

test('legacy projections are upgraded without changing the durable phase', () => {
  const legacy = { ...delivery() } as Record<string, unknown>;
  delete legacy.schemaVersion;
  delete legacy.kind;
  delete legacy.state;
  delete legacy.attempt;

  const normalized = normalizeDelivery(legacy as Parameters<typeof normalizeDelivery>[0]);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.kind, 'code_change');
  assert.equal(normalized.phase, 'worker_starting');
  assert.equal(normalized.state, 'queued');
  assert.equal(normalized.attempt, 1);
});

test('transitions update the projection and produce an attributed receipt', () => {
  const state = delivery();
  state.usage = { model: 'meta/example', inputTokens: 120, outputTokens: 30, usd: 0.125, factorySha: 'a'.repeat(40) };
  state.failure = {
    code: 'provider_unavailable',
    kind: 'provider',
    message: 'The provider is unavailable.',
    status: 502,
    retryable: true,
    preservePhase: true,
  };
  const receipt = transition(state, 'working', {
    actor: 'workflow',
    reason: 'The worker execution was accepted by the host.',
  });

  assert.equal(state.state, 'running');
  assert.equal(state.version, 2);
  assert.equal(state.history.at(-1)?.phase, 'worker_starting');
  assert.equal(state.history.at(-1)?.to, 'working');
  assert.equal(state.history.at(-1)?.receiptId, receipt?.receiptId);
  assert.equal(receipt?.expectedVersion, 1);
  assert.equal(receipt?.state, 'dispatched');
  assert.equal(receipt?.model, state.usage.model);
  assert.equal(receipt?.inputTokens, state.usage.inputTokens);
  assert.equal(receipt?.outputTokens, state.usage.outputTokens);
  assert.equal(receipt?.usd, state.usage.usd);
  assert.equal(receipt?.factorySha, state.usage.factorySha);
  assert.deepEqual(receipt?.failure, state.failure);
  deliveryReceiptSchema.parse(receipt);
});

test('the same operation derives the same receipt identity on retry', () => {
  const first = delivery();
  const retry = delivery();
  const options = { operationId: 'stable-operation', reason: 'Same transition intent.' };

  const firstReceipt = transition(first, 'working', options);
  const retryReceipt = transition(retry, 'working', options);

  assert.equal(firstReceipt?.receiptId, retryReceipt?.receiptId);
});

test('illegal transitions fail closed while same-phase retries are no-ops', () => {
  const state = delivery();
  const version = state.version;

  assert.equal(canTransition('merged', 'working'), false);
  assert.equal(transition(state, 'worker_starting'), undefined);
  assert.equal(state.version, version);
  assert.throws(() => transition(state, 'merged'), /Illegal delivery transition/);
});

test('revisions create a new attempt but owner continuation does not', () => {
  const revised = delivery();
  transition(revised, 'human_review');
  beginRevision(revised, 'revision-operation', 'Preserve the original task and fix the reviewed issue.', { actor: 'operator' });
  assert.equal(revised.cycle, 1);
  assert.equal(revised.attempt, 2);

  const resumed = delivery();
  resumed.childSessionId = 'existing-owner';
  transition(resumed, 'human_review');
  requestResume(resumed, 'resume-operation');
  assert.equal(resumed.phase, 'owner_resuming');
  assert.equal(resumed.attempt, 1);
});

test('blocked owner recovery returns to the preserved phase', () => {
  const state = delivery();
  state.failedPhase = 'owner_resuming';
  transition(state, 'blocked');
  requestResume(state, 'recover-owner');

  assert.equal(state.phase, 'owner_resuming');
  assert.equal(state.attempt, 1);
});

test('phase-specific state remains a derived, compact work status', () => {
  assert.deepEqual(workStateValues, ['queued', 'running', 'needs_human', 'succeeded', 'failed', 'cancelled']);
  assert.equal(workStateForPhase('worker_starting'), 'queued');
  assert.equal(workStateForPhase('reviewing'), 'running');
  assert.equal(workStateForPhase('human_review'), 'needs_human');
  assert.equal(workStateForPhase('awaiting_input'), 'needs_human');
  assert.equal(workStateForPhase('blocked'), 'failed');
  assert.equal(workStateForPhase('merged'), 'succeeded');
  assert.equal(terminal('awaiting_input'), false);
});

test('worker questions pause a delivery without making it terminal', () => {
  const state = delivery();
  transition(state, 'working');
  const question = askOwnerQuestion(state, {
    question: 'Which Jira project should receive this issue?',
    options: ['ADEO', 'Jira demo'],
    operationId: state.operationId,
    sessionId: 'wrun_owner',
  }, '2026-09-14T10:00:00.000Z');

  assert.equal(state.phase, 'awaiting_input');
  assert.equal(state.state, 'needs_human');
  assert.equal(question.question, 'Which Jira project should receive this issue?');
  assert.deepEqual(question.options, ['ADEO', 'Jira demo']);
  assert.equal(state.history.at(-1)?.to, 'awaiting_input');
  assert.equal(state.pendingReceipts?.at(-1)?.state, 'needs_human');
  assert.equal(askOwnerQuestion(state, { ...question, options: question.options }, '2026-09-14T10:00:01.000Z'), question);
});

test('owner answers are attributed and resume the same owner with the exact answer', () => {
  const state = delivery();
  transition(state, 'working');
  const question = askOwnerQuestion(state, {
    question: 'Should the issue be marked urgent?',
    operationId: state.operationId,
    sessionId: 'wrun_owner',
  }, '2026-09-14T10:00:00.000Z');
  const version = state.version;

  answerOwnerQuestion(state, question.operationId, 'Yes, mark it urgent.', 'owner-42', '2026-09-14T10:01:00.000Z');

  assert.equal(state.phase, 'owner_resuming');
  assert.equal(state.questions[0]?.answer, 'Yes, mark it urgent.');
  assert.equal(state.questions[0]?.answeredBy, 'owner-42');
  assert.equal(state.questions[0]?.answeredAt, '2026-09-14T10:01:00.000Z');
  assert.equal(state.resumeOperationId, question.operationId);
  assert.match(state.resumeMessage || '', /Yes, mark it urgent\./);
  assert.equal(state.version, version + 1);

  answerOwnerQuestion(state, question.operationId, 'Yes, mark it urgent.', 'owner-retry', '2026-09-14T10:02:00.000Z');
  assert.equal(state.version, version + 1);
  assert.throws(() => answerOwnerQuestion(state, question.operationId, 'No', 'owner-42'), /different answer/);
});

test('a multi-transition advance preserves every version increment', () => {
  const current = delivery();
  const candidate = claimAdvance(current, 100)!;
  const claimedVersion = candidate.version;

  transition(candidate, 'working');
  transition(candidate, 'review_starting');
  const committed = commitAdvance(current, candidate, claimedVersion);

  assert.equal(committed.phase, 'review_starting');
  assert.equal(committed.version, 4);
});

test('history is bounded independently of the current projection', () => {
  const state = delivery();

  for (let index = 0; index < 20; index++) {
    transition(state, 'working');
    transition(state, 'review_starting');
    transition(state, 'reviewing');
    transition(state, 'human_review');
    transition(state, 'owner_resuming');
    transition(state, 'working');
  }

  assert.equal(state.history.length, MAX_DELIVERY_HISTORY);
});
