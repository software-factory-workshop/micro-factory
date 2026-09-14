import { stationAddress } from "../runtime/lib/station-access.ts";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReview,newDelivery,operationFor,deliveryRequest,referenceState,claimAdvance,commitAdvance,transition,requestResume,resetObservation,askBudgetApproval,answerOwnerQuestion,BUDGET_APPROVE,BUDGET_STOP,retryGate,MAX_GATE_RETRIES } from '../runtime/lib/delivery-state.ts';
import { classifyDeliveryError,hostResult,eventsForDelivery,snapshotEvents,resumeMessage,resumeReceipt,pendingSessionLimit,stoppedWithoutResult } from '../runtime/lib/delivery-events.ts';
import { allowedWorkPath } from '../runtime/lib/work-github.ts';
import { verificationCommands } from '../runtime/lib/factory-config.ts';
const task=deliveryRequest.parse({operationId:'11111111-1111-4111-8111-111111111111',title:'Jira state',brief:'Create a useful stateful issue list'});
function state(){const s=newDelivery('tester',task);s.publication={number:1,url:'https://github.com/example/pull/1',headSha:'a'.repeat(40),targetHeadSha:'b'.repeat(40),targetBranch:'main',ownerSessionId:'wrun_owner',branch:'factory/owner'};return s;}
const review={verdict:'approve',summary:'reviewed',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),targetBranch:'main',findings:[],limitations:[]};
test('stable task IDs and phase operation IDs survive retries',()=>{assert.equal(state().id,state().id);assert.equal(operationFor(state().id,'review',1),operationFor(state().id,'review',1));assert.notEqual(operationFor(state().id,'review',1),operationFor(state().id,'review',2));});
test('review cannot advance a different head or target',()=>{for(const delta of [{headSha:'c'.repeat(40)},{baseSha:'c'.repeat(40)},{targetBranch:'other'}])assert.throws(()=>applyReview(state(),{...review,...delta}),/not bound/);});
test('missing host evidence stops for human review',()=>{const s=state();applyReview(s,{...review,verdict:'incomplete',limitations:['Required host evidence missing: the end-to-end suite did not pass on the candidate head.']});assert.equal(s.phase,'human_review');});
test('the quality gate approving hands the same head to the security gate, and both approving is ready',()=>{const s=state();applyReview(s,{...review,gate:'quality-gate'});assert.equal(s.phase,'review_starting');assert.equal(s.gate,'security-gate');assert.equal(s.reviews?.['quality-gate']?.verdict,'approve');transition(s,'reviewing');applyReview(s,{...review,gate:'security-gate'});assert.equal(s.phase,'ready');assert.match(s.history.at(-1)?.reason||'',/no merge was performed/);});
test('the allowlist admits only target application paths and required checks are fixed',()=>{for(const path of ['app/pages/index.vue','server/utils/data.ts','tests/data.test.ts','e2e/todos.spec.ts','shared/types.ts','app.config.ts'])assert.equal(allowedWorkPath(path),true,path);for(const path of ['package.json','pnpm-lock.yaml','nuxt.config.ts','.github/workflows/check.yml','factory/policies/cedar/x.cedar','apps/factory/runtime/lib/a.ts','server/../escape.ts','app/.env','app/vite.config.ts','tests/tsconfig.json','playwright.config.ts'])assert.equal(allowedWorkPath(path),false,path);assert.deepEqual([...verificationCommands],['pnpm typecheck','pnpm test','pnpm test:e2e','pnpm build']);});
test('blocking findings queue same-owner revision with stable operation, never a new worker',()=>{const s=state();applyReview(s,{...review,verdict:'changes_requested',findings:[{severity:'blocking',path:'app/pages/index.vue',message:'Save fails',evidence:'reproduced'}]});assert.equal(s.phase,'revision_starting');assert.equal(s.publication?.ownerSessionId,'wrun_owner');assert.equal(s.cycle,1);});
test('model text and historical operation results cannot advance loop',()=>{assert.equal(hostResult([{type:'message.completed',data:{publication:{}}}],'publish_work','wrun_owner'),undefined);const e={type:'action.result',data:{status:'completed',result:{kind:'tool-result',toolName:'publish_work',output:{sessionId:'wrun_owner',operationId:'old'}}}};assert.equal(hostResult([e],'publish_work','wrun_owner','new'),undefined);assert.equal(hostResult([e],'publish_work','other'),undefined);assert.ok(hostResult([e],'publish_work','wrun_owner','old'));});
test('revision events use live Eve meta.deliveryIds and exclude the previous turn',()=>{const current={type:'turn.started',meta:{deliveryIds:['delivery-current']},data:{}};assert.deepEqual(eventsForDelivery([{type:'turn.completed',meta:{deliveryIds:['delivery-old']}},current],'delivery-current'),[current]);assert.deepEqual(eventsForDelivery([{type:'turn.started',deliveryIds:['delivery-current']}],'delivery-current'),[]);});
test('observations read only the uncaptured suffix and retain the Eve event cursor',async()=>{
 const events=[
  {type:'turn.started',meta:{at:'2026-09-14T10:00:00.000Z'},data:{}},
  {type:'step.started',meta:{at:'2026-09-14T10:00:01.000Z'},data:{modelId:'meta/example'}},
  {type:'turn.completed',meta:{at:'2026-09-14T10:00:02.000Z'},data:{}},
 ];
 const starts:number[]=[];
 const snapshot=await snapshotEvents({
  getStreamTailIndex:async()=>events.length-1,
  getEventStream:async({startIndex})=>{starts.push(startIndex);return new ReadableStream({start(controller){for(const event of events.slice(startIndex))controller.enqueue(event);controller.close();}});},
 },{startIndex:2});
 assert.deepEqual(starts,[2]);
 assert.deepEqual(snapshot,[events[2]]);
 assert.deepEqual(snapshot.observation,{lastEventIndex:2,lastEventAt:'2026-09-14T10:00:02.000Z'});
});
test('stale refs demand an explicit owner revision instead of a retry loop',()=>{const p=state().publication!;assert.equal(referenceState(p,{state:'open',headSha:p.headSha,targetBranch:p.targetBranch,targetHeadSha:'c'.repeat(40)}),'needs_revision');assert.equal(referenceState(p,{state:'closed',headSha:p.headSha,targetBranch:p.targetBranch,targetHeadSha:p.targetHeadSha}),'blocked');});
test('partial stream observations are typed and cannot produce trusted terminal evidence',async()=>{
 let error: unknown;
 await assert.rejects(snapshotEvents({getStreamTailIndex:async()=>2,getEventStream:async()=>new ReadableStream({start(c){c.enqueue({type:'turn.completed'});c.close();}})} as never),caught=>{error=caught;return true;});
 assert.equal(classifyDeliveryError(error).code,'observation_partial');
 assert.equal(classifyDeliveryError(error).retryable,true);
});

