import { factorySession, respondToSessionInput, recordedRoot } from "../lib/root-agent-client";
import { ensureDeliveryDriver,cancelDeliveryDriver } from '../lib/delivery-driver';
import { ownsDriver } from '../lib/delivery-driver-state';
import { defineChannel,GET,POST,type RouteHandlerArgs } from 'eve/channels';
import { routeAuth } from 'eve/channels/auth';
import { z } from 'zod';
import { getToken } from '@vercel/connect';
import { readCockpit,updateCockpit } from '../lib/cockpit-store';
import { changeRecord,workOrderAdmissionSchema } from '../../shared/cockpit';
import { factoryAuth } from '../lib/route-auth';
import { stationOperation } from './stations';
import { answerOwnerQuestion, retryGate, deliveryRequest,newDelivery,operationFor,transition,terminal,applyReview,referenceState,claimAdvance,commitAdvance,requestResume,beginRevision,admissionRecoveryAction,recordAdmissionFailure,retryAdmission,resetObservation,askBudgetApproval,BUDGET_APPROVE,type Delivery } from '../lib/delivery-state';
import { listDeliveryReceipts,readDelivery,updateDelivery } from '../lib/delivery-store';
import { classifyDeliveryError,snapshotEvents,childIn,hostResult,stoppedWithoutResult,eventsForDelivery,modelUsageFromEvents,accumulateModelUsage,pendingSessionLimit,resumeMessage,resumeReceipt,type ClassifiedDeliveryError, type EventSnapshot } from '../lib/delivery-events';
import { readPull,readBranch,readPreviewDeployment,WorkError,workBranch,mergePull,deleteBranch } from '../lib/work-github';
import { githubConnectorName } from '../lib/factory-config.ts';
import { bootstrapTarget } from '../lib/bootstrap';
import { mergeableHead, approvableHead } from '../lib/delivery-state';
import { factoryDeliveryDriverPrincipal } from '../lib/cedar/guard';
import { changeResource } from '../lib/cedar/model';
import { reconcileManuallyMergedDelivery } from '../lib/delivery-reconcile';
import { gateStations } from '../lib/station-access';
import { mergeEligibility } from '../lib/merge-policy';
import { digestRunEvents,accumulateRunActivity,describeStopWithoutResult } from '../lib/run-digest';
import { runFactoryOperation } from '../lib/cedar/operation-runner';
import { factoryWorkflowPrincipal } from '../lib/cedar/guard';
import { repositoryResource } from '../lib/cedar/model';
const publication=z.object({repository:z.string().optional(),preview:z.object({url:z.string(),state:z.string(),environment:z.string(),checkedAt:z.string()}).optional(),number:z.number().int().positive(),url:z.string().url(),headSha:z.string().regex(/^[a-f0-9]{40}$/),targetHeadSha:z.string().regex(/^[a-f0-9]{40}$/),targetBranch:z.string(),ownerSessionId:z.string(),branch:z.string()});
const review=z.object({verdict:z.enum(['approve','changes_requested','incomplete']),summary:z.string(),headSha:z.string(),baseSha:z.string(),targetBranch:z.string(),findings:z.array(z.object({severity:z.string(),path:z.string(),line:z.number().int().positive().optional(),message:z.string(),evidence:z.string()})),limitations:z.array(z.string()),gate:z.enum(gateStations as unknown as [string,...string[]]).optional(),line:z.number().int().positive().optional(),verification:z.object({prepared:z.boolean(),repositoryChecksPassed:z.boolean(),candidateUnchanged:z.boolean()}).optional()});
function admissionFailureResponse(state: Delivery){return Response.json({deliveryId:state.id,phase:state.phase,state:state.state,error:state.error||'Outer workflow admission failed.',recovery:admissionRecoveryAction(state.id,state.request)},{status:503});}
async function existing(id:string){const saved=await readDelivery(id);if(!saved)throw new Error('Delivery not found');return saved.state;}
function classifiedResponse(failure: ClassifiedDeliveryError, state?: Delivery){
 const recovery=failure.code.startsWith('observation_')&&state ? {method:'POST',path:`/factory/delivery/${state.id}/resume`,body:{},description:'Retry observation of the same session. The failed phase and owner are preserved.'} : failure.code==='provider_unavailable'&&state ? {method:'POST',path:`/factory/delivery/${state.id}/advance`,body:{},description:'Retry the same delivery operation after the provider recovers.'} : undefined;
 return Response.json({...(state?{deliveryId:state.id,phase:state.phase,state:state.state,failedPhase:state.failedPhase}:{}),error:{code:failure.code,kind:failure.kind,message:failure.message,retryable:failure.retryable},...(recovery?{recovery}:{})},{status:failure.status});
}
function rememberObservation(state: Delivery, snapshot: EventSnapshot) {
 if(!snapshot.length)return;
 state.observation={lastEventIndex:snapshot.observation.lastEventIndex,lastEventAt:snapshot.observation.lastEventAt||state.observation.lastEventAt||new Date().toISOString()};
}
function protectedRoute(fn:(request:Request,args:RouteHandlerArgs)=>Promise<Response>){return async(request:Request,args:RouteHandlerArgs)=>{const auth=await routeAuth(request,factoryAuth);if(auth instanceof Response)return auth;try{return await fn(request,args);}catch(error){return classifiedResponse(classifyDeliveryError(error));}};}
// Vercel deploys every pushed factory branch; record that preview on the publication so the
// cockpit can open the running candidate. Read from GitHub deployment statuses (no Vercel token).
async function refreshPreview(state:Delivery){
 const p=state.publication;if(!p||p.preview?.state==='success')return;
 try{const token=await getToken(githubConnectorName,{subject:{type:'app'}});const preview=await readPreviewDeployment(token,p.headSha,undefined,state.request.repository);if(preview)state.publication={...p,preview};}
 catch{/* preview is informative; never blocks the loop */}
}
async function checkCurrent(p:NonNullable<Delivery['publication']>,repository:string){
 const token=await getToken(githubConnectorName,{subject:{type:'app'}});const pr=await readPull(token,p.number,undefined,repository);const targetHeadSha=await readBranch(token,pr.base.ref,undefined,repository);
 const status=referenceState(p,{state:pr.state,headSha:pr.head.sha,targetBranch:pr.base.ref,targetHeadSha});
 if(status==='needs_revision')throw new WorkError('needs_revision','PR head or target advanced. Request /revise for the original owner to incorporate current changes with refresh_target, verify and republish; then the loop requests a fresh review.');
 if(status==='blocked')throw new WorkError('target_closed','PR closed or retargeted; an explicit target decision is required. No branch was adopted.');
}
async function advance(request:Request,ctx:RouteHandlerArgs){
 const id=ctx.params.id;let state=await existing(id);if(terminal(state.phase)||state.phase==='awaiting_input')return Response.json(state);
 const driverGeneration=request.headers.get('x-factory-driver-generation');
 if(driverGeneration&&!ownsDriver(state,driverGeneration,request.headers.get('x-factory-driver-run')||''))return Response.json(state);
 const claim=await updateDelivery(id,current=>{if(!current)throw new Error('Delivery not found');const result=claimAdvance(current);return{state:current,result};});
 if(!claim)return Response.json(await existing(id));state=claim;let claimedVersion=claim.version;const startedPhase=claim.phase;
 let failure: ClassifiedDeliveryError|undefined;
 try{
  if(state.phase==='merging'){
   if(!state.publication||!state.mergeReview||!state.reviewerSessionId)throw new Error('Missing bound review for merge decision');
   state.mergeDecision=mergeEligibility({files:[],review:state.mergeReview,headSha:state.publication.headSha,baseSha:state.publication.targetHeadSha,targetBranch:state.publication.targetBranch,workerSessionId:state.publication.ownerSessionId,reviewerSessionId:state.reviewerSessionId});
   transition(state,'human_review',{reason:state.mergeDecision.reason});
  }else if(state.phase==='owner_resuming'&&state.budgetRequest){
   // The owner answered a session-limit question: respond to Eve's input request on the same session; never resend the task.
   const budget=state.budgetRequest;const answer=[...state.questions].reverse().find(q=>q.operationId===state.resumeOperationId)?.answer;
   const root=await recordedRoot(budget.sessionId);if(!root)throw new Error('The paused station root is unknown; answer it from its run page.');
   const approved=answer===BUDGET_APPROVE;
   const accepted=await respondToSessionInput(root,budget.sessionId,budget.requestId,approved?'continue':'stop');
   delete state.budgetRequest;
   if(!approved){state.failedPhase=undefined;state.error='The owner stopped the station at its token guardrail; source and ownership are preserved.';transition(state,'human_review',{actor:'operator',reason:'Owner declined a fresh token budget.'});}
   else{if(accepted.deliveryId)state.deliveryId=accepted.deliveryId;const back=root==='migrator'?(state.cycle>0?'revising':'working'):'reviewing';transition(state,back as Parameters<typeof transition>[1],{reason:`Owner approved a fresh token budget for the ${root} session.`});}
  }else if(state.phase==='owner_resuming'){
   if(!state.childSessionId||state.publication||!state.resumeOperationId)throw new Error('Recovery requires the original unpublished migrator.');
   let deliveryId:string|undefined;
   if(state.resumeAttemptedAt){
    const snapshot=await snapshotEvents((await factorySession(state.childSessionId,ctx.attachSession)),{startIndex:0});
    rememberObservation(state,snapshot);
   await refreshPreview(state);
    deliveryId=resumeReceipt(snapshot,state.resumeOperationId,state.resumeMessage);
    // Send intent is recorded before the queued message. If the receipt is lost we
    // look for the exact message in the owner's durable stream; we never resend,
    // because a duplicate turn would make the owner do the work twice. The rare
    // crash-before-send case is therefore left for a person after 60 s instead of
    // guessing. Recovery paths: unpublished worker after a baseline failure ->
    // fix the baseline, then /resume (or CLI --continue); published worker ->
    // /revise; stopped reviewer -> start a new review; this error -> inspect.
    if(!deliveryId&&Date.now()-state.resumeAttemptedAt>60000)throw new Error('Resume acceptance is unconfirmed. No message was resent. Inspect the original owner before manual recovery.');
   }else{
    const marked=await updateDelivery(id,current=>{if(!current)throw new Error('Delivery missing');if(current.version!==claimedVersion)return{state:current,result:null};current.resumeAttemptedAt=Date.now();current.version++;return{state:current,result:structuredClone(current)};});
    if(!marked)return Response.json(await existing(id));
    state.resumeAttemptedAt=marked.resumeAttemptedAt;state.version=marked.version;claimedVersion=marked.version;
    const auth=await routeAuth(request,factoryAuth);if(auth instanceof Response)throw new Error('Recovery identity unavailable');
    const accepted=await (await factorySession(state.childSessionId,ctx.attachSession)).send(state.resumeMessage||resumeMessage(state.resumeOperationId),{turnPolicy:'queue',auth:{...auth,attributes:{...auth.attributes,factoryResumeOperationId:state.resumeOperationId}}});
    if(accepted.status!=='accepted'||!accepted.deliveryId)throw new Error('Original migrator acceptance is unconfirmed; this owner will not be replaced.');
    deliveryId=accepted.deliveryId;
   }
   if(deliveryId){state.sessionId=state.childSessionId;state.deliveryId=deliveryId;state.execution={attempt:state.attempt,station:'migrator',operationId:state.operationId,sessionId:state.childSessionId,deliveryId};transition(state,'working',{reason:'The original owner accepted the queued continuation.'});}
  }else if(state.phase.endsWith('_starting')){
   const station=state.phase==='worker_starting'?'migrator':state.phase==='review_starting'?(state.gate??gateStations[0]!):'revisions';
   if(station!=='migrator'&&station!=='revisions')await checkCurrent(state.publication!,state.request.repository);
   const repository=state.request.repository;
   const body=station==='migrator'?{operationId:state.operationId,title:state.request.title,brief:state.request.brief,repository,prototype:state.request.prototype,...(state.request.parentPrNumber?{parentPrNumber:state.request.parentPrNumber}:{})}:station==='revisions'?{operationId:state.operationId,prNumber:state.publication!.number,brief:state.revisionBrief,repository}:{operationId:state.operationId,prNumber:state.publication!.number,repository,prototype:state.request.prototype};
   const response=await stationOperation(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)}),{...ctx,params:{station}},state.id);
   const result=await response.json();if(!response.ok){const code=typeof result.error==='object'&&result.error&&typeof result.error.code==='string'?result.error.code:response.status>=500?'provider_unavailable':'invalid_request';throw new WorkError(code,typeof result.error==='string'?result.error:result.error?.message||'Station start failed');}
   const previousSession=state.sessionId;state.sessionId=z.string().parse(result.sessionId);state.childSessionId=station==='revisions'||result.execution==='direct'||result.execution==='owner'?state.sessionId:undefined;state.deliveryId=result.deliveryId;if(state.sessionId!==previousSession){resetObservation(state);delete state.activity;}state.execution={attempt:state.attempt,station,operationId:state.operationId,sessionId:state.sessionId,deliveryId:state.deliveryId};
   transition(state,station==='migrator'?'working':station==='revisions'?'revising':'reviewing',{reason:`${station} execution accepted by the host.`});
  }else{
   if(!state.sessionId)throw new Error('Delivery session receipt missing');
   let startIndex=state.observation.lastEventIndex+1;
   let snapshot=await snapshotEvents((await factorySession(state.sessionId,ctx.attachSession)),{startIndex});
   if(!snapshot.length&&snapshot.observation.lastEventIndex<startIndex-1){resetObservation(state);startIndex=0;snapshot=await snapshotEvents((await factorySession(state.sessionId,ctx.attachSession)),{startIndex});}
   let events: unknown[]=snapshot;
   if(!state.childSessionId)state.childSessionId=childIn(events);
   if(state.childSessionId&&state.childSessionId!==state.sessionId){
    snapshot=await snapshotEvents((await factorySession(state.childSessionId,ctx.attachSession)),{startIndex});
    events=snapshot;
   }
   rememberObservation(state,snapshot);
   const owner=state.childSessionId||state.sessionId;
   if(state.deliveryId)events=eventsForDelivery(events,state.deliveryId);
   // Accumulate across advances: each observation window only holds the events since the cursor.
   const usage=accumulateModelUsage(state.usage,modelUsageFromEvents(events,{attachFactorySha:true}));
   if(usage)state.usage=usage;
   // The cockpit shows what the station is doing from this durable summary; the stream is only needed for detail.
   const digest=digestRunEvents(events);if(digest.eventCount)state.activity=accumulateRunActivity(state.activity,digest);
   const result=hostResult(events,state.phase==='reviewing'?'record_review':'publish_work',owner,state.phase==='reviewing'?undefined:state.operationId);
   if(result&&state.phase==='reviewing'){
    const observed=review.parse(result);await checkCurrent(state.publication!,state.request.repository);const gate=state.gate??gateStations[0]!;applyReview(state,{...observed,gate});
    // v1: every class of change is merged by a person. The decision is recorded with its reason and shown in the cockpit; `ready` stays terminal.
    if(['ready','human_review'].includes(state.phase)){state.mergeReview={...observed,gate};state.reviewerSessionId=owner;state.mergeDecision=mergeEligibility({files:[],review:observed,headSha:state.publication!.headSha,baseSha:state.publication!.targetHeadSha,targetBranch:state.publication!.targetBranch,workerSessionId:state.publication!.ownerSessionId,reviewerSessionId:owner});}
   }else if(result){
    const p=publication.parse(result.publication);if(result.revisionProtocol!==1||p.branch!==workBranch(owner)||p.ownerSessionId!==owner)throw new Error('Publication owner does not match the executing migrator');
    if(p.repository&&p.repository!==state.request.repository)throw new Error('Publication landed in a different repository than the delivery target');
    state.publication=p;state.changeId??=state.id;await checkCurrent(p,state.request.repository);state.gate=gateStations[0];state.operationId=operationFor(state.id,state.gate,state.cycle);transition(state,'review_starting',{operationId:state.operationId,reason:`The migrator publication ${p.headSha} is recorded; ${state.gate} is next.`});
   }else if(state.childSessionId&&pendingSessionLimit(events)&&stoppedWithoutResult(events)==='turn.completed'){
    const limit=pendingSessionLimit(events)!;const station=state.phase==='reviewing'?(state.gate??'quality-gate'):'migrator';
    askBudgetApproval(state,{requestId:limit.requestId,sessionId:owner,operationId:state.operationId,usedTokens:limit.usedTokens,limit:limit.limit,station});
   }else if(state.childSessionId&&stoppedWithoutResult(events)){
    const gate=state.phase==='reviewing'?(state.gate??gateStations[0]!):undefined;
    if(gate&&retryGate(state,gate,describeStopWithoutResult(gate,'record_review',stoppedWithoutResult(events)!,state.activity))){
     // A gate that never reached record_review has no verdict to honour; it is restarted, never replaced by model text.
    }else{
     const terminalType=stoppedWithoutResult(events)!;const stopStation=state.phase==='reviewing'?(state.gate??'quality-gate'):'migrator';state.failedPhase=state.phase;state.error=describeStopWithoutResult(stopStation,state.phase==='reviewing'?'record_review':'publish_work',terminalType,state.activity);transition(state,'human_review',{reason:state.error});
    }
   }
  }
 }catch(error){
  failure=classifyDeliveryError(error);
  state.failure=failure;
  state.error=failure.message;
  if(failure.kind==='observation'){
   state.failedPhase=startedPhase;
   transition(state,'blocked',{actor:'workflow',reason:`Recoverable observation failure in ${startedPhase}: ${failure.message}`});
  }else if(failure.code==='target_closed'){
   state.failedPhase=startedPhase;
   transition(state,'human_review',{actor:'provider',reason:`Target requires a human decision: ${failure.message}`});
  }else if(failure.code==='needs_revision'||failure.code==='stale_head'||failure.code==='target_advanced'){
   transition(state,'needs_revision',{actor:'provider',reason:failure.message});
  }
 }
 const committed=await updateDelivery(id,current=>{if(!current)throw new Error('Delivery missing');const next=commitAdvance(current,state,claimedVersion);return{state:next,result:next};});
 if(committed.phase==='cancelled'&&state.sessionId)await (await factorySession(state.sessionId,ctx.attachSession)).cancel({tasks:true});
 if(failure)return classifiedResponse(failure,committed);
 return Response.json(committed);
}
export default defineChannel({routes:[
 POST('/factory/delivery',protectedRoute(async(request)=>{
  const auth=await routeAuth(request,factoryAuth);if(auth instanceof Response)return auth;
  const input=deliveryRequest.parse(await request.json());
  if(!input.draftId)throw new WorkError('invalid_request','Start delivery from a persisted cockpit brief admitted as a work order.');
  const draft=(await readCockpit()).document.drafts[input.draftId];
  const admission=workOrderAdmissionSchema.safeParse(draft?.value.admission);
  if(!draft||!admission.success||admission.data.kind!=='work_order')throw new WorkError('invalid_request','Only a cockpit brief admitted as a work order can start delivery.');
  if(draft.value.title!==input.title||draft.value.request!==input.brief)throw new WorkError('invalid_request','Delivery content must match the admitted draft.');
  const fresh=newDelivery(auth.principalId,input);fresh.admission=admission.data;
  // Cedar guards admission: only a host-attached work_order admission may start the migrator.
  await runFactoryOperation({operationId:`${fresh.id}:start_task`,principal:factoryWorkflowPrincipal(),action:'start_task',input:{deliveryId:fresh.id,operationId:input.operationId,title:input.title},resource:repositoryResource(),context:{expectedRevision:fresh.id.slice(0,40),candidateSha:fresh.id.slice(0,40),baseSha:fresh.id.slice(0,40),verifiedSha:fresh.id.slice(0,40),branch:'main',lane:'audit',budget:0,riskClass:'low',admission:{kind:admission.data.kind,id:fresh.id}},execute:async()=>true});
  let state=await updateDelivery(fresh.id,current=>{if(current&&JSON.stringify(current.request)!==JSON.stringify(input))throw new Error('Operation ID reused with a different task');if(current)retryAdmission(current);return{state:current||fresh,result:current||fresh};});await updateCockpit(doc=>doc.runs[state.id]||changeRecord(doc,'runs',state.id,{label:state.request.title,station:'loop',operationId:state.request.operationId},0));
  // Generate the target for this prototype (repository from the template, git-linked Vercel project,
  // production deploy of main) before any station runs. Failure is an admission failure: the
  // delivery is blocked with the reason and the same POST retries the bootstrap.
  try{
   if(!state.bootstrap||state.bootstrap.repository!==input.repository){
    const bootstrap=await bootstrapTarget({repository:input.repository,prototype:input.prototype});
    state=await updateDelivery(state.id,current=>{if(!current)throw new Error('Delivery disappeared during bootstrap.');current.bootstrap=bootstrap;current.version++;return{state:current,result:current};});
   }
   await ensureDeliveryDriver(state.id,request);
  }catch(error){
   try{const blocked=await updateDelivery(state.id,current=>{if(!current)throw new Error('Delivery disappeared during outer workflow admission.');if(current.phase==='worker_starting')recordAdmissionFailure(current,error);return{state:current,result:current};});return admissionFailureResponse(blocked);}catch{ return Response.json({deliveryId:state.id,phase:state.phase,state:state.state,error:'Outer workflow admission failed and recovery could not be confirmed. Retry the original POST with the same operationId, then inspect this delivery ID.',recovery:admissionRecoveryAction(state.id,input)},{status:503});}
  }
  return Response.json(await existing(state.id),{status:202});
 })),
 GET('/factory/delivery/:id',protectedRoute(async(_,ctx)=>{
  // Terminal deliveries no longer advance, so attach a late-arriving preview here, at most once a minute.
  const current=await existing(ctx.params.id);const p=current.publication;
  if(p&&p.preview?.state!=='success'&&(!p.preview||Date.now()-Date.parse(p.preview.checkedAt)>60_000)){
   const before=JSON.stringify(p.preview);await refreshPreview(current);
   if(JSON.stringify(current.publication?.preview)!==before)await updateDelivery(current.id,saved=>{if(!saved)throw new Error('Delivery not found');if(saved.publication&&saved.publication.headSha===current.publication?.headSha)saved.publication={...saved.publication,preview:current.publication!.preview};return{state:saved,result:saved};});
  }
  return Response.json(await existing(ctx.params.id));
 })),
 GET('/factory/delivery/:id/reconcile',protectedRoute(async(_,ctx)=>{
  const state=await existing(ctx.params.id);
  const repository=state.request.repository;
  if(!state.publication)return Response.json({deliveryId:state.id,...reconcileManuallyMergedDelivery(state,undefined,repository)});
  const token=await getToken(githubConnectorName,{subject:{type:'app'}});
  const pull=await readPull(token,state.publication.number,undefined,repository);
  return Response.json({deliveryId:state.id,...reconcileManuallyMergedDelivery(state,{repository,number:pull.number,merged:pull.merged===true,state:pull.state,headSha:pull.head.sha,targetHeadSha:pull.base.sha,targetBranch:pull.base.ref,mergeCommitSha:pull.merge_commit_sha??undefined},repository)});
 })),
 GET('/factory/delivery/:id/receipts',protectedRoute(async(_,ctx)=>{await existing(ctx.params.id);return Response.json(await listDeliveryReceipts(ctx.params.id));})),
 POST('/factory/delivery/:id/advance',protectedRoute(advance)),
 POST('/factory/delivery/:id/answer',protectedRoute(async(request,ctx)=>{
  const auth=await routeAuth(request,factoryAuth);if(auth instanceof Response)return auth;
  const input=z.object({operationId:z.string().min(1).max(240),answer:z.string().trim().min(1).max(10000)}).strict().parse(await request.json());
  const state=await updateDelivery(ctx.params.id,current=>{if(!current)throw new Error('Delivery not found');if(current.principalId!==auth.principalId)throw Object.assign(new WorkError('forbidden','Only the delivery owner can answer its migrator question.'),{status:403});try{answerOwnerQuestion(current,input.operationId,input.answer,auth.principalId);}catch(error){throw new WorkError('invalid_request',error instanceof Error?error.message:'Invalid owner answer.');}return{state:current,result:current};});
  await ensureDeliveryDriver(state.id,request);
  return Response.json(await existing(state.id),{status:202});
 })),
 // A person approves the published head; the host merges the factory's pull request into main.
 // Cedar merge_change is evaluated with the human approval and the gates' evidence in context: when both
 // gates approved this exact head the evidence is complete; otherwise the person is overriding open
 // findings and the receipt says so (evidence.complete false, reason recorded).
 POST('/factory/delivery/:id/merge',protectedRoute(async(request,ctx)=>{
  const auth=await routeAuth(request,factoryAuth);if(auth instanceof Response)return auth;
  const input=z.object({operationId:z.string().uuid().optional(),reason:z.string().trim().min(3).max(1000)}).strict().parse(await request.json());
  const state=await existing(ctx.params.id);
  if(state.phase==='merged')return Response.json(state);
  const headSha=approvableHead(state);const p=state.publication;
  if(!headSha||!p)throw new WorkError('invalid_request','Merge needs a published pull request waiting for a human decision.');
  const gatesApproved=mergeableHead(state)===headSha;
  const repository=state.request.repository;const title=`${state.request.title} (#${p.number})`;
  const claimed=await updateDelivery(state.id,current=>{if(!current)throw new Error('Delivery not found');if(current.phase==='merging'||current.phase==='merged')return{state:current,result:null};if(approvableHead(current)!==headSha)throw new WorkError('invalid_request','The published head changed; refresh and approve again.');transition(current,'merging',{actor:'operator',reason:`${auth.principalId} approved head ${headSha}${gatesApproved?'':' over open gate findings'}: ${input.reason}`});return{state:current,result:current};});
  if(!claimed)return Response.json(await existing(state.id),{status:409});
  try{
   const token=await getToken(githubConnectorName,{subject:{type:'app'}});
   const merged=await runFactoryOperation({operationId:input.operationId?`${state.id}:merge:${input.operationId}`:`${state.id}:merge:${headSha}`,principal:factoryDeliveryDriverPrincipal(),action:'merge_change',input:{pullRequest:String(p.number),targetBranch:p.targetBranch},resource:changeResource({id:String(p.number),taskId:state.id,candidateSha:headSha,baseSha:p.targetHeadSha,branch:p.targetBranch,expectedRevision:p.targetHeadSha}),context:{expectedRevision:p.targetHeadSha,candidateSha:headSha,baseSha:p.targetHeadSha,verifiedSha:headSha,reviewedSha:headSha,branch:p.targetBranch,lane:'merge',budget:0,riskClass:'low',evidence:{id:`merge:${state.id}:${headSha}`,source:gatesApproved?'factory.merge-policy':'factory.human-approval',complete:true,candidateSha:headSha},approval:{id:`approval:${state.id}:${headSha}`,actor:auth.principalId,human:auth.principalType==='user'}},execute:()=>mergePull(token,p.number,headSha,title,undefined,repository)});
   try{await deleteBranch(token,p.branch,undefined,repository);}catch{/* the merged branch is informational; GitHub may already have deleted it */}
   const done=await updateDelivery(state.id,current=>{if(!current)throw new Error('Delivery not found');current.merge={approvedBy:auth.principalId,reason:input.reason,commitSha:merged.output.commitSha,headSha,targetBranch:p.targetBranch,mergedAt:new Date().toISOString()};current.mergeDecision={status:'merged',reason:`Merged into ${p.targetBranch} as ${merged.output.commitSha} after ${auth.principalId} approved head ${headSha}${gatesApproved?' (both gates approved)':' over open gate findings'}.`,commitSha:merged.output.commitSha,authorization:merged.audit};transition(current,'merged',{actor:'operator',reason:current.mergeDecision.reason});return{state:current,result:current};});
   return Response.json(done);
  }catch(error){
   const failure=classifyDeliveryError(error);
   const back=await updateDelivery(state.id,current=>{if(!current)throw new Error('Delivery not found');if(current.phase==='merging'){current.error=`Merge did not happen: ${failure.message}`;transition(current,'human_review',{actor:'operator',reason:current.error});}return{state:current,result:current};});
   return classifiedResponse(failure,back);
  }
 })),
 POST('/factory/delivery/:id/cancel',protectedRoute(async(request,ctx)=>{
  const state=await updateDelivery(ctx.params.id,current=>{if(!current)throw new Error('Delivery not found');transition(current,'cancelled',{actor:'operator',reason:'Operator cancelled the delivery.'});return{state:current,result:current};});
  const cancellations=await Promise.allSettled([cancelDeliveryDriver(state.id,request),...Array.from(new Set([state.sessionId,state.childSessionId].filter((id):id is string=>!!id))).map(async id=>(await factorySession(id,ctx.attachSession)).cancel({tasks:true}))]);
  if(cancellations.some(result=>result.status==='rejected'))throw new Error('Cancellation was recorded; retry to confirm all sessions and the outer driver have stopped.');return Response.json(state);
 })),
 POST('/factory/delivery/:id/resume',protectedRoute(async(request,ctx)=>{
  const input=z.object({operationId:z.string().uuid().optional()}).strict().parse(await request.json().catch(()=>({})));
  const state=await updateDelivery(ctx.params.id,current=>{if(!current)throw new Error('Delivery missing');if(terminal(current.phase))requestResume(current,input.operationId);return{state:current,result:current};});await ensureDeliveryDriver(state.id,request);return Response.json(await existing(state.id),{status:202});
 })),
 POST('/factory/delivery/:id/revise',protectedRoute(async(request,ctx)=>{
  const input=z.object({operationId:z.string().uuid(),brief:z.string().trim().min(20).max(18000)}).strict().parse(await request.json());
  const state=await updateDelivery(ctx.params.id,current=>{if(!current)throw new Error('Delivery not found');
   if(current.revisionRequests?.[input.operationId]){if(current.revisionRequests[input.operationId]!==input.brief)throw new Error('Revision ID reused with different instructions');return{state:current,result:current};}
   if(!['human_review','ready','blocked','needs_revision'].includes(current.phase)||!current.publication)throw new Error('Wait for a published candidate before requesting a revision');
   current.revisionRequests={...current.revisionRequests,[input.operationId]:input.brief};beginRevision(current,input.operationId,input.brief,{actor:'operator',reason:'Operator requested a new same-owner revision attempt.'});return{state:current,result:current};});await ensureDeliveryDriver(state.id,request);return Response.json(await existing(state.id),{status:202});
 }))
]});
