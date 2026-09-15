import { defineTool } from "eve/tools";
import { useLogger } from "evlog/eve";
import { z } from "zod";
import { getToken } from "@vercel/connect";
import { getVercelOidcToken } from "@vercel/oidc";
import { verifyScope, loadRepository } from "../../../lib/github.mjs";
import { loadPullRequest } from "../../../lib/work-github";
import { prepareRepository, writePrototype } from "../../../lib/prepare-context";
import { workState } from "../../../lib/work-state";
import { requireGate,stationRequest,gateRequest } from "../../../lib/station-access";
import { hostReviewLimitations, scanChangesForSecrets } from "../../../lib/review-policy";
import { githubConnectorName, prototypeRepository } from "../../../lib/factory-config.ts";
export default defineTool({description:"Fetch the authenticated PR's exact base and head as separate snapshots, install frozen dependencies, and copy the baseline policy from the base. Call first.",inputSchema:z.object({}),
 async *execute(_,ctx){
  const gate=requireGate(ctx);
  const log=useLogger(ctx);
  if(workState.get().prepared){log.set({factory:{station:gate,stage:"prepare_review",outcome:"already_prepared",prNumber:workState.get().pull?.number}});yield{phase:"Prepared",pull:workState.get().pull};return;}
  verifyScope(await getVercelOidcToken());yield{phase:"Preparing independent review"};
  const token=await getToken(githubConnectorName,{subject:{type:"app"}});
  const gateInput=gateRequest.parse(stationRequest(ctx));const repository=gateInput.repository;
  const pull=await loadPullRequest(token,gateInput.prNumber,ctx.abortSignal,repository);
  const sandbox=await ctx.getSandbox();workState.update(s=>({...s,sandboxStarted:true}));
  const setup=await prepareRepository(sandbox,token,ctx.abortSignal,pull.snapshot,undefined,pull.baseSnapshot);
  // The read-only v0 prototype the candidate claims to migrate, pinned to the revision the
  // migrator recorded in the candidate's snapshot manifest when present. Without it the gate
  // could not check fidelity and recorded "incomplete" (observed 15 Sep on PR #10).
  // Repository from the host request; revision from the migrator's PR body ("Prototype revision: <sha>"), else the request ref.
  const prototype=await exportPrototype(sandbox,token,ctx.abortSignal,pull.snapshot.entries,gateInput.prototype,pull.body);
  // Baseline policy is taken from the exact PR base, not candidate-modified files.
  const rules=pull.baseSnapshot.entries.filter(e=>e.file==="factory/CONTRACT.md"||e.file.startsWith("factory/policies/"));
  for(const rule of rules)await sandbox.writeBinaryFile({path:`review-policy/${rule.file}`,content:rule.content});
  await sandbox.writeTextFile({path:"review-policy/pull-request.json",content:JSON.stringify({number:pull.number,title:pull.title,body:pull.body,baseSha:pull.baseSha,headSha:pull.headSha,targetBranch:pull.targetBranch,files:pull.files},null,2)});
  // Host secret scan over the head content of every changed file. Findings are
  // recorded as blocking with path:line before any model reads the diff.
  const headByPath=new Map(pull.snapshot.entries.map(entry=>[entry.file,entry.content]));
  const changed=pull.files.filter(file=>file.status!=="removed").map(file=>({path:file.filename,content:headByPath.get(file.filename)?.toString("utf8")??null}));
  const secretFindings=scanChangesForSecrets(changed);
  const metadata={number:pull.number,url:pull.url,title:pull.title,body:pull.body,baseSha:pull.baseSha,headSha:pull.headSha,targetBranch:pull.targetBranch,files:pull.files};
  workState.update(s=>({...s,repository,prototypeRepository:prototype.repository,gate,prepared:setup.prepared,basePrepared:setup.basePrepared,revision:setup.revision,baseline:setup.files.map(({file,sha256})=>({file,sha256})),commands:setup.commands,pull:metadata,contextGaps:[...setup.contextGaps,...pull.contextGaps,...setup.baseContextGaps],secretScanClean:secretFindings.length===0,verificationFindings:secretFindings}));
  log.set({factory:{station:gate,stage:"prepare_review",outcome:setup.prepared?"prepared":"incomplete",prNumber:pull.number,headSha:pull.headSha,baseSha:pull.baseSha,fileCount:pull.files.length,commandCount:setup.commands.length,secretFindings:secretFindings.length}});
  yield{phase:setup.prepared?"Prepared":"Setup failed",gate,pull:metadata,policy:"/workspace/review-policy",baseWorkspace:"/workspace/base",workspace:"/workspace/repo",prototype,hostFindings:secretFindings,commands:setup.commands,limitations:[...setup.contextGaps,...pull.contextGaps,...setup.baseContextGaps,...hostReviewLimitations(pull.files,{e2eRanOnHead:false,secretScanClean:secretFindings.length===0})]};
 },
 toModelOutput(output){
  return {type:"text",value:JSON.stringify("commands" in output ? {...output,commands:output.commands?.map(command=>({command:command.command,exitCode:command.exitCode,stdout:command.stdout.slice(-600),stderr:command.stderr.slice(-1000)}))} : output)};
 }
});

/** Export the prototype snapshot read-only into /workspace/prototype for fidelity review. */
async function exportPrototype(sandbox:Awaited<ReturnType<any>>,token:string,signal:AbortSignal|undefined,headEntries:Array<{file:string;content:Buffer}>,requested?:{repository:string;ref:string},pullBody?:string):Promise<{repository:string;revision:string;workspace:string;fileCount:number;note:string}|{repository:string;workspace:string;error:string}> {
  let ref="main";
  const manifest=headEntries.find(entry=>entry.file===".factory-snapshot.json");
  let repo=requested?.repository||prototypeRepository;
  if(requested)ref=requested.ref;
  const recorded=pullBody?.match(/Prototype revision: `([a-f0-9]{40})`/)?.[1];if(recorded)ref=recorded;
  if(manifest){try{const parsed=JSON.parse(manifest.content.toString("utf8")) as {prototype?:{revision?:string;repository?:string}};if(parsed.prototype?.revision&&/^[a-f0-9]{40}$/.test(parsed.prototype.revision))ref=parsed.prototype.revision;if(parsed.prototype?.repository&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(parsed.prototype.repository))repo=parsed.prototype.repository;}catch{/* manifest unreadable: fall back to the default prototype */}}
  try{
    const prototype=await loadRepository(token,signal,repo,ref) as {revision:string;entries:Array<{file:string;content:Buffer}>};
    const fileCount=await writePrototype(sandbox,{...prototype,repository:repo});
    return{repository:repo,revision:prototype.revision,workspace:"/workspace/prototype",fileCount,note:"Read-only v0 prototype input. Compare the candidate against it for fidelity; fixtures found here stay fixtures."};
  }catch(error){
    return{repository:repo,workspace:"/workspace/prototype",error:`Prototype snapshot unavailable: ${error instanceof Error?error.message:String(error)}. Fidelity to the prototype cannot be checked in this review.`};
  }
}
