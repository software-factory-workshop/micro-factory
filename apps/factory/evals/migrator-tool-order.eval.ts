import { randomUUID } from "node:crypto";
import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";
import { factoryModelIds, prototypeRepository, factoryRepository } from "../runtime/lib/factory-config.ts";
import { readNdjsonUntilSessionTerminal, toolResultEvents, toolResultNames, toolResultOutput, property, stringProperty } from "./support.ts";

const optIn = "FACTORY_RUN_MIGRATOR_EVAL";

// Tool-call eval for the migrator station. It starts the real station through
// the host route (immutable station auth is attached by the host, never by this
// eval) and asserts the order the contract requires: prepare_work, verify_work,
// publish_work. It does not judge the migrated application.
export default defineEval({
  description: "Migrator calls prepare_work, verify_work and publish_work in order and publishes one draft PR",
  tags: ["paid", "migrator", "tool-order"],
  metadata: { optIn, model: factoryModelIds.migrator, prototype: prototypeRepository, target: factoryRepository },
  async test(t) {
    if (process.env[optIn] !== "1") {
      t.skip(`Set ${optIn}=1 to spend on the real migrator against ${prototypeRepository}.`);
      return;
    }
    const brief = process.env.FACTORY_MIGRATOR_BRIEF?.trim() || `Migrate the v0 prototype ${prototypeRepository} into the Nuxt shell in ${factoryRepository}. Preserve labelled fixtures. Use AWS DSQL behind one typed data module, keep Vercel Passport and Vercel Connect for the Jira MCP, add Vitest unit tests and headless e2e tests.`;
    const start = await t.target.fetch("/factory/stations/migrator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationId: randomUUID(), title: "Migrate the ADEO todo prototype to Nuxt", brief }),
    });
    if (!start.ok) throw new Error(`Migrator station start failed with HTTP ${start.status}.`);
    const sessionId = stringProperty(await start.json(), "sessionId");
    if (!sessionId) throw new Error("Migrator station returned no session.");
    const events = await readNdjsonUntilSessionTerminal(await t.target.fetch(`/migrator/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0`, { headers: { accept: "application/x-ndjson" } }), 4000);
    const names = toolResultNames(events);
    const order = ["prepare_work", "verify_work", "publish_work"].map(name => names.indexOf(name));
    t.check(order.every(index => index >= 0), equals(true));
    t.check(order[0]! < order[1]! && order[1]! < order[2]!, equals(true));
    t.check(names.filter(name => name === "publish_work").length, equals(1));
    const publication = toolResultOutput(toolResultEvents(events, "publish_work").at(-1));
    const pr = property(property(publication, "publication"), "number");
    t.check(typeof pr === "number" && pr > 0, equals(true));
    t.check(typeof property(publication, "digest") === "string", equals(true));
    t.log(`Draft PR #${String(pr)} published for digest ${String(property(publication, "digest")).slice(0, 12)}. A human still judges whether the migrated application is faithful to the prototype, whether fixtures are labelled honestly and whether the DSQL module is correct; this eval only proves the tool order and one publication.`);
  },
});
