import { defineTool } from "eve/tools";
import { useLogger } from "evlog/eve";
import { z } from "zod";
import { getToken } from "@vercel/connect";
import { getVercelOidcToken } from "@vercel/oidc";
import { verifyScope } from "../../../lib/github.mjs";
import { loadPullRequest } from "../../../lib/work-github";
import { prepareRepository } from "../../../lib/prepare-context";
import { workState } from "../../../lib/work-state";
import { requireGate,stationRequest,gateRequest } from "../../../lib/station-access";
import { hostReviewLimitations, scanChangesForSecrets } from "../../../lib/review-policy";
import { githubConnectorName } from "../../../lib/factory-config.ts";
export default defineTool({description:"Fetch the authenticated PR's exact base and head as separate snapshots, install frozen dependencies, and copy the baseline policy from the base. Call first.",inputSchema:z.object({}),
 async *execute(_,ctx){
  const gate=requireGate(ctx);
  const log=useLogger(ctx);
  if(workState.get().prepared){log.set({factory:{station:gate,stage:"prepare_review",outcome:"already_prepared",prNumber:workState.get().pull?.number}});yield{phase:"Prepared",pull:workState.get().pull};return;}
  verifyScope(await getVercelOidcToken());yield{phase:"Preparing independent review"};
  const token=await getToken(githubConnectorName,{subject:{type:"app"}});
  const pull=await loadPullRequest(token,gateRequest.parse(stationRequest(ctx)).prNumber,ctx.abortSignal);
  const sandbox=await ctx.getSandbox();workState.update(s=>({...s,sandboxStarted:true}));
  const setup=await prepareRepository(sandbox,token,ctx.abortSignal,pull.snapshot,undefined,pull.baseSnapshot);
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
  workState.update(s=>({...s,gate,prepared:setup.prepared,basePrepared:setup.basePrepared,revision:setup.revision,baseline:setup.files.map(({file,sha256})=>({file,sha256})),commands:setup.commands,pull:metadata,contextGaps:[...setup.contextGaps,...pull.contextGaps,...setup.baseContextGaps],secretScanClean:secretFindings.length===0,verificationFindings:secretFindings}));
  log.set({factory:{station:gate,stage:"prepare_review",outcome:setup.prepared?"prepared":"incomplete",prNumber:pull.number,headSha:pull.headSha,baseSha:pull.baseSha,fileCount:pull.files.length,commandCount:setup.commands.length,secretFindings:secretFindings.length}});
  yield{phase:setup.prepared?"Prepared":"Setup failed",gate,pull:metadata,policy:"/workspace/review-policy",baseWorkspace:"/workspace/base",workspace:"/workspace/repo",hostFindings:secretFindings,commands:setup.commands,limitations:[...setup.contextGaps,...pull.contextGaps,...setup.baseContextGaps,...hostReviewLimitations(pull.files,{e2eRanOnHead:false,secretScanClean:secretFindings.length===0})]};
 },
 toModelOutput(output){
  return {type:"text",value:JSON.stringify("commands" in output ? {...output,commands:output.commands?.map(command=>({command:command.command,exitCode:command.exitCode,stdout:command.stdout.slice(-600),stderr:command.stderr.slice(-1000)}))} : output)};
 }
});
