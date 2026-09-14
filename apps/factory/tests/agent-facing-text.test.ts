import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function filesUnder(directory: string): Promise<string[]> {
 const entries = await readdir(directory, { withFileTypes: true });
 const files: string[] = [];
 for (const entry of entries) {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) files.push(...await filesUnder(path));
  else if (entry.isFile()) files.push(path);
 }
 return files;
}

function withoutExternalUrls(value: string) {
 return value.replace(/https?:\/\/\S+/gi, "");
}

// Agent-facing text is what the model reads. A stale path or a command the
// sandbox cannot run costs a whole attempt, so the text is checked like code.
test("agent-facing text matches the current factory contract", async () => {
 const instructionFiles = (await filesUnder(join(appRoot, "agents"))).filter(path => /^instructions.*\.ts$/i.test(basename(path)));
 const localSkills = [join(appRoot, "agents/security-gate/agent/skills/security-review/SKILL.md")];
 const paths = [join(repositoryRoot, "factory/CONTRACT.md"), join(appRoot, "shared/agent-quality.ts"), ...instructionFiles, ...localSkills];
 const forbidden = [
  ["AGENTS.md", /AGENTS\.md/i],
  ["apps/jira", /apps\/jira/i],
  ["apps/factory/app", /apps\/factory\/app/i],
  ["task-miner", /task[- ]miner/i],
  [".mining-snapshot.json", /\.mining-snapshot\.json/i],
  ["docs/", /\bdocs\//i],
  ["frog", /\bfrog\b/i],
  ["gh pr", /\bgh\s+pr\b/i],
  ["git fetch", /\bgit\s+fetch\b/i],
  ["npm install", /\bnpm\s+install\b/i],
  ["force-push", /force-push/i],
  ["Neon as target", /use Neon/i],
 ] as const;
 for (const path of paths) {
  const text = withoutExternalUrls(await readFile(path, "utf8"));
  for (const [label, pattern] of forbidden) assert.doesNotMatch(text, pattern, `${relative(repositoryRoot, path)} contains stale ${label} guidance`);
 }
 const migrator = await readFile(join(appRoot, "agents/migrator/agent/instructions.ts"), "utf8");
 for (const required of ["/workspace/prototype", "/workspace/base", ".factory-snapshot.json", "verify_work", "publish_work", "refresh_target", "ask_owner", "labelled fixture", "AWS DSQL", "Vercel Passport", "Vercel Connect", "pnpm test:e2e"]) assert.match(migrator, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `migrator instructions must mention ${required}`);
 for (const gate of ["quality-gate", "security-gate"]) {
  const text = await readFile(join(appRoot, `agents/${gate}/agent/instructions.ts`), "utf8");
  for (const required of ["prepare_review", "verify_review", "record_review", "path:line", "no merge", "/workspace/review-policy"]) assert.match(text, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${gate} instructions must mention ${required}`);
 }
 const security = await readFile(join(appRoot, "agents/security-gate/agent/instructions.ts"), "utf8");
 assert.match(security, /audit_dependencies/);
 // The station tool inventories match the brief exactly; a tool that is not attached does not exist.
 const tools = async (station: string) => (await readdir(join(appRoot, `agents/${station}/agent/tools`))).map(name => name.replace(/\.ts$/, "")).sort();
 assert.deepEqual(await tools("migrator"), ["ask_owner", "bash", "glob", "grep", "prepare_work", "publish_work", "read_file", "refresh_target", "verify_work"]);
 assert.deepEqual(await tools("quality-gate"), ["bash", "glob", "grep", "prepare_review", "read_file", "record_review", "verify_review"]);
 assert.deepEqual(await tools("security-gate"), ["audit_dependencies", "bash", "glob", "grep", "prepare_review", "read_file", "record_review", "verify_review"]);
 const skills = async (station: string) => (await readdir(join(appRoot, `agents/${station}/agent/skills`))).sort();
 assert.deepEqual(await skills("migrator"), ["adeo-nuxt-ui", "nuxt", "typescript-best-practices", "vercel-connect", "vercel-passport", "vue"]);
 assert.deepEqual(await skills("quality-gate"), ["thermo-nuclear-code-quality-review"]);
 assert.deepEqual(await skills("security-gate"), ["security-review"]);
});
