import { defineTool } from "eve/tools";
import { useLogger } from "evlog/eve";
import { z } from "zod";
import { getToken } from "@vercel/connect";
import { getVercelOidcToken } from "@vercel/oidc";
import { verifyScope, loadRepository } from "../../../lib/github.mjs";
import { loadWorkSnapshot,targetFor,readPull,verifyOwnerCommit,isDescendant,WorkError } from "../../../lib/work-github";
import { prepareRepository, writePrototype } from "../../../lib/prepare-context";
import { workState } from "../../../lib/work-state";
import { requireStation,stationRequest,migratorRequest,currentRevision } from "../../../lib/station-access";
import { githubConnectorName } from "../../../lib/factory-config.ts";
export default defineTool({description:"Export the pinned target snapshot into /workspace/repo, a pristine base copy into /workspace/base and the read-only v0 prototype into /workspace/prototype, then install frozen dependencies. Call first.",inputSchema:z.object({}),
 async *execute(_,ctx){
  requireStation(ctx,"migrator");
  const log=useLogger(ctx);
  const original=migratorRequest.parse(stationRequest(ctx));const revision=currentRevision(ctx);
  const repository=original.repository;const prototypeRepository=original.prototype.repository;
  const operationId=revision?.operationId||original.operationId;const prior=workState.get();
  if(prior.completedOperations?.[operationId]){log.set({factory:{station:"migrator",stage:"prepare_work",outcome:"already_published",operationId}});yield{phase:"Already published",result:prior.completedOperations[operationId]};return;}
  if(prior.prepared&&prior.basePrepared&&prior.operationId===operationId){log.set({factory:{station:"migrator",stage:"prepare_work",outcome:"already_prepared",revision:prior.revision,operationId}});yield{phase:"Prepared",revision:prior.revision,prototypeRevision:prior.prototypeRevision,request:{...original,brief:prior.activeBrief},targetBranch:prior.targetBranch};return;}
  if(prior.operationId&&!prior.recorded&&prior.operationId!==operationId)throw new WorkError("unfinished_operation",`Owner still has unpublished operation ${prior.operationId}. Its source is preserved; this revision has not replaced it.`);
  if(revision&&(!prior.publication||prior.publication.number!==revision.prNumber||prior.publication.ownerSessionId!==ctx.session.id))throw new WorkError("ownership_unverified","Durable owner state does not authorize this PR.");
  verifyScope(await getVercelOidcToken());
  yield{phase:"Preparing migrator workspace"};
  // The only credential use in this station: inside a host tool, never in the sandbox.
  const token=await getToken(githubConnectorName,{subject:{type:"app"}});
  let target=await targetFor(token,original.parentPrNumber,ctx.abortSignal,repository);
  let source=target.targetHeadSha;
  if(revision){
   const owned=prior.publication!;const pr=await readPull(token,owned.number,ctx.abortSignal,repository);
   if(pr.state!=="open"||pr.head.ref!==owned.branch||pr.base.ref!==owned.targetBranch)throw new WorkError("stale_head","Owned PR changed externally; source is preserved and this operation is blocked.");
   await verifyOwnerCommit(token,{...owned,headSha:owned.ownershipCommitSha||owned.headSha},ctx.session.id,ctx.abortSignal,repository);
   if(pr.head.sha!==owned.headSha&&!await isDescendant(token,owned.headSha,pr.head.sha,ctx.abortSignal,repository))throw new WorkError("stale_head","Owned branch history was replaced; ownership cannot be transferred implicitly.");
   workState.update(s=>({...s,publication:{...owned,headSha:pr.head.sha,ownershipCommitSha:owned.ownershipCommitSha||owned.headSha}}));
   source=pr.head.sha;target={targetBranch:owned.targetBranch,targetHeadSha:owned.targetHeadSha,...(owned.parentPrNumber?{parentPrNumber:owned.parentPrNumber}:{})};
  }
  const snapshot=await loadWorkSnapshot(token,source,ctx.abortSignal,repository);
  const baseSnapshot=source===target.targetHeadSha?snapshot:await loadWorkSnapshot(token,target.targetHeadSha,ctx.abortSignal,repository);
  const prototype=await loadRepository(token,ctx.abortSignal,prototypeRepository,original.prototype.ref);
  const sandbox=await ctx.getSandbox();workState.update(s=>({...s,sandboxStarted:true}));
  // A completed operation may have deleted files: reconstruct source, never overlay stale files.
  const cleared=await sandbox.run({command:"rm -rf /workspace/repo /workspace/prototype"});if(cleared.exitCode!==0)throw new Error("Cannot reconstruct migrator source.");
  const setup=await prepareRepository(sandbox,token,ctx.abortSignal,snapshot,undefined,baseSnapshot,prototypeRepository);
  const prototypeFiles=await writePrototype(sandbox,prototype);
  workState.update(s=>({...s,repository,prototypeRepository,prepared:setup.prepared,basePrepared:setup.basePrepared,revision:setup.revision,prototypeRevision:prototype.revision,operationId,activeBrief:revision?.brief||original.brief,targetBranch:target.targetBranch,targetHeadSha:target.targetHeadSha,parentPrNumber:target.parentPrNumber,mergeTarget:false,recorded:false,verifiedDigest:null,baseline:setup.files.map(({file,sha256})=>({file,sha256})),commands:setup.commands,contextGaps:[...setup.contextGaps,...setup.baseContextGaps],e2eRanOnHead:false,secretScanClean:null}));
  log.set({factory:{station:"migrator",stage:"prepare_work",outcome:setup.prepared?"prepared":"incomplete",revision:setup.revision,prototypeRevision:prototype.revision,operationId,targetBranch:target.targetBranch,fileCount:setup.files.length,prototypeFileCount:prototypeFiles,commandCount:setup.commands.length}});
  yield{phase:setup.prepared?"Prepared":"Setup failed",revision:setup.revision,prototype:{repository:prototypeRepository,revision:prototype.revision,workspace:"/workspace/prototype",fileCount:prototypeFiles,note:"Read-only input. Fixtures found here stay fixtures, labelled as such, in the migrated app."},request:{...original,brief:revision?.brief||original.brief,originalBrief:original.brief},operationId,targetBranch:target.targetBranch,targetHeadSha:target.targetHeadSha,baseRevision:baseSnapshot.revision,workspace:"/workspace/repo",fileCount:setup.files.length,commands:setup.commands,limitations:[...setup.contextGaps,...setup.baseContextGaps]};
 },
 toModelOutput(output){
  return {type:"text",value:JSON.stringify("commands" in output ? {...output,commands:output.commands?.map(command=>({command:command.command,exitCode:command.exitCode,stdout:command.stdout.slice(-600),stderr:command.stderr.slice(-1000)}))} : output)};
 }
});