test('idle observation timeout is recoverable without accepting the partial prefix',async()=>{
 let error: unknown;
 await assert.rejects(snapshotEvents({getStreamTailIndex:async()=>1,getEventStream:async()=>new ReadableStream({start(c){c.enqueue({type:'turn.started'});}})} as never,{idleTimeoutMs:5}),caught=>{error=caught;return true;});
 const failure=classifyDeliveryError(error);
 assert.deepEqual({code:failure.code,kind:failure.kind,status:failure.status,retryable:failure.retryable,preservePhase:failure.preservePhase},{code:'observation_timeout',kind:'observation',status:503,retryable:true,preservePhase:true});
});

test('event limits stay typed and provider failures stay outside observation recovery',async()=>{
 let limitError: unknown;
 await assert.rejects(snapshotEvents({getStreamTailIndex:async()=>2,getEventStream:async()=>new ReadableStream()} as never,{maxEvents:2}),caught=>{limitError=caught;return true;});
 assert.equal(classifyDeliveryError(limitError).code,'observation_limit');

 let providerError: unknown;
 await assert.rejects(snapshotEvents({getStreamTailIndex:async()=>0,getEventStream:async()=>{throw Object.assign(new Error('Eve gateway unavailable'),{status:503});}} as never),caught=>{providerError=caught;return true;});
 assert.deepEqual([classifyDeliveryError(providerError).code,classifyDeliveryError(providerError).kind,classifyDeliveryError(providerError).status],['provider_unavailable','provider',502]);
});

