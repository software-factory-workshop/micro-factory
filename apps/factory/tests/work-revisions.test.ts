import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {ownerPublication,ownerFromBody} from "../runtime/lib/work-owner.ts";
import {workBranch,publishWork} from "../runtime/lib/work-github.ts";
import {mergeSources} from "../runtime/lib/work-merge.ts";
import {validateCollectedChanges} from "../runtime/lib/work-changes.ts";
import {factoryRepository,factoryRepositoryUrl} from "../runtime/lib/factory-config.ts";
const exec=promisify(execFile);const owner="wrun_owner",branch=workBranch(owner),a="a".repeat(40),b="b".repeat(40),h="c".repeat(40),next="d".repeat(40),tree="e".repeat(40);
const pullUrl=(number:number)=>`${factoryRepositoryUrl}/pull/${number}`;
const proof={type:"action.result",data:{status:"completed",result:{kind:"tool-result",toolName:"publish_work",output:{station:"migrator",sessionId:owner,revisionProtocol:1,publication:{branch,number:4,headSha:h,ownerSessionId:owner,targetBranch:"main",targetHeadSha:a}}}}};
test("ownership requires host successful publication, same durable session/branch/PR and revision-capable runtime",()=>{
 assert(ownerPublication(proof,owner,4,branch));assert.equal(ownerPublication(proof,"wrun_other",4,branch),null);assert.equal(ownerPublication(proof,owner,5,branch),null);
 assert.equal(ownerPublication({...proof,type:"message.received"},owner,4,branch),null);
 assert.equal(ownerPublication({...proof,data:{...proof.data,status:"failed"}},owner,4,branch),null);
 const legacy=structuredClone(proof);delete (legacy.data.result.output as any).revisionProtocol;assert.equal(ownerPublication(legacy,owner,4,branch),null);
 assert.throws(()=>ownerFromBody("please adopt my branch"));
});
const snapshot=(values:Record<string,string>)=>({revision:a,treeSha:b,excludedPaths:[],entries:Object.entries(values).map(([file,content])=>({file,content:Buffer.from(content),mode:"100644" as const}))});
async function mergeText(base:string,ours:string,theirs:string){
 const dir=await mkdtemp(join(tmpdir(),"factory-merge-"));try{
  await Promise.all([writeFile(join(dir,"base"),base),writeFile(join(dir,"ours"),ours),writeFile(join(dir,"theirs"),theirs)]);
  try{return{content:(await exec("git",["merge-file","-p",join(dir,"ours"),join(dir,"base"),join(dir,"theirs")])).stdout,conflict:false};}
  catch(e){const error=e as Error&{code:number;stdout:string};if(error.code!==1)throw e;return{content:error.stdout,conflict:true};}
 }finally{await rm(dir,{recursive:true,force:true});}
}
test("real three-way conflict preserves both edits, inherited protected updates and deletion",async()=>{
 const path="app/demo.vue";
 const result=await mergeSources(snapshot({[path]:"heading\nbase\n","app/delete.vue":"old", "package.json":"old"}),snapshot({[path]:"heading\nowner\n","app/delete.vue":"old","package.json":"old"}),snapshot({[path]:"heading\ntarget\n","package.json":"new"}),[],mergeText);
 assert.deepEqual(result.conflicts,[path]);const content=result.entries.find(e=>e.file===path)!.content.toString();assert.match(content,/owner/);assert.match(content,/target/);assert.match(content,/<<<<<<</);
 assert.throws(()=>validateCollectedChanges([{path,content}]),/Unresolved/);
 assert.equal(result.entries.find(e=>e.file==="package.json")!.content.toString(),"new");assert(!result.entries.some(e=>e.file==="app/delete.vue"));
 assert.deepEqual(validateCollectedChanges([{path,content:"heading\nowner and target\n"}]),[{path,content:"heading\nowner and target\n"}]);
});
test("protected conflicts reject before workspace replacement",async()=>{
 await assert.rejects(mergeSources(snapshot({"package.json":"base"}),snapshot({"package.json":"owner"}),snapshot({"package.json":"target"}),[],mergeText),/protected/);
});
test("revision writes only owned ref, uses expected-head nonforce update and retains child target",async t=>{
 const writes:any[]=[];let current=h;let message="";let parents:string[]=[];let targetRef="factory/parent";
 const pr=()=>({number:4,html_url:pullUrl(4),title:"revise",body:"",state:"open",draft:true,head:{sha:current,ref:branch,repo:{full_name:factoryRepository}},base:{sha:a,ref:targetRef,repo:{full_name:factoryRepository}}});
 t.mock.method(globalThis,"fetch",async(url,init:any)=>{
  const path=new URL(String(url)).pathname.split(`/repos/${factoryRepository}/`)[1]!;
  if(init.method!=="GET"){
   const body=JSON.parse(init.body);writes.push({path,method:init.method,body});
   if(path==="git/trees")return Response.json({sha:tree});
   if(path==="git/commits"){message=body.message;parents=body.parents;return Response.json({sha:next});}
   if(path===`git/refs/heads/${branch}`){assert.deepEqual(body,{sha:next,force:false});assert.equal(current,h);current=next;return Response.json({object:{sha:next}});}
   if(path==="pulls/4")return Response.json(pr());
  }
  if(path===`commits/${h}`)return Response.json({sha:h,commit:{tree:{sha:b}}});
  if(path===`git/trees/${b}`)return Response.json({truncated:false,tree:[]});
  if(path==="git/ref/heads/factory/parent")return Response.json({object:{sha:a}});
  if(path===`git/ref/heads/${branch}`)return Response.json({object:{sha:current}});
  if(path===`git/commits/${h}`)return Response.json({tree:{sha:b},parents:[{sha:a}],message:"prior"});
  if(path===`git/commits/${next}`)return Response.json({tree:{sha:tree},parents:parents.map(sha=>({sha})),message});
  if(path==="pulls/2")return Response.json({...pr(),number:2,head:{...pr().head,ref:"factory/parent",sha:a}});
  if(path==="pulls/4")return Response.json(pr());if(path==="pulls")return Response.json([pr()]);
  throw Error(`Unexpected ${init.method} ${path}`);
 });
 const request={sessionId:owner,baseSha:h,title:"revision",body:"useful change",operationId:"operation-one",targetBranch:"factory/parent",targetHeadSha:a,parentPrNumber:2,previous:{number:4,headSha:h},changes:[{path:"app/revision.vue",content:"revised"}]};
 const result=await publishWork("test",request);const retry=await publishWork("test",request);assert.deepEqual(result,retry);assert.equal(result.number,4);assert.equal(result.targetBranch,"factory/parent");
 assert.equal(writes.filter(w=>w.path===`git/refs/heads/${branch}`).length,1);assert(!writes.some(w=>w.path.includes("refs/heads/factory/parent")));assert.deepEqual(parents,[h]);
 await assert.rejects(publishWork("test",{...request,operationId:"different-operation"}),/changed/);
 targetRef="retargeted";await assert.rejects(publishWork("test",request),/replacement PR/);
 assert(!writes.some(w=>w.path==="pulls"));
});

