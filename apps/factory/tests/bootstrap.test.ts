import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTargetRepository } from "../runtime/lib/bootstrap.ts";
import { mergeableHead } from "../runtime/lib/delivery-state.ts";

test("the target repository name is derived from the prototype, always inside the workshop organisation", () => {
  assert.equal(deriveTargetRepository("software-factory-workshop/adeo-kanban-proto"), "software-factory-workshop/adeo-kanban-nuxt");
  assert.equal(deriveTargetRepository("software-factory-workshop/adeo-todo-proto"), "software-factory-workshop/adeo-todo-nuxt");
  assert.equal(deriveTargetRepository("someone-else/Inventory-Prototype"), "software-factory-workshop/inventory-nuxt");
  assert.equal(deriveTargetRepository("software-factory-workshop/shop"), "software-factory-workshop/shop-nuxt");
  assert.throws(() => deriveTargetRepository("not a repo"));
});

test("a head is mergeable only when both gates approved that exact head without blockers", () => {
  const head = "d".repeat(40), base = "a".repeat(40);
  const approve = (headSha: string, findings: Array<{ severity: string }> = []) => ({ verdict: "approve", summary: "ok", headSha, baseSha: base, targetBranch: "main", findings, limitations: [] });
  const state = (phase: string, reviews: Record<string, unknown>) => ({ phase, publication: { headSha: head, targetHeadSha: base, targetBranch: "main", number: 1 }, reviews }) as never;
  assert.equal(mergeableHead(state("ready", { "quality-gate": approve(head), "security-gate": approve(head) })), head);
  assert.equal(mergeableHead(state("human_review", { "quality-gate": approve(head), "security-gate": approve(head) })), head);
  assert.equal(mergeableHead(state("ready", { "quality-gate": approve(head) })), undefined);
  assert.equal(mergeableHead(state("ready", { "quality-gate": approve(head), "security-gate": approve("e".repeat(40)) })), undefined);
  assert.equal(mergeableHead(state("ready", { "quality-gate": approve(head, [{ severity: "blocking" }]), "security-gate": approve(head) })), undefined);
  assert.equal(mergeableHead(state("reviewing", { "quality-gate": approve(head), "security-gate": approve(head) })), undefined);
});
