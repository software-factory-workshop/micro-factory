import type { WorkEntry,WorkSnapshot,WorkChange } from "./work-github.ts";
import { allowedWorkPath,WorkError } from "./work-github.ts";
export interface MergePlan {entries:WorkEntry[];conflicts:string[]}
// Merge all three source versions before mutating the workspace. A protected conflict leaves it intact.
export async function mergeSources(base:WorkSnapshot,ours:WorkSnapshot,theirs:WorkSnapshot,changes:WorkChange[],mergeText:(base:string,ours:string,theirs:string,path:string)=>Promise<{content:string;conflict:boolean}>):Promise<MergePlan>{
 const b=new Map(base.entries.map(e=>[e.file,e]));const o=new Map(ours.entries.map(e=>[e.file,e]));const t=new Map(theirs.entries.map(e=>[e.file,e]));
 for(const c of changes){if(c.content===null)o.delete(c.path);else o.set(c.path,{file:c.path,content:Buffer.from(c.content),mode:o.get(c.path)?.mode||"100644"});}
 const equal=(a?:WorkEntry,b?:WorkEntry)=>!a&&!b||!!a&&!!b&&a.mode===b.mode&&a.content.equals(b.content);
 const entries:WorkEntry[]=[];const conflicts:string[]=[];
 for(const path of new Set([...b.keys(),...o.keys(),...t.keys()])){
  const before=b.get(path),own=o.get(path),target=t.get(path);let result:WorkEntry|undefined;
  if(equal(own,before))result=target;
  else if(equal(target,before)||equal(own,target))result=own;
  else{
   if(!allowedWorkPath(path))throw new WorkError("protected_conflict",`Target conflict in protected ${path}; original workspace preserved.`);
   if([before,own,target].some(e=>e?.content.includes(0)))throw new WorkError("unsupported_conflict",`Binary conflict in ${path}; original workspace preserved.`);
   const merged=(!own||!target||own.mode!==target.mode)
    ?{content:`<<<<<<< OWNER\n${own?.content.toString()||"(deleted)\n"}||||||| BASE\n${before?.content.toString()||""}=======\n${target?.content.toString()||"(deleted)\n"}>>>>>>> TARGET\n`,conflict:true}
    :await mergeText(before?.content.toString()||"",own.content.toString(),target.content.toString(),path);
   result={file:path,mode:own?.mode||target?.mode||"100644",content:Buffer.from(merged.content)};
   if(merged.conflict||!own||!target||own.mode!==target.mode)conflicts.push(path);
  }
  if(result)entries.push(result);
 }
 return{entries,conflicts};
}
