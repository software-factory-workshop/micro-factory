import { defineTool } from "eve/tools";
import { bash } from "eve/tools/bash";
import { workState } from "./work-state";
import { commandEvidence } from "./command-evidence";
import { stationOf } from "./station-access";
export default defineTool({ ...bash,
 description:"Run a bounded command in /workspace/repo. Native shell edits and disposable tests are allowed; no credentials or remote writes. Actual command output and exit code are recorded.",
 async *execute(input,ctx){
  if(!stationOf(ctx)||!workState.get().prepared) throw new Error("Prepare the authorized station workspace first.");
  const command='export PATH="$HOME/.local/bin:$PATH"; cd /workspace/repo; '+input.command;
  const result=await bash.execute({...input,command},ctx);
  if(Symbol.asyncIterator in result) {for await(const item of result){workState.update(s=>({...s,commands:[...s.commands,commandEvidence(command,item)]}));yield item;}}
  else {workState.update(s=>({...s,commands:[...s.commands,commandEvidence(command,result)]}));yield result;}
 }
});
