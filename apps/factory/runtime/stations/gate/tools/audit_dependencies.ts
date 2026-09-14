import { defineDynamic } from "eve";
import { defineTool } from "eve/tools";
import { useLogger } from "evlog/eve";
import { z } from "zod";
import { stationOf } from "../../../lib/station-access";
import { workState } from "../../../lib/work-state";
import { commandEvidence } from "../../../lib/command-evidence";
import { dependencyAuditCommand } from "../../../lib/factory-config.ts";
const tool=defineTool({description:"Read-only dependency advisory audit of the unchanged PR head lockfile. Records the command and exit code as evidence; never modifies the lockfile.",inputSchema:z.object({}).strict(),
 async execute(_,ctx){
  if(stationOf(ctx)!=="security-gate")throw new Error("This capability requires an authenticated security-gate station session.");
  const log=useLogger(ctx);const state=workState.get();if(!state.prepared||!state.pull)throw new Error("Prepare review first.");
  const command='export PATH="$HOME/.local/bin:$PATH"; cd /workspace/repo; '+dependencyAuditCommand;
  const result=await (await ctx.getSandbox()).run({command});
  const evidence=commandEvidence(command,result,state.pull.headSha);
  workState.update(s=>({...s,commands:[...s.commands,evidence]}));
  let advisories:Array<{id:string;severity:string;module:string;title:string}>=[];
  try{const parsed=JSON.parse(result.stdout);advisories=Object.values(parsed.advisories??{}).map((a:any)=>({id:String(a.id??a.github_advisory_id??""),severity:String(a.severity??""),module:String(a.module_name??""),title:String(a.title??"")})).slice(0,50);}catch{}
  log.set({factory:{station:"security-gate",stage:"audit_dependencies",exitCode:result.exitCode,advisoryCount:advisories.length}});
  return{exitCode:result.exitCode,advisories,evidence:{command:evidence.command,exitCode:evidence.exitCode,stderr:evidence.stderr.slice(-1000)},note:"Exit 0 means no advisory at or above the configured level. A non-zero exit with parseable advisories is candidate evidence only if the lockfile changed in this PR; otherwise it is a baseline finding."};
 }});
// Mounted through defineDynamic: the tool does not exist for the quality gate.
export default defineDynamic({events:{"session.started":(_,ctx)=>stationOf(ctx)==="security-gate"?tool:null}});
