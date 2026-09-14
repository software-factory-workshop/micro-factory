import { readdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";

export const CEDAR_WASM_RELATIVE_PATHS = [
  "functions/__server.func/node_modules/@cedar-policy/cedar-wasm/nodejs/cedar_wasm_bg.wasm",
  "functions/.well-known/workflow/v1/flow.func/node_modules/@cedar-policy/cedar-wasm/nodejs/cedar_wasm_bg.wasm",
];

export async function verifyNativeOutput(directory) {
  const output = resolve(directory);
  await access(join(output, "config.json"));
  await access(join(output, "functions/.well-known/workflow/v1/flow.func/.vc-config.json"));
  for (const relativePath of CEDAR_WASM_RELATIVE_PATHS) {
    try {
      await access(join(output, relativePath));
    } catch (error) {
      throw new Error(`Cedar WASM asset is missing from deployable output: ${relativePath}`, { cause: error });
    }
  }
  const files = await readdir(output, { recursive: true });
  const forbidden = files.filter(path => /harness[-_](fx|acp)/i.test(path));
  if (forbidden.length) throw new Error(`Experimental fx runtime leaked into deployment: ${forbidden.join(", ")}`);
  console.log("Verified deployable Eve/Workflow output contains no fx or ACP runtime bundles.");
}