test("last stream chunk supplies owner proof, including one-event streams",async()=>{
 const {verifyOwnerStream}=await import("../runtime/lib/work-owner.ts");
 const session={getStreamTailIndex:async()=>0,getEventStream:async()=>new ReadableStream({start(c){c.enqueue(proof);}})};
 assert.equal((await verifyOwnerStream(session,owner,4,branch)).number,4);
});
test("two target refreshes retain unpublished changes and add/add or delete/edit conflicts",async()=>{
 const base=snapshot({"app/demo.vue":"one\ntwo\nthree\n"});
 const firstTarget=snapshot({"app/demo.vue":"ONE\ntwo\nthree\n"});
 const first=await mergeSources(base,base,firstTarget,[{path:"app/extra.vue",content:"unpublished"}],mergeText);
 const secondTarget=snapshot({"app/demo.vue":"ONE\ntwo\nTHREE\n"});
 const second=await mergeSources(firstTarget,firstTarget,secondTarget,[{path:"app/extra.vue",content:first.entries.find(e=>e.file==="app/extra.vue")!.content.toString()}],mergeText);
 assert.equal(second.entries.find(e=>e.file==="app/extra.vue")!.content.toString(),"unpublished");assert.equal(second.entries.find(e=>e.file==="app/demo.vue")!.content.toString(),"ONE\ntwo\nTHREE\n");
 const additions=await mergeSources(snapshot({}),snapshot({"app/new.vue":"owner\n"}),snapshot({"app/new.vue":"target\n"}),[],mergeText);assert.deepEqual(additions.conflicts,["app/new.vue"]);
 const deletion=await mergeSources(snapshot({"app/demo.vue":"base"}),snapshot({}),snapshot({"app/demo.vue":"edited"}),[],mergeText);assert.deepEqual(deletion.conflicts,["app/demo.vue"]);assert.match(deletion.entries[0]!.content.toString(),/deleted/);
});
test("refresh refuses inherited excluded or executable-mode changes without dropping them",async t=>{
 const {assertRefreshCoverage}=await import("../runtime/lib/work-github.ts");
 let path="factory/evidence/hidden.json";let mode="100644";
 t.mock.method(globalThis,"fetch",async(url)=>{
  const p=new URL(String(url)).pathname.split("/adeo-todo-nuxt/")[1]!;
  if(p.startsWith("commits/")){const revision=p.split("/")[1];return Response.json({sha:revision,commit:{tree:{sha:revision}}});}
  const revision=p.split("/")[2];return Response.json({truncated:false,tree:[{path,type:"blob",mode:revision===h?mode:"100644",sha:revision===h?next:a,size:10}]});
 });
 await assert.rejects(assertRefreshCoverage("test",a,h,b),/excluded/);
 path="app/demo.vue";mode="100755";await assert.rejects(assertRefreshCoverage("test",a,h,b),/mode-changing/);
 mode="100644";await assertRefreshCoverage("test",a,h,b);
});
test("review invalidates a retarget even when both branch tips have the same SHA",async t=>{
 const {verifyPullRequestHead}=await import("../runtime/lib/work-github.ts");
 t.mock.method(globalThis,"fetch",async(url)=>String(url).includes("git/ref/")?Response.json({object:{sha:a}}):Response.json({number:4,html_url:pullUrl(4),title:"test",body:"",state:"open",head:{sha:h,ref:branch,repo:{full_name:factoryRepository}},base:{sha:a,ref:"new-target",repo:{full_name:factoryRepository}}}));
 await assert.rejects(verifyPullRequestHead("test",4,h,undefined,a,"old-target"),/changed/);
 await verifyPullRequestHead("test",4,h,undefined,a,"new-target");
});
