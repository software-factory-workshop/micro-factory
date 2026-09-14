import test from "node:test";
import assert from "node:assert/strict";
import { parsePullRequest, parseStationResult, stationLinkSchema, parseStationToolResult, matchesStationDelivery } from "../app/utils/work-station.ts";
import { factoryRepositoryUrl } from "../runtime/lib/factory-config.ts";
const sha = "a".repeat(40);
const prUrl = `${factoryRepositoryUrl}/pull/12`;
test("review input only accepts PRs in the configured repository", () => {
  assert.equal(parsePullRequest("12"), 12);
  assert.equal(parsePullRequest(prUrl), 12);
  assert.equal(parsePullRequest("https://github.com/software-factory-workshop/jira-clone/pull/12"), undefined);
});
test("migrator success requires a real scoped PR link and exact head/base identity", () => {
  const result = { station: "migrator", sessionId: "wrun_1", revision: sha, summary: "done", publication: { branch: "factory/work-x", number: 12, url: prUrl, headSha: sha, baseSha: sha }, commands: [] };
  assert.ok(parseStationResult(result));
  assert.equal(parseStationResult({ ...result, publication: { ...result.publication, url: "http://evil/pull/12" } }), undefined);
  assert.deepEqual(parseStationToolResult("prepare_work", { phase: "Already published", result }), parseStationResult(result));
});
test("gate results keep the gate, attribution, test counts and the no-merge note", () => {
  const result = { station: "security-gate", gate: "security-gate", sessionId: "wrun_2", prNumber: 12, url: prUrl, baseSha: sha, headSha: sha, verdict: "changes_requested", summary: "blocked", findings: [{ severity: "blocking", path: "server/api/todos.post.ts", line: 9, message: "body author id", evidence: "server/api/todos.post.ts:9" }], commands: [{ command: "pnpm test", exitCode: 0, stdout: "", stderr: "", digest: sha }], limitations: [], attributions: [{ command: "pnpm test", exitCode: 0, attribution: "passed" }], testCounts: { base: 9, head: 9 }, capturedAt: "2026-09-14T00:00:00.000Z", note: `Verdict applies to head ${sha}; no merge was performed.` };
  const parsed = parseStationResult(result);
  assert.equal(parsed?.station, "security-gate");
  assert.equal(parsed && "note" in parsed ? parsed.note : undefined, result.note);
});
test("run links retain station identity across reload", () => {
  for (const station of ["migrator", "quality-gate", "security-gate"]) assert.ok(stationLinkSchema.safeParse({ station, run: "wrun_1", rootAgent: station }).success);
  assert.equal(stationLinkSchema.safeParse({ station: "worker", run: "wrun_1" }).success, false);
  assert.equal(matchesStationDelivery({ meta: { deliveryIds: ["d1"] } }, "d1", false), true);
  assert.equal(matchesStationDelivery({ meta: { deliveryIds: ["d2"] } }, "d1", true), false);
});
