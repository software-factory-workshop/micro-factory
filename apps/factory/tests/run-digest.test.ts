import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digestRunEvents, accumulateRunActivity, describeStopWithoutResult, describeToolOutput } from '../runtime/lib/run-digest.ts';

// Real migrator run wrun_41M2HTR0QP0GXYHP16C8DJBW5E (15 Sep 2026, 08:06 CEST), with
// streamed deltas removed and long payloads clipped. The cockpit showed nothing but
// "stopped without a trusted result" for this run.
const kanbanRun = JSON.parse(readFileSync(new URL('./fixtures/kanban-run-events.json', import.meta.url), 'utf8')) as unknown[];

test('the kanban run digest says what happened: verified, then publish_work denied by Cedar, turn completed', () => {
  const digest = digestRunEvents(kanbanRun);
  assert.equal(digest.status, 'completed');
  assert.equal(digest.turns, 1);
  assert.equal(digest.steps, 20);
  assert.equal(digest.toolCalls, 56);
  assert.equal(digest.toolErrors, 1);
  assert.equal(digest.model, 'openai/gpt-5.6-sol-fast');
  assert.equal(digest.terminal?.type, 'turn.completed');
  assert.equal(digest.lastTool?.toolName, 'publish_work');
  assert.equal(digest.lastTool?.outcome, 'error');
  assert.deepEqual({ tool: digest.lastError?.toolName, message: digest.lastError?.message }, { tool: 'publish_work', message: 'Factory Cedar denied the operation by default.' });
  assert.match(digest.finalMessage ?? '', /Blocked at publication/);
  assert.equal(digest.toolCounts.verify_work?.calls, 3);
  assert.equal(digest.tools.find(tool => tool.toolName === 'verify_work' && tool.summary?.startsWith('Work verified'))?.outcome, 'ok');
  assert.match(digest.tools.find(tool => tool.toolName === 'verify_work')?.summary ?? '', /Check failed · pnpm test:e2e exit 1/);
  assert.ok(digest.usage?.inputTokens && digest.usage.inputTokens > 1_000_000);
  assert.ok(digest.tools.every(tool => tool.startedAt && tool.endedAt && typeof tool.durationMs === 'number'));
});

test('a stream without a turn boundary is running, a failed turn carries its code and message, cancellation is not failure', () => {
  const running = digestRunEvents([{ type: 'turn.started', data: {} }, { type: 'step.started', data: { modelId: 'x' } }, { type: 'actions.requested', data: { actions: [{ callId: 'c1', toolName: 'bash', input: { command: 'pnpm test' } }] } }]);
  assert.equal(running.status, 'running');
  assert.equal(running.lastTool?.outcome, 'running');
  assert.equal(running.lastTool?.input, 'pnpm test');
  const failed = digestRunEvents([{ type: 'turn.started', data: {} }, { type: 'step.failed', data: { code: 'MODEL_CALL_FAILED', message: 'gateway 502' } }, { type: 'turn.failed', data: { code: 'MODEL_CALL_FAILED', message: 'gateway 502' } }]);
  assert.equal(failed.status, 'failed');
  assert.deepEqual({ code: failed.terminal?.code, message: failed.terminal?.message }, { code: 'MODEL_CALL_FAILED', message: 'gateway 502' });
  assert.equal(digestRunEvents([{ type: 'turn.started', data: {} }, { type: 'turn.cancelled', data: {} }]).status, 'cancelled');
  const waiting = digestRunEvents([{ type: 'turn.started', data: {} }, { type: 'input.requested', data: { requests: [{ requestId: 'r1', kind: 'session-limit' }] } }, { type: 'turn.completed', data: {} }]);
  assert.equal(waiting.status, 'completed');
  assert.equal(waiting.pendingInput?.requestId, 'r1');
  // A new turn clears the previous terminal state and closing message.
  assert.equal(digestRunEvents([{ type: 'turn.started', data: {} }, { type: 'turn.completed', data: {} }, { type: 'message.received', data: { message: 'continue' } }]).status, 'running');
});

test('tool output summaries come from host fields, never from model text', () => {
  assert.equal(describeToolOutput('bash', { exitCode: 1, stdout: 'ok', stderr: '[31mError: boom[0m\nmore' }, false), 'exit 1 · Error: boom');
  assert.equal(describeToolOutput('publish_work', { phase: 'Published', publication: { number: 7 } }, false), 'Published · PR #7');
  assert.equal(describeToolOutput('publish_work', 'Factory Cedar denied the operation by default.', true), 'Factory Cedar denied the operation by default.');
  assert.equal(describeToolOutput('record_review', { verdict: 'approve' }, false), 'verdict approve');
});

test('activity accumulates across observation windows and the stop sentence names the failing tool and the agent words', () => {
  const first = accumulateRunActivity(undefined, digestRunEvents(kanbanRun.slice(0, 80)), '2026-09-15T06:10:00.000Z');
  const second = accumulateRunActivity(first, digestRunEvents(kanbanRun.slice(80)), '2026-09-15T06:14:18.000Z');
  assert.equal(second.toolCalls, 56);
  assert.equal(second.steps, 20);
  assert.equal(second.lastError?.toolName, 'publish_work');
  assert.equal(second.terminal?.type, 'turn.completed');
  const empty = accumulateRunActivity(second, digestRunEvents([]), '2026-09-15T06:14:20.000Z');
  assert.equal(empty.toolCalls, 56);
  assert.equal(empty.terminal?.type, 'turn.completed');
  const sentence = describeStopWithoutResult('migrator', 'publish_work', 'turn.completed', second);
  assert.match(sentence, /^The migrator ended its turn without publishing a pull request\. Last failing tool publish_work: Factory Cedar denied the operation by default\. 56 tool calls, 20 model steps\. Agent's closing words: “Outcome: \*\*Blocked at publication/);
  assert.match(describeStopWithoutResult('quality-gate', 'record_review', 'turn.failed', { ...second, terminal: { type: 'turn.failed', code: 'MODEL_CALL_FAILED', message: 'gateway 502' } }), /^The quality gate session failed \(MODEL_CALL_FAILED\): gateway 502\./);
  assert.equal(describeStopWithoutResult('migrator', 'publish_work', 'turn.completed', undefined), 'The migrator ended its turn without publishing a pull request.');
});
