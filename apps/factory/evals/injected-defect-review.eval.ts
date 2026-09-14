import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";
import { factoryModelIds } from "../runtime/lib/factory-config.ts";
import { readNdjsonUntilSessionTerminal, toolResultEvents, toolResultOutput, property, stringProperty } from "./support.ts";

const optIn = "FACTORY_RUN_INJECTED_DEFECT_EVAL";
const fixtureName = process.env.FACTORY_INJECTED_DEFECT_FIXTURE || "non-persisting-save";
const fixtureRoot = join(process.cwd(), "tests/fixtures/defects", fixtureName);
const fixture = readFileSync(join(fixtureRoot, "README.md"), "utf8");
const candidate = readFileSync(join(fixtureRoot, "candidate.patch"), "utf8");

// Paid opt-in eval: run the real quality gate against an open PR that carries
// an injected defect fixture and assert changes_requested. The fixture README
// is labelled [injected]; the PR must be prepared by a person from candidate.patch.
export default defineEval({
  description: `Paid real quality-gate eval for the injected ${fixtureName} candidate`,
  tags: ["paid", "quality-gate", "injected-defect"],
  metadata: { optIn, gateModel: factoryModelIds.qualityGate, fixture: fixtureName },
  async test(t) {
    if (process.env[optIn] !== "1") {
      t.skip(`Set ${optIn}=1 and FACTORY_INJECTED_DEFECT_PR=<open PR with the injected fixture> to spend on the real quality gate.`);
      return;
    }
    if (!/^# \[injected\]/m.test(fixture)) throw new Error("The fixture README must be labelled [injected].");
    const prNumber = Number(process.env.FACTORY_INJECTED_DEFECT_PR?.trim());
    if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("FACTORY_INJECTED_DEFECT_PR must name the open PR containing the injected fixture.");
    const gate = process.env.FACTORY_GATE === "security-gate" ? "security-gate" : "quality-gate";
    const start = await t.target.fetch(`/factory/stations/${gate}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: randomUUID(), prNumber }) });
    if (!start.ok) throw new Error(`${gate} start failed with HTTP ${start.status}.`);
    const sessionId = stringProperty(await start.json(), "sessionId");
    if (!sessionId) throw new Error(`${gate} returned no session.`);
    const events = await readNdjsonUntilSessionTerminal(await t.target.fetch(`/${gate}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0`, { headers: { accept: "application/x-ndjson" } }), 4000);
    const output = toolResultOutput(toolResultEvents(events, "record_review").at(-1));
    const modelEvent = events.find(event => event.type === "step.started" && property(property(event, "data"), "modelId") === (gate === "security-gate" ? factoryModelIds.securityGate : factoryModelIds.qualityGate));
    t.check(modelEvent !== undefined, equals(true));
    t.check(output !== undefined, equals(true));
    t.check(property(output, "verdict"), equals("changes_requested"));
    t.log(`Reviewed ${fixture.split("\n", 1)[0]} with the injected candidate patch (${candidate.length} bytes) through ${gate}. A human still judges whether the blocking finding names the real defect line.`);
  },
});
