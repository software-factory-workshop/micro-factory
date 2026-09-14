import { defineTool } from "eve/tools";
import { useLogger } from "evlog/eve";
import { z } from "zod";
import { requireStation } from "../../../lib/station-access";
import { workState } from "../../../lib/work-state";
import { collectChanges,changesDigest } from "../../../lib/work-changes";
import { commandEvidence, testCountFromOutput } from "../../../lib/command-evidence";
import { scanChangesForSecrets } from "../../../lib/review-policy";
import { changeResource, repositoryResource } from "../../../lib/cedar/model.ts";
import { factoryPrincipalFromStation, runGuardedFactoryOperation } from "../../../lib/cedar/guard.ts";
import { workBranch } from "../../../lib/work-github";
import { verificationCommands, unitTestCommand, e2eTestCommand } from "../../../lib/factory-config.ts";
const checkId=(check:string)=>check.replace(/[^A-Za-z0-9_.-]+/g,"_").slice(0,160);
export default defineTool({description:"Run typecheck, unit tests, end-to-end tests and build against the current source changes, plus one named check on the pristine base. Records command evidence bound to a digest of the changed files; publish_work refuses if that digest moves. Call after edits are finished.",inputSchema:z.object({baseCommand:z.enum(verificationCommands).default(unitTestCommand).describe("Run this one named verification command on the pristine /workspace/base copy before checking the candidate.")}).strict(),
 async *execute({baseCommand},ctx){
  requireStation(ctx,"migrator");const log=useLogger(ctx);const state=workState.get();if(!state.prepared)throw new Error("Prepare workspace first.");
  if(!state.basePrepared)throw new Error("Pristine base workspace is unavailable; prepare_work again.");
  const sandbox=await ctx.getSandbox();const changes=await collectChanges(sandbox,state.baseline,false);const digest=changesDigest(changes);
  const principal=factoryPrincipalFromStation(ctx,"migrator");
  const branch=workBranch(ctx.session.id);
  const preparedEvidence={id:`prepare:${state.operationId}`,source:"factory.prepare_work",complete:true,candidateSha:digest};
  const checks=[...verificationCommands];
  workState.update(s=>({...s,verifiedDigest:null,e2eRanOnHead:false,secretScanClean:null}));
  const secrets=scanChangesForSecrets(changes);
  workState.update(s=>({...s,secretScanClean:secrets.length===0}));
  if(secrets.length){log.set({factory:{station:"migrator",stage:"verify_work",outcome:"failed",reason:"secret_pattern",count:secrets.length}});yield{phase:"Secret pattern found",findings:secrets,required:"Remove the secret from source; credentials belong in the host environment, never in the diff."};return;}
  const baseCommandLine='export PATH="$HOME/.local/bin:$PATH" CI=1 NO_COLOR=1 FORCE_COLOR=0; cd /workspace/base; '+baseCommand;
  yield{phase:"Reproducing on pristine base",command:baseCommand};
  const baseGuarded=await runGuardedFactoryOperation({
   operationId:`${state.operationId}:base-reproduction:${digest}`,
   principal,
   action:"run_check",
   input:{checkId:`base-${checkId(baseCommand)}`,command:baseCommand},
   resource:repositoryResource(),
   context:{expectedRevision:state.revision,candidateSha:digest,baseSha:state.targetHeadSha,verifiedSha:digest,branch,lane:"worker",budget:0,riskClass:"low",evidence:preparedEvidence},
   execute:()=>sandbox.run({command:baseCommandLine}),
   isSuccess:result=>result.exitCode===0,
  });
  const baseResult=baseGuarded.output;const baseEvidence=commandEvidence(baseCommandLine,baseResult,state.targetHeadSha);
  const baseTestCount=baseCommand===unitTestCommand?testCountFromOutput(`${baseResult.stdout}\n${baseResult.stderr}`):undefined;
  workState.update(s=>({...s,commands:[...s.commands,baseEvidence],...(baseTestCount!==undefined?{baseTestCount}:{})}));
  yield{phase:baseResult.exitCode===0?"Base reproduction passed":"Base reproduction failed",command:baseCommand,evidence:baseEvidence,testCount:baseTestCount};
  for(const [index,check] of checks.entries()){
   yield{phase:"Checking work",command:check};
   const command='export PATH="$HOME/.local/bin:$PATH" CI=1 NO_COLOR=1 FORCE_COLOR=0; cd /workspace/repo; '+check;
   const guarded=await runGuardedFactoryOperation({
    operationId:`${state.operationId}:check:${index}:${digest}`,
    principal,
    action:"run_check",
    input:{checkId:checkId(check),command:check},
    resource:repositoryResource(),
    context:{expectedRevision:state.revision,candidateSha:digest,baseSha:state.revision,verifiedSha:digest,branch,lane:"worker",budget:0,riskClass:"low",evidence:preparedEvidence},
    execute:()=>sandbox.run({command}),
    isSuccess:result=>result.exitCode===0,
   });
   const result=guarded.output;const evidence=commandEvidence(command,result,digest);
   const candidateTestCount=check===unitTestCommand?testCountFromOutput(`${result.stdout}\n${result.stderr}`):undefined;
   workState.update(s=>({...s,commands:[...s.commands,evidence],...(candidateTestCount!==undefined?{candidateTestCount}:{}),...(check===e2eTestCommand&&result.exitCode===0?{e2eRanOnHead:true}:{})}));
   yield{phase:result.exitCode===0?"Check passed":"Check failed",evidence,testCount:candidateTestCount};
   if(result.exitCode!==0){log.set({factory:{station:"migrator",stage:"verify_work",outcome:"failed",check,exitCode:result.exitCode}});return;}
  }
  if(changesDigest(await collectChanges(sandbox,state.baseline,false))!==digest)throw new Error("Source changed during verification; inspect generated changes and verify again.");
  const verification=await runGuardedFactoryOperation({
   operationId:`${state.operationId}:record-verification:${digest}`,
   principal,
   action:"record_verification",
   input:{checkIds:checks.map(checkId),outcome:"passed",evidenceId:`verify:${state.operationId}:${digest}`},
   resource:changeResource({id:state.operationId,taskId:state.operationId,candidateSha:digest,baseSha:state.revision,branch,expectedRevision:state.revision}),
   context:{expectedRevision:state.revision,candidateSha:digest,baseSha:state.revision,verifiedSha:digest,branch,lane:"worker",budget:0,riskClass:"low",evidence:{id:`verify:${state.operationId}:${digest}`,source:"factory.verify_work",complete:true,candidateSha:digest}},
   execute:async()=>{workState.update(s=>({...s,verifiedDigest:digest}));return true;},
   isSuccess:result=>result===true,
  });
  log.set({factory:{station:"migrator",stage:"verify_work",outcome:"passed",checkCount:checks.length,changedFileCount:changes.length,digest}});
  yield{phase:"Work verified",digest,files:changes.map(c=>c.path),authorization:verification.audit};
 }});
