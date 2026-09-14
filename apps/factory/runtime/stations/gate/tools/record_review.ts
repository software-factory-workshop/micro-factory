import { defineTool } from "eve/tools";
import { useLogger } from "evlog/eve";
import { z } from "zod";
import { getToken } from "@vercel/connect";
import { requireGate } from "../../../lib/station-access";
import { workState } from "../../../lib/work-state";
import { collectChanges } from "../../../lib/work-changes";
import { verifyPullRequestHead } from "../../../lib/work-github";
import { approvalBlockers, hostReviewLimitations, enforceFindingEvidence } from "../../../lib/review-policy";
import { changeResource } from "../../../lib/cedar/model.ts";
import { factoryPrincipalFromStation, runGuardedFactoryOperation } from "../../../lib/cedar/guard.ts";
import { githubConnectorName } from "../../../lib/factory-config.ts";
// Unchanged from the Jira factory reviewer: verdict, summary, findings[{severity,path,line?,message,evidence}], limitations.
export const reviewSchema=z.object({verdict:z.enum(["approve","changes_requested","incomplete"]),summary:z.string().min(10).max(3000),findings:z.array(z.object({severity:z.enum(["blocking","nonblocking"]),path:z.string(),line:z.number().int().positive().optional(),message:z.string(),evidence:z.string()})).max(15),limitations:z.array(z.string()).max(10)}).strict();
export type ReviewInput=z.infer<typeof reviewSchema>;
export default defineTool({description:"Record an independent structured review of the exact fetched PR head. Rechecks remote head before recording; does not submit a GitHub review or merge. Approving with any blocker throws.",inputSchema:reviewSchema,
 async execute(input,ctx){
  const gate=requireGate(ctx);const log=useLogger(ctx);const state=workState.get();if(state.recorded)throw new Error("This exact-head review is already recorded.");if(!state.pull)throw new Error("Prepare the exact PR first.");const targetBranch=state.pull.targetBranch||'main';
  const evidence={e2eRanOnHead:state.e2eRanOnHead,baseTestCount:state.baseTestCount,candidateTestCount:state.candidateTestCount,secretScanClean:state.secretScanClean};
  const hostLimitations=hostReviewLimitations(state.pull.files,evidence);
  const findings=[...(state.verificationFindings??[]),...enforceFindingEvidence(input.findings)];
  const blockers=approvalBlockers({prepared:state.prepared,repositoryChecksPassed:state.reviewVerified,hasBlockingFinding:findings.some(f=>f.severity==="blocking"),contextGaps:state.contextGaps,modelLimitations:input.limitations,files:state.pull.files,evidence});
  if(input.verdict==="approve"&&blockers.length)throw new Error(`Approval refused by host policy: ${blockers.join(" ")}`);
  const candidateUnchanged=!(await collectChanges(await ctx.getSandbox(),state.baseline,true)).length;
  if(input.verdict==="approve"&&!candidateUnchanged)throw new Error("Candidate changed after verification; approval refused.");
  const token=await getToken(githubConnectorName,{subject:{type:"app"}});
  await verifyPullRequestHead(token,state.pull.number,state.pull.headSha,ctx.abortSignal,state.pull.baseSha,state.pull.targetBranch);
  const principal=factoryPrincipalFromStation(ctx,gate);
  const evidenceId=`review:${ctx.session.id}:${state.pull.headSha}`;
  const authorized=await runGuardedFactoryOperation({
   operationId:`${ctx.session.id}:record-review`,
   principal,
   action:"record_review",
   input:{reviewId:ctx.session.id,verdict:input.verdict==="approve"?"approved":input.verdict,reviewedSha:state.pull.headSha},
   resource:changeResource({id:String(state.pull.number),taskId:ctx.session.id,candidateSha:state.pull.headSha,baseSha:state.pull.baseSha,branch:targetBranch,expectedRevision:state.pull.headSha}),
   context:{expectedRevision:state.pull.headSha,candidateSha:state.pull.headSha,baseSha:state.pull.baseSha,verifiedSha:state.pull.headSha,reviewedSha:state.pull.headSha,branch:targetBranch,lane:"reviewer",budget:0,riskClass:"low",evidence:{id:evidenceId,source:"factory.review_gate",complete:candidateUnchanged,candidateSha:state.pull.headSha}},
   log,
   execute:async()=>{workState.update(s=>({...s,recorded:true}));return {recorded:true};},
   isSuccess:result=>result.recorded,
  });
  log.set({factory:{station:gate,stage:"record_review",outcome:"recorded",verdict:input.verdict,prNumber:state.pull.number,headSha:state.pull.headSha,blockingFindingCount:findings.filter(f=>f.severity==="blocking").length,limitationCount:input.limitations.length}});
  return{station:gate,gate,sessionId:ctx.session.id,prNumber:state.pull.number,url:state.pull.url,baseSha:state.pull.baseSha,targetBranch,headSha:state.pull.headSha,...input,findings,limitations:[...state.contextGaps,...hostLimitations,...input.limitations],verification:{prepared:state.prepared,repositoryChecksPassed:state.reviewVerified,candidateUnchanged},attributions:state.attributions,testCounts:{base:state.baseTestCount,head:state.candidateTestCount},commands:state.commands,authorization:authorized.audit,capturedAt:new Date().toISOString(),note:`Verdict applies to head ${state.pull.headSha}; no merge was performed.`};
 }});
