import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stationDeliveryId } from "../runtime/lib/station-access.ts";

const root = new URL("../", import.meta.url);
async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("owner questions are bound to a validated delivery context", () => {
  const deliveryId = "a".repeat(64);
  const context = { session: { auth: { initiator: { attributes: { factoryDeliveryId: deliveryId } } } } };
  assert.equal(stationDeliveryId(context), deliveryId);
  assert.equal(stationDeliveryId({ session: { auth: { initiator: { attributes: { factoryDeliveryId: "not-a-delivery" } } } } }), null);
  assert.equal(stationDeliveryId({ session: { auth: { initiator: { attributes: { factoryDeliveryId: deliveryId.toUpperCase() } } } } }), null);
});

test("the worker tool, built root and answer route share the durable owner-input contract", async () => {
  const tool = await source("runtime/stations/migrator/tools/ask_owner.ts");
  const reexport = await source("agents/migrator/agent/tools/ask_owner.ts");
  const route = await source("runtime/channels/delivery.ts");
  const station = await source("runtime/lib/station-channel.ts");
  const instructions = await source("agents/migrator/agent/instructions.ts");

  assert.match(tool, /updateDelivery/);
  assert.match(tool, /askOwnerQuestion/);
  assert.match(tool, /awaiting_input/);
  assert.match(reexport, /runtime\/stations\/migrator\/tools\/ask_owner/);
  assert.match(route, /\/factory\/delivery\/:id\/answer/);
  assert.match(route, /answerOwnerQuestion/);
  assert.match(route, /new WorkError\('invalid_request'/);
  assert.match(route, /current\.principalId!==auth\.principalId/);
  assert.match(station, /factoryDeliveryId/);
  assert.match(instructions, /ask_owner/);
});