test('provider, auth, input and closed-target errors have distinct contracts',()=>{
 const provider=classifyDeliveryError(Object.assign(new Error('Eve service unavailable'),{code:'provider_unavailable'}));
 const auth=classifyDeliveryError(Object.assign(new Error('Eve rejected the credentials'),{status:401}));
 const input=classifyDeliveryError(Object.assign(new Error('Malformed delivery request'),{code:'invalid_request'}));
 const target=classifyDeliveryError(Object.assign(new Error('PR was closed or retargeted'),{code:'target_closed'}));
 assert.deepEqual([provider.code,provider.kind,provider.status,provider.retryable],[ 'provider_unavailable','provider',502,true ]);
 assert.deepEqual([auth.code,auth.kind,auth.status,auth.retryable],[ 'provider_auth','auth',401,false ]);
 assert.deepEqual([input.code,input.kind,input.status,input.retryable],[ 'invalid_request','input',400,false ]);
 assert.deepEqual([target.code,target.kind,target.status,target.retryable],[ 'target_closed','target',409,false ]);
});

test('recoverable observation failure resumes the exact failed phase',()=>{
 const s=state();
 transition(s,'working');
 s.failedPhase='working';
 transition(s,'blocked');
 requestResume(s,'resume-observation');
 assert.equal(s.phase,'working');
 assert.equal(s.attempt,1);
});

test('lost revision receipt recovers trusted cached prepare_work publication',()=>{const result={sessionId:'wrun_owner',operationId:'same',revisionProtocol:1,publication:{headSha:'a'.repeat(40)}};const event={type:'action.result',meta:{deliveryIds:['retry']},data:{status:'completed',result:{kind:'tool-result',toolName:'prepare_work',output:{phase:'Already published',result}}}};assert.deepEqual(hostResult(eventsForDelivery([event],'retry'),'publish_work','wrun_owner','same'),result);assert.equal(hostResult([event],'publish_work','wrun_owner','different'),undefined);});

test('concurrent advance claims are fenced, including expired claims',()=>{const current=state();const first=claimAdvance(current,100)!;assert.equal(claimAdvance(current,101),null);const replacement=claimAdvance(current,60101)!;assert.notEqual(first.version,replacement.version);first.phase='ready';assert.equal(commitAdvance(current,first,first.version).phase,'worker_starting');});
test('cancelled intent wins over a late launch receipt',()=>{const current=state();const claim=claimAdvance(current,100)!;const version=claim.version;transition(current,'cancelled');claim.sessionId='wrun_late';transition(claim,'working');assert.equal(commitAdvance(current,claim,version).phase,'cancelled');});
test('machine-to-Passport resume keeps the same loop continuation',()=>{assert.equal(stationAddress('machine','worker','op','loop-id'),stationAddress('passport','worker','op','loop-id'));assert.notEqual(stationAddress('machine','worker','op'),stationAddress('passport','worker','op'));});

test('prepublication recovery queues only the existing owner and retains publication operation',()=>{const s=state();delete s.publication;s.childSessionId='wrun_existing';transition(s,'human_review');const original=s.operationId;requestResume(s,'resume-id');assert.equal(s.phase,'owner_resuming');assert.equal(s.operationId,original);assert.equal(s.childSessionId,'wrun_existing');const version=s.version;requestResume(s,'resume-id');assert.equal(s.version,version);});
test('stopped review and published worker cannot be mistaken for unpublished recovery',()=>{const s=state();s.childSessionId='wrun_reviewer';transition(s,'human_review');assert.throws(()=>requestResume(s,'resume-id'),/requires review/);});

test('lost continuation receipt is recovered from original owner event without another send',()=>{const event={type:'message.received',data:{message:resumeMessage('resume-one')},meta:{deliveryIds:['accepted-receipt']}};assert.equal(resumeReceipt([event],'resume-one'),'accepted-receipt');assert.equal(resumeReceipt([event],'different'),undefined);assert.equal(resumeReceipt([{...event,type:'message.completed'}],'resume-one'),undefined);});

