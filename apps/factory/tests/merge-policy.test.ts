import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lowRiskFiles,mergeEligibility,type MergeReview} from '../runtime/lib/merge-policy.ts';
const css={filename:'app/assets/colors.css',status:'modified',patch:'@@ -1,3 +1,3 @@\n .card {\n-color: red;\n+color: blue;\n }'};
const review:MergeReview={headSha:'a'.repeat(40),baseSha:'b'.repeat(40),targetBranch:'main',verdict:'approve',findings:[],limitations:[],verification:{prepared:true,repositoryChecksPassed:true,candidateUnchanged:true}};
const input={files:[css],review,headSha:review.headSha,baseSha:review.baseSha,targetBranch:'main',workerSessionId:'migrator',reviewerSessionId:'gate'};
test('no change class is low risk in v1, including a one-line cosmetic CSS edit',()=>{
 assert.equal(lowRiskFiles([css]),false);
 assert.equal(lowRiskFiles([{...css,filename:'app/pages/index.vue'}]),false);
});
test('a fully approved candidate is still manual and the reason names the head and the v1 rule',()=>{
 const decision=mergeEligibility(input);
 assert.equal(decision.status,'manual');
 assert.match(decision.reason,new RegExp(`Verdict applies to head ${review.headSha}; no merge was performed`));
 assert.match(decision.reason,/manual in v1/);
});
test('every manual decision carries a specific reason',()=>{
 for(const [change,pattern] of [
  [{reviewerSessionId:'migrator'},/independent gate/],
  [{review:{...review,headSha:'c'.repeat(40)}},/does not match/],
  [{review:{...review,verification:undefined}},/verification is missing/],
  [{review:{...review,findings:[{severity:'blocking'}]}},/did not approve/],
  [{review:{...review,limitations:['e2e missing']}},/limitations/],
 ] as const){
  const decision=mergeEligibility({...input,...change});
  assert.equal(decision.status,'manual');
  assert.match(decision.reason,pattern);
 }
});
