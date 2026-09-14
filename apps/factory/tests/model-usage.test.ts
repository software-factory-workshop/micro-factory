import test from "node:test";
import assert from "node:assert/strict";
import { modelUsageFromEvents } from "../runtime/lib/delivery-events.ts";

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
