import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, "../../factory/policies/cedar");
const outputPath = resolve(root, "runtime/lib/cedar/generated-policies.ts");
const files = (await readdir(directory)).filter((file) => file.endsWith(".cedar")).sort();
const records = await Promise.all(
  files.map(async (file) => ({
    id: file.slice(0, -".cedar".length),
    text: await readFile(resolve(directory, file), "utf8"),
  })),
);
const revision = createHash("sha256")
  .update(records.map(({ id, text }) => `${id}\n${text}`).join("\n"))
  .digest("hex");
const entries = records.map(({ id, text }) => `  ${JSON.stringify(id)}: ${JSON.stringify(text)},`);
const output = `// Generated from factory/policies/cedar/*.cedar. Run \`pnpm factory:policies:sync\` after editing canonical policy files.\nexport const FACTORY_POLICY_TEXT: Readonly<Record<string, string>> = {\n${entries.join("\n")}\n};\n\nexport const FACTORY_POLICY_REVISION = "sha256:${revision}";\n`;
await writeFile(outputPath, output);
console.log(`Synchronized ${records.length} Cedar policies -> ${outputPath}`);