test('a new station session starts observing its own stream from the beginning',()=>{const s=state();s.observation={lastEventIndex:351,lastEventAt:'2026-09-14T14:35:25.843Z'};resetObservation(s,'2026-09-14T14:35:47.000Z');assert.deepEqual(s.observation,{lastEventIndex:-1,lastEventAt:'2026-09-14T14:35:47.000Z'});});
test('a cursor beyond the observed stream tail is recognisable as a foreign cursor',async()=>{const snapshot=await snapshotEvents({getStreamTailIndex:async()=>186,getEventStream:async()=>new ReadableStream()},{startIndex:352});assert.equal(snapshot.length,0);assert.ok(snapshot.observation.lastEventIndex<351);});

test('a session-limit pause becomes an owner question with two fixed options, answered as a budget decision',()=>{
 const events=[{type:'turn.started',data:{}},{type:'input.requested',data:{requests:[{kind:'session-limit',requestId:'wrun_x:limit:input:2011137',action:{input:{kind:'input',limit:2000000,usedTokens:2011137}}}]}},{type:'turn.completed',data:{}},{type:'session.waiting',data:{}}];
 const limit=pendingSessionLimit(events);assert.deepEqual(limit,{requestId:'wrun_x:limit:input:2011137',kind:'input',usedTokens:2011137,limit:2000000});assert.equal(stoppedWithoutResult(events),'turn.completed');
 assert.equal(pendingSessionLimit([...events,{type:'turn.started',data:{}}]),undefined);
 const s=state();delete s.publication;s.childSessionId='wrun_x';transition(s,'working');
 const q=askBudgetApproval(s,{requestId:limit!.requestId,sessionId:'wrun_x',operationId:s.operationId,usedTokens:limit!.usedTokens,limit:limit!.limit,station:'migrator'});
 assert.equal(s.phase,'awaiting_input');assert.deepEqual(q.options,[BUDGET_APPROVE,BUDGET_STOP]);assert.match(q.question,/2,011,137 of 2,000,000/);assert.equal(s.budgetRequest?.requestId,limit!.requestId);
 assert.equal(askBudgetApproval(s,{requestId:limit!.requestId,sessionId:'wrun_x',operationId:s.operationId,station:'migrator'}),q);
 answerOwnerQuestion(s,s.operationId,BUDGET_APPROVE,'owner');assert.equal(s.phase,'owner_resuming');assert.ok(s.budgetRequest);
 transition(s,'working');assert.equal(s.phase,'working');
});
test('a gate at its guardrail can also wait for the owner and resume reviewing',()=>{const s=state();s.childSessionId='wrun_gate';transition(s,'review_starting');transition(s,'reviewing');askBudgetApproval(s,{requestId:'r',sessionId:'wrun_gate',operationId:s.operationId,station:'quality-gate'});assert.equal(s.phase,'awaiting_input');answerOwnerQuestion(s,s.operationId,BUDGET_APPROVE,'owner');transition(s,'reviewing');assert.equal(s.phase,'reviewing');});

test('a gate that stops before recording a review is restarted a bounded number of times, never replaced by text',()=>{
 const s=state();transition(s,'working');transition(s,'review_starting');transition(s,'reviewing');s.gate='quality-gate';s.childSessionId='wrun_gate1';const first=s.operationId;
 assert.equal(retryGate(s,'quality-gate','The quality-gate session stopped before recording a review.'),true);
 assert.equal(s.phase,'review_starting');assert.notEqual(s.operationId,first);assert.equal(s.childSessionId,undefined);assert.equal(s.gateRetries?.['quality-gate'],1);
 assert.match(s.history.at(-1)!.reason??'',/retry 1 of 2/);
 transition(s,'reviewing');const second=s.operationId;assert.equal(retryGate(s,'quality-gate','stopped again'),true);assert.notEqual(s.operationId,second);
 transition(s,'reviewing');assert.equal(retryGate(s,'quality-gate','stopped a third time'),false);assert.equal(s.phase,'reviewing');assert.equal(MAX_GATE_RETRIES,2);
 assert.equal(operationFor(s.id,'quality-gate:retry-1',s.cycle),operationFor(s.id,'quality-gate:retry-1',s.cycle));
});
