import { manifestFor } from "./github.mjs";
import { commandEvidence } from "./command-evidence.ts";
import { factoryNodeVersion, factoryPnpmVersion, prototypeRepository } from "./factory-config.ts";
interface Sandbox {
  writeBinaryFile(input:{path:string;content:Uint8Array}):PromiseLike<unknown>;
  writeTextFile(input:{path:string;content:string}):PromiseLike<unknown>;
  run(input:{command:string}):PromiseLike<{exitCode:number;stdout:string;stderr:string}>;
}
export const snapshotExclusions=["factory/evidence/","Git history","credentials"];
export const exclusionNote="Excluded paths exist in the repository but are withheld from this snapshot on purpose. Treat them as unavailable evidence, never as missing work to create. There is no commit history or CI log in this snapshot.";
export async function prepareRepository(sandbox:Sandbox,_token:string,_signal?:AbortSignal, snapshot?:{revision:string;entries:Array<{file:string;content:Buffer;mode?:string}>}, _unused?:unknown, baseSnapshot?:{revision:string;entries:Array<{file:string;content:Buffer;mode?:string}>}) {
  if(!snapshot)throw new Error("A pinned target snapshot is required.");
  const {revision,entries}=snapshot;
  const files=manifestFor(entries);
  for(let i=0;i<entries.length;i+=8) await Promise.all(entries.slice(i,i+8).map(entry=>sandbox.writeBinaryFile({path:`repo/${entry.file}`,content:entry.content})));
  const executable=entries.filter(entry=>"mode" in entry && entry.mode==="100755");
  if(executable.length) {
    const paths=executable.map(entry=>`'/workspace/repo/${entry.file.replaceAll("'","'\\''")}'`).join(" ");
    const permissions=await sandbox.run({command:`chmod 755 -- ${paths}`});
    if(permissions.exitCode!==0)throw new Error("Could not restore source executable modes.");
  }
  await sandbox.writeTextFile({path:"repo/.factory-snapshot.json",content:JSON.stringify({revision,files,exclusions:snapshotExclusions,exclusionNote,prototype:{repository:prototypeRepository,workspace:"/workspace/prototype"},node:factoryNodeVersion,pnpm:factoryPnpmVersion},null,2)});
  const setup=`set -eu; mkdir -p "$HOME/.local/bin"; npm install --prefix "$HOME/.local" --no-audit --no-fund node@${factoryNodeVersion} pnpm@${factoryPnpmVersion}; ln -sf "$HOME/.local/node_modules/node/bin/node" "$HOME/.local/bin/node"; ln -sf "$HOME/.local/node_modules/pnpm/bin/pnpm.cjs" "$HOME/.local/bin/pnpm"; export PATH="$HOME/.local/bin:$PATH"; cd /workspace/repo; node --version; pnpm --version; pnpm install --frozen-lockfile`;
  const result=await sandbox.run({command:setup});
  const commands=[commandEvidence(setup,result)];
  let basePrepared=false;
  let baseContextGaps:string[]=[];
  if(baseSnapshot){
    const clearedBase=await sandbox.run({command:"rm -rf /workspace/base"});
    if(clearedBase.exitCode!==0)throw new Error("Cannot reconstruct pristine base source.");
    for(let i=0;i<baseSnapshot.entries.length;i+=8)await Promise.all(baseSnapshot.entries.slice(i,i+8).map(entry=>sandbox.writeBinaryFile({path:`base/${entry.file}`,content:entry.content})));
    const executableBase=baseSnapshot.entries.filter(entry=>entry.mode==="100755");
    if(executableBase.length){const paths=executableBase.map(entry=>`'/workspace/base/${entry.file.replaceAll("'","'\\''")}'`).join(" ");const permissions=await sandbox.run({command:`chmod 755 -- ${paths}`});if(permissions.exitCode!==0)throw new Error("Could not restore pristine base source executable modes.");}
    const baseSetup='set -eu; export PATH="$HOME/.local/bin:$PATH"; cd /workspace/base; node --version; pnpm --version; pnpm install --frozen-lockfile';
    const baseResult=await sandbox.run({command:baseSetup});
    commands.push(commandEvidence(baseSetup,baseResult));
    basePrepared=baseResult.exitCode===0;
    if(!basePrepared)baseContextGaps=[`Pristine base dependency setup failed with exit ${baseResult.exitCode}; base reproduction may be unavailable.`];
  }
  return {revision,files,commands,prepared:result.exitCode===0,basePrepared,baseContextGaps,contextGaps:result.exitCode===0?[]:[`Dependency setup failed with exit ${result.exitCode}; inspect command evidence before proposing reproducibility-dependent work.`]};
}
// The prototype is input, not a candidate: written read-only, never installed or verified.
export async function writePrototype(sandbox:Sandbox,prototype:{revision:string;repository:string;entries:Array<{file:string;content:Buffer}>}) {
  for(let i=0;i<prototype.entries.length;i+=8)await Promise.all(prototype.entries.slice(i,i+8).map(entry=>sandbox.writeBinaryFile({path:`prototype/${entry.file}`,content:entry.content})));
  await sandbox.writeTextFile({path:"prototype/.factory-prototype.json",content:JSON.stringify({repository:prototype.repository,revision:prototype.revision,files:manifestFor(prototype.entries),note:"Read-only v0 prototype input. Preserve labelled fixtures; never turn them into real persistence silently."},null,2)});
  const locked=await sandbox.run({command:"chmod -R a-w /workspace/prototype || true"});
  void locked;
  return prototype.entries.length;
}
