import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareRepository } from "../runtime/lib/prepare-context.ts";

const root = new URL("../", import.meta.url);
async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("review verification compares a pristine base test total and keeps decreases host-enforced", async () => {
  const context = await source("runtime/lib/prepare-context.ts");
  const prepare = await source("runtime/stations/gate/tools/prepare_review.ts");
  const verify = await source("runtime/stations/gate/tools/verify_review.ts");
  const record = await source("runtime/stations/gate/tools/record_review.ts");

  assert.match(context, /path:`base\/\$\{entry\.file\}`/);
  assert.match(context, /cd \/workspace\/base; node --version; pnpm --version; pnpm install --frozen-lockfile/);
  assert.match(verify, /CI=1 NO_COLOR=1 FORCE_COLOR=0; cd \/workspace\/base; '\+baseCommand/);
  assert.match(verify, /testCountFromOutput\(\`\$\{baseResult\.stdout\}/);
  assert.match(verify, /testCountFromOutput\(\`\$\{result\.stdout\}/);
  assert.match(verify, /severity:"blocking"/);
  assert.match(record, /state\.verificationFindings/);
});

test("worker verification records one fixed base reproduction in command evidence", async () => {
  const context = await source("runtime/lib/prepare-context.ts");
  const prepare = await source("runtime/stations/migrator/tools/prepare_work.ts");
  const verify = await source("runtime/stations/migrator/tools/verify_work.ts");
  const instructions = await source("agents/migrator/agent/instructions.ts");

  assert.match(context, /baseSnapshot/);
  assert.match(prepare, /loadWorkSnapshot\(token,target\.targetHeadSha/);
  assert.match(prepare, /basePrepared:setup\.basePrepared/);
  assert.match(verify, /baseCommand:z\.enum\(verificationCommands\)\.default\(unitTestCommand\)/);
  assert.match(verify, /CI=1 NO_COLOR=1 FORCE_COLOR=0; cd \/workspace\/base; '\+baseCommand/);
  assert.match(verify, /commandEvidence\(baseCommandLine,baseResult,state\.targetHeadSha\)/);
  assert.match(instructions, /reproduces one named check on \/workspace\/base/);
});

test("publication binds command evidence to the verified digest and refuses a moved digest", async () => {
  const publish = await source("runtime/stations/migrator/tools/publish_work.ts");
  const verify = await source("runtime/stations/migrator/tools/verify_work.ts");
  const gateAgent = await source("runtime/stations/gate/agent.ts");
  assert.match(publish, /candidateDigest!==state\.verifiedDigest/);
  assert.match(publish, /digest moved since verify_work/);
  assert.match(verify, /commandEvidence\(command,result,digest\)/);
  assert.match(verify, /scanChangesForSecrets\(changes\)/);
  assert.match(gateAgent, /factoryModelIds\.securityGate:factoryModelIds\.qualityGate/);
});

test("base preparation records its locked setup in the existing command evidence", async () => {
  const writes: string[] = [];
  const commands: string[] = [];
  const sandbox = {
    writeBinaryFile: async ({ path }: { path: string }) => { writes.push(path); },
    writeTextFile: async ({ path }: { path: string }) => { writes.push(path); },
    run: async ({ command }: { command: string }) => {
      commands.push(command);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  };
  const snapshot = { revision: "a".repeat(40), entries: [{ file: "pnpm-lock.yaml", content: Buffer.from("lock"), mode: "100644" as const }] };
  const result = await prepareRepository(sandbox, "unused", undefined, snapshot, undefined, { ...snapshot, revision: "b".repeat(40) });

  assert.equal(result.basePrepared, true);
  assert.equal(result.commands.length, 2);
  assert.ok(writes.includes("base/pnpm-lock.yaml"));
  assert.match(result.commands[1]!.command, /cd \/workspace\/base; node --version; pnpm --version; pnpm install --frozen-lockfile/);
  assert.ok(commands.some(command => command.includes("cd /workspace/base")));
});
