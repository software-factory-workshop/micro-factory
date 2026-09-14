import test from "node:test";
import assert from "node:assert/strict";
import { modelUsageFromEvents, accumulateModelUsage } from "../runtime/lib/delivery-events.ts";

test("model-call completions preserve the model and aggregate only positive usage", () => {
  const usage = modelUsageFromEvents([
    { type: "model.call.started", idempotencyKey: "call-1", model: { modelId: "meta/example" }, scope: { attemptId: "attempt-1" } },
    { type: "model.call.completed", idempotencyKey: "call-1", usage: { inputTokens: 120, outputTokens: 30 }, scope: { attemptId: "attempt-1" } },
    { type: "model.call.completed", idempotencyKey: "call-2", usage: { inputTokens: 80, outputTokens: 20, costUsd: 0.125 }, scope: { attemptId: "attempt-2" } },
  ], { attachFactorySha: false });

  assert.deepEqual(usage, { model: "meta/example", inputTokens: 200, outputTokens: 50, usd: 0.125 });
});

test("protocol step usage is a fallback and zero or unknown fields stay omitted", () => {
  assert.deepEqual(modelUsageFromEvents([
    { type: "step.started", data: { modelId: "meta/step-model" } },
    { type: "step.completed", data: { usage: { inputTokens: 15, outputTokens: 5, costUsd: 0.02 } } },
  ]), { model: "meta/step-model", inputTokens: 15, outputTokens: 5, usd: 0.02 });

  assert.deepEqual(modelUsageFromEvents([
    { type: "model.call.started", idempotencyKey: "call-1", model: { modelId: "meta/example" } },
    { type: "model.call.completed", idempotencyKey: "call-1", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } },
  ]), { model: "meta/example" });
});

test("usage accumulates across observation windows and never resets to a smaller window", () => {
  const first = { model: "meta/example", inputTokens: 13333, outputTokens: 361, usd: 0.0013, factorySha: "a".repeat(40) };
  const second = { inputTokens: 34449, outputTokens: 1477, usd: 0.0037 };
  const total = accumulateModelUsage(first, second);
  assert.deepEqual(total, { model: "meta/example", inputTokens: 47782, outputTokens: 1838, usd: 0.005, factorySha: "a".repeat(40) });
  assert.deepEqual(accumulateModelUsage(total, undefined), total);
  assert.deepEqual(accumulateModelUsage(total, { factorySha: "b".repeat(40) }), { ...total, factorySha: "b".repeat(40) });
  assert.deepEqual(accumulateModelUsage(undefined, second), second);
});
