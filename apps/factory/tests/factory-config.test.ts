import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryRepository, prototypeRepository, factoryModelLimits, migratorModelLimits, verificationCommands, unitTestCommand, e2eTestCommand, githubConnectorName, factoryBlobPaths, missingCapabilities, factoryPorts } from "../runtime/lib/factory-config.ts";
import { workBranch } from "../runtime/lib/work-github.ts";

test("factory configuration keeps host bindings in one plain module", () => {
  assert.match(factoryRepository, /^software-factory-workshop\//);
  assert.match(prototypeRepository, /^software-factory-workshop\//);
  assert.notEqual(factoryRepository, prototypeRepository);
  assert.ok(factoryModelLimits.maxTokenCostUsdPerSession <= 25);
  assert.equal(migratorModelLimits.maxTokenCostUsdPerSession, factoryModelLimits.maxTokenCostUsdPerSession);
  assert.ok(migratorModelLimits.maxInputTokensPerSession > factoryModelLimits.maxInputTokensPerSession);
  assert.ok(factoryModelLimits.maxInputTokensPerSession >= 2_000_000);
  assert.deepEqual([...verificationCommands], ["pnpm typecheck", unitTestCommand, e2eTestCommand, "pnpm build"]);
  assert.match(githubConnectorName, /^github\//);
  assert.ok(Object.values(factoryBlobPaths).every(path => path.startsWith("micro-factory/")));
  assert.equal(new Set(Object.values(factoryPorts)).size, Object.values(factoryPorts).length);
  assert.ok(missingCapabilities.some(item => /auto-merge/i.test(item)) && missingCapabilities.some(item => /webhook/i.test(item)) && missingCapabilities.some(item => /self-modification/i.test(item)));
  assert.match(workBranch("wrun_example"), /^factory\/work-[a-f0-9]{24}$/);
});
