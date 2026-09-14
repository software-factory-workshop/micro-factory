import { defineTool } from "eve/tools";
import { useLogger } from "evlog/eve";
import { z } from "zod";
import { requireGate } from "../../../lib/station-access";
import { workState } from "../../../lib/work-state";
import { collectChanges } from "../../../lib/work-changes";
import { commandEvidence, testCountFromOutput } from "../../../lib/command-evidence";
import { attributeFailure } from "../../../lib/check-attribution";
import type { VerificationFinding } from "../../../lib/work-state";
import { changeResource, repositoryResource } from "../../../lib/cedar/model.ts";
import { factoryPrincipalFromStation, runGuardedFactoryOperation } from "../../../lib/cedar/guard.ts";
import { verificationCommands, unitTestCommand, e2eTestCommand } from "../../../lib/factory-config.ts";
const checkId=(check:string)=>check.replace(/[^A-Za-z0-9_.-]+/g,"_").slice(0,160);
export default defineTool({description:"Rerun the required typecheck, unit, e2e and build checks on the unchanged PR head, run one named check on the pristine base, and attribute each failure as candidate, baseline or infrastructure. Compares unit test totals between base and head. Required before an approve verdict.",inputSchema:z.object({baseCommand:z.enum(verificationCommands).default(unitTestCommand).describe("The one named check to reproduce on the pristine /workspace/base copy.")}).strict(),
 async *execute({baseCommand},ctx){
  const gate=requireGate(ctx);const log=useLogger(ctx);const state=workState.get();if(!state.prepared)throw new Error("Prepare review first.");
  const sandbox=await ctx.getSandbox();
  if((await collectChanges(sandbox,state.baseline,true)).length)throw new Error("Review candidate was edited; start a fresh independent review.");
  const pull=state.pull;if(!pull)throw new Error("Prepare review first.");
  const principal=factoryPrincipalFromStation(ctx,gate);
  const branch=pull.targetBranch||"main";
  const preparedEvidence={id:`prepare:${ctx.session.id}:${pull.headSha}`,source:"factory.prepare_review",complete:true,candidateSha:pull.headSha};
  const checks=[...verificationCommands];
  workState.update(s=>({...s,reviewVerified:false,attributions:[],e2eRanOnHead:false,verificationFindings:(s.verificationFindings??[]).filter(f=>f.message.startsWith("Secret pattern"))}));
  let baseResult:{exitCode:number;stdout:string;stderr:string}|undefined;let baseTestCount:number|undefined;
  if(state.basePrepared){
   const baseCommandLine='export PATH="$HOME/.local/bin:$PATH" CI=1 NO_COLOR=1 FORCE_COLOR=0; cd /workspace/base; '+baseCommand;
   yield{phase:"Checking pristine base",command:baseCommand};
   const baseGuarded=await runGuardedFactoryOperation({
    operationId:`${ctx.session.id}:base-check:${checkId(baseCommand)}`,
    principal,action:"run_check",
    input:{checkId:`base-${checkId(baseCommand)}`,command:baseCommand},
    resource:repositoryResource(),
    context:{expectedRevision:pull.baseSha,candidateSha:pull.headSha,baseSha:pull.baseSha,verifiedSha:pull.headSha,branch,lane:"reviewer",budget:0,riskClass:"low",evidence:preparedEvidence},
    execute:()=>sandbox.run({command:baseCommandLine}),
    isSuccess:result=>result.exitCode===0,
   });
   baseResult=baseGuarded.output;const baseEvidence=commandEvidence(baseCommandLine,baseResult,pull.baseSha);
   if(baseCommand===unitTestCommand)baseTestCount=testCountFromOutput(`${baseResult.stdout}\n${baseResult.stderr}`);
   workState.update(s=>({...s,commands:[...s.commands,baseEvidence],...(baseTestCount!==undefined?{baseTestCount}:{}),contextGaps:baseResult!.exitCode===0?s.contextGaps:[...s.contextGaps,`Pristine base ${baseCommand} exited ${baseResult!.exitCode}; failures of that check on head are attributed to the baseline.`]}));
   yield{phase:baseResult.exitCode===0?"Base check passed":"Base check failed",evidence:baseEvidence,testCount:baseTestCount};
  }else{
   workState.update(s=>({...s,contextGaps:[...s.contextGaps,"Pristine base workspace was unavailable; failure attribution and the test-count comparison are unavailable."]}));
  }
  let allPassed=true;
  for(const check of checks){
   yield{phase:"Checking candidate",command:check};
   const command='export PATH="$HOME/.local/bin:$PATH" CI=1 NO_COLOR=1 FORCE_COLOR=0; cd /workspace/repo; '+check;
   const guarded=await runGuardedFactoryOperation({
    operationId:`${ctx.session.id}:check:${checkId(check)}`,
    principal,action:"run_check",
    input:{checkId:checkId(check),command:check},
    resource:repositoryResource(),
    context:{expectedRevision:pull.headSha,candidateSha:pull.headSha,baseSha:pull.baseSha,verifiedSha:pull.headSha,branch,lane:"reviewer",budget:0,riskClass:"low",evidence:preparedEvidence},
    execute:()=>sandbox.run({command}),
    isSuccess:result=>result.exitCode===0,
   });
   const result=guarded.output;const evidence=commandEvidence(command,result,pull.headSha);
   const attribution=attributeFailure(check,result,check===baseCommand?baseResult:undefined);
   const candidateTestCount=check===unitTestCommand?testCountFromOutput(`${result.stdout}\n${result.stderr}`):undefined;
   workState.update(s=>({...s,commands:[...s.commands,evidence],attributions:[...s.attributions,{command:check,exitCode:result.exitCode,attribution}],...(candidateTestCount!==undefined?{candidateTestCount}:{}),...(check===e2eTestCommand&&result.exitCode===0?{e2eRanOnHead:true}:{})}));
   if(check===unitTestCommand&&state.basePrepared&&baseCommand===unitTestCommand){
    if(baseTestCount===undefined||candidateTestCount===undefined){
     const gap=baseTestCount===undefined?"Pristine base unit tests did not emit a parseable total; the test-count comparison is unavailable.":"Candidate unit tests did not emit a parseable total; the test-count comparison is unavailable.";
     workState.update(s=>({...s,contextGaps:s.contextGaps.includes(gap)?s.contextGaps:[...s.contextGaps,gap]}));
     yield{phase:"Test-count comparison unavailable",evidence,baseTestCount,candidateTestCount,limitation:gap};
    } else if(candidateTestCount<baseTestCount){
     const finding:VerificationFinding={severity:"blocking",path:"tests",message:`Candidate unit test count (${candidateTestCount}) is lower than the pristine base count (${baseTestCount}). A test was removed or disabled.`,evidence:`Base ${unitTestCommand} reported ${baseTestCount}; head ${unitTestCommand} reported ${candidateTestCount} at ${pull.headSha}.`};
     workState.update(s=>({...s,verificationFindings:[...(s.verificationFindings??[]),finding]}));
     log.set({factory:{station:gate,stage:"verify_review",outcome:"failed",check,reason:"test_count_decreased",baseTestCount,candidateTestCount}});
     yield{phase:"Blocking finding",evidence,baseTestCount,candidateTestCount,finding};
     allPassed=false;
    }
   }
   yield{phase:result.exitCode===0?"Check passed":`Check failed (${attribution})`,evidence,attribution,testCount:candidateTestCount};
   if(result.exitCode!==0){allPassed=false;log.set({factory:{station:gate,stage:"verify_review",outcome:"failed",check,exitCode:result.exitCode,attribution}});}
  }
  if(!allPassed){
   // The last yield is the tool result the model reads: carry the host findings and both test counts
   // so the gate does not have to re-derive the delta from the diff (observed in the 14 Sep eval).
   const s=workState.get();
   yield{phase:"Candidate not verified",attributions:s.attributions,headSha:pull.headSha,baseTestCount,candidateTestCount:s.candidateTestCount,findings:s.verificationFindings??[]};
   return;
  }
  if((await collectChanges(sandbox,state.baseline,true)).length)throw new Error("Candidate changed during verification; review cannot approve modified source.");
  const verification=await runGuardedFactoryOperation({
   operationId:`${ctx.session.id}:record-verification`,
   principal,action:"record_verification",
   input:{checkIds:checks.map(checkId),outcome:"passed",evidenceId:`verify:${ctx.session.id}:${pull.headSha}`},
   resource:changeResource({id:String(pull.number),taskId:ctx.session.id,candidateSha:pull.headSha,baseSha:pull.baseSha,branch,expectedRevision:pull.headSha}),
   context:{expectedRevision:pull.headSha,candidateSha:pull.headSha,baseSha:pull.baseSha,verifiedSha:pull.headSha,branch,lane:"reviewer",budget:0,riskClass:"low",evidence:{id:`verify:${ctx.session.id}:${pull.headSha}`,source:"factory.verify_review",complete:true,candidateSha:pull.headSha}},
   execute:async()=>{workState.update(s=>({...s,reviewVerified:true}));return true;},
   isSuccess:result=>result===true,
  });
  log.set({factory:{station:gate,stage:"verify_review",outcome:"passed",checkCount:checks.length,headSha:pull.headSha,baseTestCount,candidateTestCount:workState.get().candidateTestCount}});
  yield{phase:"Candidate verified",headSha:pull.headSha,attributions:workState.get().attributions,baseTestCount,candidateTestCount:workState.get().candidateTestCount,authorization:verification.audit};
 }});
