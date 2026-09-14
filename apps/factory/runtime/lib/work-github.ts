import { createHash } from "node:crypto";
import { z } from "zod";
import { includeSource, repository } from "./github.mjs";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const object = z.record(z.string(), z.unknown());
const treeItem = z.object({ path: z.string(), mode: z.string(), type: z.string(), sha, size: z.number().optional() });
export const MAX_WORK_CHANGES = 30;
export const MAX_WORK_FILE_BYTES = 500_000;
export const MAX_WORK_BYTES = 2_000_000;
export interface WorkEntry { file: string; content: Buffer; mode: "100644" | "100755" }
export interface WorkSnapshot { revision: string; treeSha: string; entries: WorkEntry[]; excludedPaths: string[] }
export interface WorkChange { path: string; content: string | null }
export interface PublishWorkInput { sessionId:string; baseSha:string; title:string; body:string; changes:WorkChange[]; operationId?:string; targetBranch?:string; targetHeadSha?:string; parentPrNumber?:number; previous?:{number:number;headSha:string}; mergeTarget?:boolean }
export interface WorkPublication {branch:string;number:number;url:string;headSha:string;baseSha:string;ownerSessionId:string;targetBranch:string;targetHeadSha:string;parentPrNumber?:number;ownershipCommitSha?:string;targetAdvanced?:boolean}
export class WorkError extends Error {readonly code:string;constructor(code:string,message:string){super(message);this.code=code;}}
export function safeBranch(branch:string){if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch)||branch.includes("..")||branch.includes("//")||branch.endsWith("/")||branch.endsWith(".lock"))throw new WorkError("invalid_request","Unsupported branch name.");return branch;}

