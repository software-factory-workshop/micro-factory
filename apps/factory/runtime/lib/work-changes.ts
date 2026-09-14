import { createHash } from "node:crypto";
import { z } from "zod";
import { allowedWorkPath,MAX_WORK_CHANGES,MAX_WORK_FILE_BYTES,MAX_WORK_BYTES,type WorkChange } from "./work-github.ts";
export function changesDigest(changes:WorkChange[]) {return createHash("sha256").update(JSON.stringify(changes)).digest("hex");}
export function validateCollectedChanges(value:unknown,allowEmpty=false):WorkChange[] {
 const changes=z.array(z.object({path:z.string(),content:z.string().nullable()}).strict()).max(MAX_WORK_CHANGES).parse(value);
 if(!changes.length&&!allowEmpty)throw new Error("No source changes to publish.");
 let size=0;
 for(const c of changes){
  if(!allowedWorkPath(c.path))throw new Error(`Protected path changed: ${c.path}`);
  if(c.content&&/^(<<<<<<< |\|\|\|\|\|\|\| |=======\s*$|>>>>>>> )/m.test(c.content))throw new Error(`Unresolved merge conflict in ${c.path}`);
  const bytes=Buffer.byteLength(c.content||"");size+=bytes;
  if(bytes>MAX_WORK_FILE_BYTES||size>MAX_WORK_BYTES||c.content?.includes("\0"))throw new Error("Changed text exceeds publication bounds.");
 }
 if(new Set(changes.map(c=>c.path)).size!==changes.length)throw new Error("Duplicate changed path.");
 return changes.sort((a,b)=>a.path.localeCompare(b.path));
}
// Inputs are trusted host snapshot hashes. The script can read only ordinary files
// under the snapshot root; generated dependencies are excluded from enumeration.
export function collectChangesCommand(baseline:Array<{file:string;sha256:string}>,root="/workspace/repo") {
 const script=`const fs=require('fs'),path=require('path'),crypto=require('crypto');
 const root=${JSON.stringify(root)},base=new Map(${JSON.stringify(baseline)}.map(x=>[x.file,x.sha256])),found=new Set(),out=[];
 const ignored=new Set(['node_modules','.git','.eve','.vercel','.swc','.nuxt','.output','.turbo','dist','coverage']);
 function visit(dir=''){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=dir?dir+'/'+e.name:e.name;if(ignored.has(e.name)||e.name.startsWith('.env')||p==='.factory-snapshot.json'||p.startsWith('.factory-'))continue;if(e.isSymbolicLink())throw Error('Symlink not supported: '+p);if(e.isDirectory()){visit(p);continue;}if(!e.isFile())throw Error('Unsupported file: '+p);found.add(p);const b=fs.readFileSync(path.join(root,p));const h=crypto.createHash('sha256').update(b).digest('hex');if(h!==base.get(p)){if(b.length>${MAX_WORK_FILE_BYTES}||b.includes(0))throw Error('Non-text/large changed file: '+p);const text=b.toString('utf8');if(!Buffer.from(text).equals(b))throw Error('Invalid UTF-8: '+p);out.push({path:p,content:text});}}}
 visit();for(const p of base.keys())if(!found.has(p))out.push({path:p,content:null});if(out.length>${MAX_WORK_CHANGES})throw Error('Too many changes');const result=JSON.stringify(out);if(Buffer.byteLength(result)>${MAX_WORK_BYTES*2})throw Error('Diff too large');console.log(result);`;
 return `export PATH="$HOME/.local/bin:$PATH"; node -e '${script.replaceAll("'","'\\''")}'`;
}
export async function collectChanges(sandbox:{run(input:{command:string}):PromiseLike<{exitCode:number;stdout:string;stderr:string}>},baseline:Array<{file:string;sha256:string}>,allowEmpty=false) {
 const result=await sandbox.run({command:collectChangesCommand(baseline)});
 if(result.exitCode!==0)throw new Error(`Cannot collect source changes: ${result.stderr.slice(-1200)}`);
 return validateCollectedChanges(JSON.parse(result.stdout),allowEmpty);
}
