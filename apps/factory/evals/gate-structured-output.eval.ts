import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";
import { z } from "zod";
import { factoryModelIds } from "../runtime/lib/factory-config.ts";
import { readNdjsonUntilSessionTerminal, toolResultEvents, toolResultOutput, stringProperty } from "./support.ts";

const optIn = "FACTORY_RUN_GATE_EVAL";
const gateSchema = z.enum(["quality-gate", "security-gate"]);

// Structured-output eval on the record_review result of either gate: the
// verdict is present and every blocking finding has a path and evidence. The
// verdict itself is not asserted here; the injected-defect eval does that.
const recorded = z.object({
  verdict: z.enum(["approve", "changes_requested", "incomplete"]),
  summary: z.string().min(10),
  headSha: z.string().regex(/^[a-f0-9]{40}$/),
  findings: z.array(z.object({ severity: z.enum(["blocking", "nonblocking"]), path: z.string(), line: z.number().int().positive().optional(), message: z.string(), evidence: z.string() })),
  limitations: z.array(z.string()),
  note: z.string().regex(/no merge was performed/),
});

export default defineEval({
  description: "A gate records a structured review: verdict present, every blocking finding cites path and evidence",
  tags: ["paid", "gate", "structured-output"],
  metadata: { optIn, models: [factoryModelIds.qualityGate, factoryModelIds.securityGate] },
  async test(t) {
    if (process.env[optIn] !== "1") {
      t.skip(`Set ${optIn}=1, FACTORY_GATE=<quality-gate|security-gate> and FACTORY_GATE_PR=<open PR> to spend on a real gate.`);
      return;
    }
    const gate = gateSchema.parse(process.env.FACTORY_GATE || "quality-gate");
    const prNumber = Number(process.env.FACTORY_GATE_PR);
    if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("FACTORY_GATE_PR must name an open PR in the target repository.");
    const start = await t.target.fetch(`/factory/stations/${gate}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: randomUUID(), prNumber }) });
    if (!start.ok) throw new Error(`${gate} start failed with HTTP ${start.status}.`);
    const sessionId = stringProperty(await start.json(), "sessionId");
    if (!sessionId) throw new Error(`${gate} returned no session.`);
    const events = await readNdjsonUntilSessionTerminal(await t.target.fetch(`/${gate}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0`, { headers: { accept: "application/x-ndjson" } }), 4000);
    const output = toolResultOutput(toolResultEvents(events, "record_review").at(-1));
    const parsed = recorded.safeParse(output);
    t.check(parsed.success, equals(true));
    if (!parsed.success) { t.log(parsed.error.message); return; }
    const blocking = parsed.data.findings.filter(finding => finding.severity === "blocking");
    t.check(blocking.every(finding => finding.path.trim().length > 0 && finding.evidence.trim().length >= 8), equals(true));
    t.check(blocking.every(finding => finding.line !== undefined || !/\.[a-z]+$/i.test(finding.path)), equals(true));
    t.log(`${gate} recorded ${parsed.data.verdict} on ${parsed.data.headSha} with ${blocking.length} blocking finding(s). A human still judges whether the findings are true and whether the verdict matches the code; this eval only proves the shape.`);
  },
});
