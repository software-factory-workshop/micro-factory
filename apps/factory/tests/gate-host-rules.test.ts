import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testCountFromOutput } from "../runtime/lib/command-evidence.ts";
import { scanChangesForSecrets, approvalBlockers, enforceFindingEvidence } from "../runtime/lib/review-policy.ts";
import { attributeFailure } from "../runtime/lib/check-attribution.ts";
import { z } from "zod";
const reviewSchema=z.object({verdict:z.enum(["approve","changes_requested","incomplete"]),summary:z.string().min(10).max(3000),findings:z.array(z.object({severity:z.enum(["blocking","nonblocking"]),path:z.string(),line:z.number().int().positive().optional(),message:z.string(),evidence:z.string()})).max(15),limitations:z.array(z.string()).max(10)}).strict();

const fixtures = fileURLToPath(new URL("./fixtures/defects/", import.meta.url));

test("test totals parse from node --test and Vitest, never defaulting to zero", () => {
  assert.equal(testCountFromOutput("ℹ tests 12\nℹ suites 3\nℹ pass 12"), 12);
  assert.equal(testCountFromOutput(" Test Files  2 passed (2)\n      Tests  9 passed (9)\n   Start at  10:00"), 9);
  assert.equal(testCountFromOutput(" Tests  8 passed | 1 skipped (9)"), 9);
  assert.equal(testCountFromOutput("no summary here"), undefined);
  assert.equal(testCountFromOutput("\u001b[2m Tests \u001b[22m\u001b[1m\u001b[32m20 passed\u001b[39m\u001b[22m\u001b[90m (20)\u001b[39m"), 20);
});

test("the deleted-test fixture is caught deterministically by the test-count delta", () => {
  const readme = readFileSync(`${fixtures}deleted-test/README.md`, "utf8");
  const patch = readFileSync(`${fixtures}deleted-test/candidate.patch`, "utf8");
  assert.match(readme, /^# \[injected\]/m);
  assert.match(patch, /^-\s+it\("marks a todo completed/m);
  const base = testCountFromOutput(" Tests  9 passed (9)")!;
  const head = testCountFromOutput(" Tests  8 passed (8)")!;
  assert.ok(head < base);
  const blockers = approvalBlockers({ prepared: true, repositoryChecksPassed: true, hasBlockingFinding: false, contextGaps: [], modelLimitations: [], files: [{ filename: "tests/todos.test.ts" }], evidence: { e2eRanOnHead: true, baseTestCount: base, candidateTestCount: head, secretScanClean: true } });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0]!, /below base/);
});

test("the trusted-author-id fixture is labelled injected and reads identity from the body", () => {
  const readme = readFileSync(`${fixtures}trusted-author-id/README.md`, "utf8");
  const patch = readFileSync(`${fixtures}trusted-author-id/candidate.patch`, "utf8");
  assert.match(readme, /^# \[injected\]/m);
  assert.match(patch, /^\+.*authorId: input\.authorId/m);
  assert.match(patch, /^-.*requireIdentity\(event\)/m);
});

test("secret patterns in added source are blocking findings with path:line evidence", () => {
  const findings = scanChangesForSecrets([
    { path: "server/utils/data.ts", content: 'const url = "postgres://app:hunter2secret@db.example.com/todos";\nexport const ok = 1;' },
    { path: "server/utils/clean.ts", content: "export const key = process.env.DSQL_ENDPOINT;" },
    { path: "tests/old.ts", content: null },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.path, "server/utils/data.ts");
  assert.equal(findings[0]!.line, 1);
  assert.equal(findings[0]!.severity, "blocking");
  assert.match(findings[0]!.evidence, /^server\/utils\/data\.ts:1: /);
  assert.doesNotMatch(findings[0]!.evidence, /hunter2secret/);
});

test("a blocking finding without path:line and evidence is recorded nonblocking by host rule", () => {
  const findings = enforceFindingEvidence([
    { severity: "blocking", path: "server/api/todos.post.ts", line: 9, message: "Body author id trusted.", evidence: "server/api/todos.post.ts:9 reads input.authorId" },
    { severity: "blocking", path: "server/api/todos.post.ts", message: "Feels risky.", evidence: "" },
    { severity: "blocking", path: "", message: "Something.", evidence: "observed in the code" },
    { severity: "nonblocking", path: "app/pages/index.vue", message: "Naming.", evidence: "" },
  ]);
  assert.deepEqual(findings.map(f => f.severity), ["blocking", "nonblocking", "nonblocking", "nonblocking"]);
  assert.match(findings[1]!.message, /downgraded to nonblocking/);
  assert.ok(reviewSchema.safeParse({ verdict: "approve", summary: "long enough summary", findings, limitations: [] }).success);
});

test("approve with any blocker throws at the host, not in model text", () => {
  const blockers = approvalBlockers({ prepared: true, repositoryChecksPassed: false, hasBlockingFinding: true, contextGaps: ["Pristine base unavailable"], modelLimitations: ["e2e skipped"], files: [{ filename: "app/pages/index.vue" }], evidence: { e2eRanOnHead: false, secretScanClean: null } });
  assert.ok(blockers.length >= 5);
  assert.throws(() => { if (blockers.length) throw new Error(`Approval refused by host policy: ${blockers.join(" ")}`); }, /Approval refused by host policy/);
});

test("check failures are attributed as candidate, baseline or infrastructure from two runs", () => {
  const pass = { exitCode: 0, stdout: "", stderr: "" };
  const fail = { exitCode: 1, stdout: "", stderr: "expect(received).toBe(true)" };
  assert.equal(attributeFailure("pnpm test", pass, pass), "passed");
  assert.equal(attributeFailure("pnpm test", fail, pass), "candidate");
  assert.equal(attributeFailure("pnpm test", fail, fail), "baseline");
  assert.equal(attributeFailure("pnpm test", fail), "candidate");
  assert.equal(attributeFailure("pnpm build", { exitCode: 1, stdout: "", stderr: "ERR_PNPM_FETCH_404 registry unreachable EAI_AGAIN" }, pass), "infrastructure");
  assert.equal(attributeFailure("pnpm test:e2e", { exitCode: 137, stdout: "", stderr: "Killed" }, pass), "infrastructure");
});