class GitHubError extends Error { readonly status: number; constructor(status: number) { super(`Factory GitHub request failed: HTTP ${status}.`); this.status = status; } }
function safePath(path: string) { return path.length > 0 && path.length <= 300 && !path.startsWith("/") && !/[\\\x00-\x1f\x7f]/.test(path) && path.split("/").every(part => part !== "" && part !== "." && part !== ".."); }
// Publication allowlist for the target Nuxt application. The migrator writes
// application source, tests and end-to-end specs. The manifest, lockfile, Nuxt
// config, CI, factory policy and agent files are protected: widening this list
// is a reviewed factory change made outside a run.
export const PUBLISHABLE_ROOTS = ["app/", "server/", "shared/", "tests/", "e2e/", "types/"] as const;
export function allowedWorkPath(path: string): boolean {
  if (!safePath(path) || !includeSource(path)) return false;
  if (path === "app.config.ts") return true;
  if (!PUBLISHABLE_ROOTS.some(prefix => path.startsWith(prefix))) return false;
  const name = path.split("/").at(-1)!;
  if (["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "turbo.json", "vercel.json", ".npmrc"].includes(name) || /^tsconfig(?:[.-].*)?\.json$/.test(name) || /\.config\.[cm]?[jt]s$/.test(name)) return false;
  if (path.split("/").some(part => ["AGENTS.md", "CLAUDE.md", "SKILL.md", ".output", ".nuxt", "dist", "coverage", "node_modules"].includes(part) || part.startsWith(".env"))) return false;
  return true;
}
async function request(token: string, path: string, signal?: AbortSignal, body?: unknown, method?:"PATCH") {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method: method || (body === undefined ? "GET" : "POST"), redirect: "error",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(20000)]),
  });
  if (!response.ok) throw new GitHubError(response.status);
  return { data: await response.json(), next: response.headers.get("link")?.includes('rel="next"') || false };
}
export async function commitTree(token: string, revision: string, signal?: AbortSignal) {
  if (revision !== "main") sha.parse(revision);
  const commit = z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) }).parse((await request(token, `commits/${revision}`, signal)).data);
  if (revision !== "main" && commit.sha !== revision) throw new Error("GitHub returned a different commit.");
  const tree = z.object({ truncated: z.boolean(), tree: z.array(treeItem) }).parse((await request(token, `git/trees/${commit.commit.tree.sha}?recursive=1`, signal)).data);
  if (tree.truncated || tree.tree.length > 5000) throw new Error("Repository tree is incomplete or exceeds the station limit.");
  return { revision: commit.sha, treeSha: commit.commit.tree.sha, tree: tree.tree };
}
export async function loadWorkSnapshot(token: string, revision: string = "main", signal?: AbortSignal): Promise<WorkSnapshot> {
  const source = await commitTree(token, revision, signal);
  const selected = source.tree.filter(item => item.type === "blob" && ["100644", "100755"].includes(item.mode) && safePath(item.path) && includeSource(item.path));
  if (selected.length > 1500 || selected.reduce((sum, item) => sum + (item.size || 0), 0) > 50_000_000) throw new Error("Source snapshot exceeds the station limit.");
  const entries: WorkEntry[] = [];
  for (let offset = 0; offset < selected.length; offset += 8) entries.push(...await Promise.all(selected.slice(offset, offset + 8).map(async item => {
    const blob = z.object({ encoding: z.literal("base64"), content: z.string() }).parse((await request(token, `git/blobs/${item.sha}`, signal)).data);
    const content = Buffer.from(blob.content, "base64");
    if (content.length > 50_000_000) throw new Error("Source blob exceeds station limit.");
    return { file: item.path, content, mode: item.mode as WorkEntry["mode"] };
  })));
  return { revision: source.revision, treeSha: source.treeSha, entries, excludedPaths: source.tree.filter(item => item.type !== "tree" && !selected.includes(item)).map(item => item.path) };
}
const pullSchema = z.object({ number: z.number().int().positive(), html_url: z.string().url(), title: z.string(), body: z.string().nullable(), state: z.string(), merged: z.boolean().optional(), merge_commit_sha: sha.nullable().optional(), draft: z.boolean().optional(), head: z.object({ sha, ref: z.string(), repo: z.object({ full_name: z.literal(repository) }) }), base: z.object({ sha, ref: z.string(), repo: z.object({ full_name: z.literal(repository) }) }) });
export async function readPull(token: string, number: number, signal?: AbortSignal) {
  z.number().int().positive().parse(number);
  const pr = pullSchema.parse((await request(token, `pulls/${number}`, signal)).data);
  if (pr.number !== number) throw new Error("GitHub returned a different pull request.");
  return pr;
}
export async function verifyPullRequestHead(token: string, number: number, headSha: string, signal?: AbortSignal, baseSha?: string, targetBranch?:string) {
  sha.parse(headSha);
  if (baseSha) sha.parse(baseSha);
  const pr = await readPull(token, number, signal);
  const currentTarget=baseSha?await readBranch(token,pr.base.ref,signal):null;
  if (pr.state !== "open" || pr.head.sha !== headSha || (targetBranch&&pr.base.ref!==targetBranch) || (baseSha && currentTarget!==baseSha)) throw new Error("Pull request changed or closed; start a fresh review.");
  return true;
}
export async function updatePullRequestBody(token:string,number:number,headSha:string,body:string,signal?:AbortSignal){
 z.number().int().positive().parse(number);sha.parse(headSha);z.string().max(50000).parse(body);
 const pull=await readPull(token,number,signal);
 if(pull.state!=='open'||pull.head.sha!==headSha)throw new WorkError('stale_head','Pull request changed before its visual review section could be published.');
 await request(token,`pulls/${number}`,signal,{body},'PATCH');
 await verifyPullRequestHead(token,number,headSha,signal,undefined,pull.base.ref);
}
export async function loadPullRequest(token: string, number: number, signal?: AbortSignal) {
  const pr = await readPull(token, number, signal);
  if (pr.state !== "open") throw new Error("Review requires an open pull request.");
  const files: Array<{ filename: string; status: string; patch?: string; previous_filename?: string }> = [];
  for (let page = 1; page <= 5; page++) {
    const response = await request(token, `pulls/${number}/files?per_page=100&page=${page}`, signal);
    files.push(...z.array(z.object({ filename: z.string(), status: z.string(), patch: z.string().optional(), previous_filename: z.string().optional() })).parse(response.data));
    if (!response.next) break;
    if (page === 5) throw new Error("Pull request file inventory exceeds the bounded review limit.");
  }
  const targetHead=await readBranch(token,pr.base.ref,signal);
  const [snapshot, baseSnapshot] = await Promise.all([loadWorkSnapshot(token, pr.head.sha, signal), loadWorkSnapshot(token, targetHead, signal)]);
  await verifyPullRequestHead(token, number, pr.head.sha, signal, targetHead,pr.base.ref);
  const availableHead = new Set(snapshot.entries.map(entry => entry.file));
  const availableBase = new Set(baseSnapshot.entries.map(entry => entry.file));
  const contextGaps = files.filter(file => (file.status !== "removed" && !availableHead.has(file.filename)) || (file.status !== "added" && !availableBase.has(file.previous_filename || file.filename))).map(file => `Full review content unavailable for ${file.filename}; excluded, symlink or unsupported source.`);
  const ancestry=z.object({status:z.string()}).parse((await request(token,`compare/${targetHead}...${pr.head.sha}`,signal)).data);
  if(!["ahead","identical"].includes(ancestry.status))contextGaps.push("Candidate does not incorporate the captured current target head; integration against that target is unverified. Refresh the owned branch and request a fresh review.");
  return { contextGaps, number: pr.number, url: pr.html_url, title: pr.title, body: pr.body || "", baseSha: targetHead, targetBranch:pr.base.ref, headSha: pr.head.sha, headRef: pr.head.ref, files, snapshot, baseSnapshot };
}
export async function assertRefreshCoverage(token:string,base:string,ours:string,target:string,signal?:AbortSignal){
 const trees=await Promise.all([base,ours,target].map(revision=>commitTree(token,revision,signal)));
 const [b,o,t]=trees.map(tree=>new Map(tree.tree.filter(e=>e.type!=="tree").map(e=>[e.path,e])));
 for(const path of new Set([...b!.keys(),...o!.keys()])){
  const before=b!.get(path),own=o!.get(path),theirs=t!.get(path);
  const identical=(a:typeof before,b:typeof before)=>a?.sha===b?.sha&&a?.mode===b?.mode;
  if(identical(before,own)||identical(own,theirs))continue;
  if(!includeSource(path)||own&&!["100644","100755"].includes(own.mode)||(before&&own&&before.mode!==own.mode)||(own?.mode==="100755"&&theirs?.mode!==own.mode))throw new WorkError("unsupported_conflict",`Owned change in excluded or mode-changing ${path} cannot be represented safely; workspace preserved.`);
 }
}
export async function isDescendant(token:string,ancestor:string,head:string,signal?:AbortSignal){
 const comparison=z.object({status:z.string()}).parse((await request(token,`compare/${sha.parse(ancestor)}...${sha.parse(head)}`,signal)).data);
 return ["ahead","identical"].includes(comparison.status);
}
export async function readBranch(token:string,branch:string,signal?:AbortSignal){
 safeBranch(branch);return z.object({object:z.object({sha})}).parse((await request(token,`git/ref/heads/${branch}`,signal)).data).object.sha;
}
export async function verifyOwnerCommit(token:string,publication:{branch:string;headSha:string;number:number},ownerSessionId:string,signal?:AbortSignal){
 if(publication.branch!==workBranch(ownerSessionId))throw new WorkError("ownership_unverified","Branch does not belong to this logical owner.");
 const commit=z.object({message:z.string()}).parse((await request(token,`git/commits/${sha.parse(publication.headSha)}`,signal)).data);
 const marker=`Factory-Session: ${createHash("sha256").update(ownerSessionId).digest("hex")}`;
 if(!commit.message.includes(marker))throw new WorkError("ownership_unverified","Original publication lacks verified factory provenance.");
}
export async function targetFor(token:string,parentPrNumber?:number,signal?:AbortSignal){
 if(!parentPrNumber)return {targetBranch:"main",targetHeadSha:await readBranch(token,"main",signal)};
 const parent=await readPull(token,parentPrNumber,signal);if(parent.state!=="open")throw new WorkError("invalid_request","Contribution target must be an open PR.");
 return{targetBranch:safeBranch(parent.head.ref),targetHeadSha:await readBranch(token,parent.head.ref,signal),parentPrNumber};
}
export function workBranch(sessionId: string) {
  z.string().min(1).max(200).parse(sessionId);
  return `factory/work-${createHash("sha256").update(sessionId).digest("hex").slice(0, 24)}`;
}
export async function publishWork(token: string, input: PublishWorkInput, signal?: AbortSignal) {
  sha.parse(input.baseSha);
  z.string().trim().min(1).max(200).parse(input.title);
  z.string().max(50000).parse(input.body);
  if ((!input.changes.length&&!input.mergeTarget) || input.changes.length > MAX_WORK_CHANGES) throw new Error("Publish requires 1–30 changed files.");
  let bytes = 0;
  const paths = new Set<string>();
  for (const change of input.changes) {
    if (!allowedWorkPath(change.path) || paths.has(change.path)) throw new Error(`Disallowed or duplicate work path: ${change.path}`);
    paths.add(change.path);
    if (change.content !== null) {
      if (typeof change.content !== "string" || change.content.includes("\0")) throw new Error("Publication supports text files only.");
      const size = Buffer.byteLength(change.content); bytes += size;
      if (size > MAX_WORK_FILE_BYTES || bytes > MAX_WORK_BYTES) throw new Error("Publication exceeds the file or total byte limit.");
    }
  }
  const branch = workBranch(input.sessionId);
  const source = await commitTree(token, input.baseSha, signal);
  const byPath = new Map(source.tree.map(item => [item.path, item]));
  const tree = input.changes.map(change => {
    const previous = byPath.get(change.path);
    if (previous && (previous.type !== "blob" || !["100644", "100755"].includes(previous.mode))) throw new Error("Cannot publish over symlinks, submodules or directories.");
    for (let prefix = change.path; prefix.includes("/");) {
      prefix = prefix.slice(0, prefix.lastIndexOf("/"));
      const ancestor = byPath.get(prefix);
      if (ancestor && ancestor.type !== "tree") throw new Error("Cannot publish below a non-directory Git entry.");
    }
    if (change.content === null && !previous) throw new Error("Cannot delete a file absent from the base snapshot.");
    return { path: change.path, mode: previous?.mode || "100644", type: "blob", ...(change.content === null ? { sha: null } : { content: change.content }) };
  });
  const targetBranch=safeBranch(input.targetBranch||"main");
  const targetHeadSha=sha.parse(input.targetHeadSha||input.baseSha);

  const treeSha = sha.parse(object.parse((await request(token, "git/trees", signal, { base_tree: source.treeSha, tree })).data).sha);
  if(treeSha===source.treeSha&&!input.mergeTarget)throw new WorkError("no_changes","No changes to publish.");
  const operation=input.operationId||createHash("sha256").update(treeSha).digest("hex");
  const marker=`Factory-Session: ${createHash("sha256").update(input.sessionId).digest("hex")}\nFactory-Base: ${input.baseSha}`;
  const ownerMarker=`Factory-Owner: ${input.sessionId}\nFactory-Operation: ${operation}\nFactory-Target: ${targetBranch}\nFactory-Target-Head: ${targetHeadSha}`;
  const parents=input.previous?[input.previous.headSha,...(input.mergeTarget&&targetHeadSha!==input.previous.headSha?[targetHeadSha]:[])]:[input.baseSha];
  async function currentHead(){try{return await readBranch(token,branch,signal);}catch(e){if(e instanceof GitHubError&&e.status===404)return null;throw e;}}
  async function samePublication(head:string){
   const c=z.object({tree:z.object({sha}),parents:z.array(z.object({sha})),message:z.string()}).parse((await request(token,`git/commits/${head}`,signal)).data);
   return c.tree.sha===treeSha&&JSON.stringify(c.parents.map(p=>p.sha))===JSON.stringify(parents)&&c.message.includes(marker)&&c.message.includes(ownerMarker);
  }
  let headSha=await currentHead();
  if(headSha&&await samePublication(headSha)) {
   if(input.previous){
    const existing=await readPull(token,input.previous.number,signal);
    if(existing.state!=="open"||existing.head.ref!==branch||existing.base.ref!==targetBranch||existing.head.sha!==headSha)throw new WorkError("stale_head","Original owner PR changed after publication; a retry cannot create a replacement PR.");
   }
  }
  else {
   if(await readBranch(token,targetBranch,signal)!==targetHeadSha)throw new WorkError("target_advanced","Target advanced; call refresh_target to preserve and merge your work before rechecking.");
   if(input.parentPrNumber){const parent=await readPull(token,input.parentPrNumber,signal);if(parent.state!=="open"||parent.head.ref!==targetBranch)throw new WorkError("target_closed","Parent PR closed or changed; preserve source and request an explicit target decision.");}
   if(input.previous){
    const pr=await readPull(token,input.previous.number,signal);
    if(pr.state!=="open"||pr.head.ref!==branch||pr.base.ref!==targetBranch||headSha!==input.previous.headSha)throw new WorkError("stale_head","Owned branch changed; preserve this workspace and prepare a fresh owner revision.");
   }else if(headSha)throw new WorkError("ownership_unverified","This branch already exists; a new execution cannot adopt it.");
   const created=object.parse((await request(token,"git/commits",signal,{tree:treeSha,parents,message:`factory: ${input.title}\n\n${ownerMarker}\n${marker}`})).data);
   const proposed=sha.parse(created.sha);
   if(await readBranch(token,targetBranch,signal)!==targetHeadSha)throw new WorkError("target_advanced","Target advanced; refresh_target before publication.");
   if(input.previous){
    if(await currentHead()!==input.previous.headSha)throw new WorkError("stale_head","Owned branch changed before publication.");
    await request(token,`git/refs/heads/${branch}`,signal,{sha:proposed,force:false},"PATCH");
   }else{
    try{await request(token,"git/refs",signal,{ref:`refs/heads/${branch}`,sha:proposed});}
    catch(e){if(!(e instanceof GitHubError&&e.status===422))throw e;const actual=await currentHead();if(!actual||!await samePublication(actual))throw new WorkError("ownership_unverified","Concurrent branch claim rejected.");}
   }
   headSha=await currentHead();if(!headSha||!await samePublication(headSha))throw new WorkError("stale_head","Published head differs from this operation.");
  }
  const query=new URLSearchParams({state:"all",head:`${repository.split("/")[0]}:${branch}`,base:targetBranch,per_page:"100"});
  const response=await request(token,`pulls?${query}`,signal);if(response.next)throw new Error("Unexpected paginated owner PRs.");
  const candidates=z.array(pullSchema).parse(response.data);if(candidates.length>1)throw new Error("Ambiguous owner PRs.");
  let pr=candidates[0];
  if(pr&&(pr.state!=="open"||pr.head.sha!==headSha||input.previous&&pr.number!==input.previous.number))throw new WorkError("stale_head","Owner PR changed or closed.");
  if(!pr){
   try{pr=pullSchema.parse((await request(token,"pulls",signal,{head:branch,base:targetBranch,title:input.title,body:`${input.body}\n\n<!-- ${ownerMarker}\n${marker} -->`,draft:true})).data);}
   catch(error){
    if(!(error instanceof GitHubError&&error.status===422))throw error;
    const retried=z.array(pullSchema).parse((await request(token,`pulls?${query}`,signal)).data);
    if(retried.length!==1||retried[0]!.state!=="open"||retried[0]!.head.sha!==headSha)throw error;pr=retried[0]!;
   }
  }
  else if(input.previous)await request(token,`pulls/${pr.number}`,signal,{body:`${input.body}\n\n<!-- ${ownerMarker}\n${marker} -->`},"PATCH");
  await verifyPullRequestHead(token,pr.number,headSha!,signal,undefined,targetBranch);
  const targetAdvanced=await readBranch(token,targetBranch,signal)!==targetHeadSha;
  return {branch,number:pr.number,url:pr.html_url,headSha:headSha!,baseSha:input.baseSha,ownerSessionId:input.sessionId,targetBranch,targetHeadSha,...(targetAdvanced?{targetAdvanced:true}:{}),...(input.parentPrNumber?{parentPrNumber:input.parentPrNumber}:{})};
}
