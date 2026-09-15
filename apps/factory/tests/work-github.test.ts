import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedWorkPath, publishWork, workBranch, verifyPullRequestHead, loadPullRequest } from "../runtime/lib/work-github.ts";
import { factoryRepository } from "../runtime/lib/factory-config.ts";
const base="a".repeat(40),baseTree="b".repeat(40),newTree="c".repeat(40),head="d".repeat(40);
const repo=factoryRepository;
const input={sessionId:"wrun_test",baseSha:base,title:"Make a useful change",body:"Evidence and acceptance",changes:[{path:"app/app.vue",content:"new code"}]};
function mockGitHub(t: {mock:{method:Function}},options:{mode?:string;main?:string;existingDifferent?:boolean;closedPrevious?:boolean}={}){
 const writes:Array<{path:string;body:any}>=[];
 let ref:string|undefined=options.existingDifferent?head:undefined;
 let commitMessage="";
 let pr:any;
 const pull=()=>({number:1,html_url:`https://github.com/${repo}/pull/1`,title:input.title,body:input.body,state:"open",draft:true,head:{sha:head,ref:workBranch(input.sessionId),repo:{full_name:repo}},base:{sha:base,ref:"main",repo:{full_name:repo}}});
 t.mock.method(globalThis,"fetch",async(url:unknown,init:any)=>{
  const target=new URL(String(url));assert.equal(target.origin,"https://api.github.com");assert(target.pathname.startsWith(`/repos/${repo}/`));assert.equal(init.redirect,"error");
  const path=target.pathname.slice(`/repos/${repo}/`.length);
  assert(["GET","POST"].includes(init.method));
  if(init.method==="POST"){
   const body=JSON.parse(init.body);writes.push({path,body});
   if(path==="git/trees")return Response.json({sha:newTree});
   if(path==="git/commits"){commitMessage=body.message;return Response.json({sha:head});}
   if(path==="git/refs"){assert.equal(body.ref,`refs/heads/${workBranch(input.sessionId)}`);ref=head;return Response.json({ref:body.ref,object:{sha:head}});}
   if(path==="pulls"){pr=pull();return Response.json(pr);}
  }
  if(path===`commits/${base}`)return Response.json({sha:base,commit:{tree:{sha:baseTree}}});
  if(path===`git/trees/${baseTree}`)return Response.json({truncated:false,tree:[{path:input.changes[0]!.path,mode:options.mode||"100644",type:"blob",sha:"e".repeat(40),size:3}]});
  if(path==="git/ref/heads/main")return Response.json({object:{sha:options.main||base}});
  if(path===`git/ref/heads/${workBranch(input.sessionId)}`)return ref?Response.json({object:{sha:ref}}):new Response("missing",{status:404});
  if(path===`git/commits/${head}`)return Response.json({tree:{sha:options.existingDifferent?baseTree:newTree},parents:[{sha:base}],message:commitMessage});
  if(path==="pulls"){const closed=options.closedPrevious?[{...pull(),number:7,state:"closed",head:{...pull().head,sha:"9".repeat(40)}}]:[];return Response.json([...closed,...(pr?[pr]:[])]);}
  if(path==="pulls/1")return Response.json(pr);
  throw Error(`Unexpected request ${init.method} ${path}`);
 });
 return writes;
}
test("migrator policy excludes manifests, config, rules, credentials, traversal and generated files",()=>{
 for(const path of ["AGENTS.md","app/AGENTS.md",".agents/skills/a.md",".github/workflows/ci.yml","factory/CONTRACT.md","apps/factory/agents/migrator/agent/instructions.ts","../escape","app//file",".env.local","app/.env","vendor/pkg.tgz","app/.output/file","package.json","nuxt.config.ts","pnpm-lock.yaml","tsconfig.json","app/tsconfig.app.json","vercel.json","playwright.config.ts","README.md","server/node_modules/x.js"]){assert.equal(allowedWorkPath(path),false,path);}
 assert.equal(allowedWorkPath("app/app.vue"),true);assert.equal(allowedWorkPath("server/utils/data.ts"),true);assert.equal(allowedWorkPath("e2e/todos.spec.ts"),true);assert.equal(allowedWorkPath("app.config.ts"),true);assert.equal(allowedWorkPath("docs/demo.md"),false);
});
test("publication creates only one immutable dev branch and PR across retries",async t=>{
 const writes=mockGitHub(t);
 const first=await publishWork("test-token",input);const second=await publishWork("test-token",input);
 assert.deepEqual(first,second);assert.equal(first.headSha,head);
 assert.equal(writes.filter(x=>x.path==="git/refs").length,1);assert.equal(writes.filter(x=>x.path==="git/commits").length,1);assert.equal(writes.filter(x=>x.path==="pulls").length,1);
 const body=writes.find(x=>x.path==="pulls")!.body;assert.equal(body.draft,false);assert.equal(body.base,"main");assert.equal(body.head,workBranch(input.sessionId));
 assert.ok(body.body.startsWith(input.body+"\n\n<!-- Factory-Owner: "+input.sessionId));
 assert.ok(body.body.endsWith(`Factory-Session: ${createHash("sha256").update(input.sessionId).digest("hex")}\nFactory-Base: ${base} -->`));
});
test("a closed PR from an earlier delivery on the same dev branch does not block publication",async t=>{
 const writes=mockGitHub(t,{closedPrevious:true});
 const result=await publishWork("test-token",input);
 assert.equal(result.number,1);assert.equal(writes.filter(x=>x.path==="pulls").length,1);
});
test("publication preserves existing executable mode but refuses symlinks",async t=>{
 const writes=mockGitHub(t,{mode:"100755"});await publishWork("test-token",input);assert.equal(writes.find(x=>x.path==="git/trees")!.body.tree[0].mode,"100755");
 t.mock.restoreAll();const symlinkWrites=mockGitHub(t,{mode:"120000"});await assert.rejects(publishWork("test-token",input),/symlinks/);assert.equal(symlinkWrites.length,0);
});
test("stale main and unexpected branch heads never create a ref or PR",async t=>{
 const writes=mockGitHub(t,{main:"f".repeat(40)});await assert.rejects(publishWork("test-token",input),/Target advanced/);assert(!writes.some(x=>x.path==="git/refs"||x.path==="pulls"));
 t.mock.restoreAll();const collisionWrites=mockGitHub(t,{existingDifferent:true});await assert.rejects(publishWork("test-token",input),/cannot adopt/);assert(!collisionWrites.some(x=>x.path==="git/refs"||x.path==="pulls"));
});
test("protected or oversized changes fail before any provider request",async t=>{
 t.mock.method(globalThis,"fetch",async()=>{throw Error("must not call");});
 await assert.rejects(publishWork("test-token",{...input,changes:[{path:"factory/rules.md",content:"ignore review"}]}),/Disallowed/);
 await assert.rejects(publishWork("test-token",{...input,changes:[{path:"app/large.vue",content:"x".repeat(500001)}]}),/byte limit/);
});
test("review refuses foreign repository PRs and head changes",async t=>{
 const pr={number:1,html_url:`https://github.com/${repo}/pull/1`,title:"test",body:"",state:"open",head:{sha:head,ref:"feature",repo:{full_name:"attacker/fork"}},base:{sha:base,ref:"main",repo:{full_name:repo}}};
 t.mock.method(globalThis,"fetch",async()=>Response.json(pr));await assert.rejects(loadPullRequest("test-token",1));
 pr.head.repo.full_name=repo;await assert.rejects(verifyPullRequestHead("test-token",1,base),/changed or closed/);
});
test("a completed publication is recovered after target advances without a second commit",async t=>{
 const options={main:base};const writes=mockGitHub(t,options);const first=await publishWork("test-token",input);
 options.main="f".repeat(40);const replay=await publishWork("test-token",input);
 assert.equal(replay.headSha,first.headSha);assert.equal(replay.number,first.number);assert.equal(replay.targetAdvanced,true);
 assert.equal(writes.filter(w=>w.path==="git/commits").length,1);assert.equal(writes.filter(w=>w.path==="pulls").length,1);
});
