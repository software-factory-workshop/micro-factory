import type { FactoryDecisionAudit } from './cedar/operation-runner.ts';

export interface MergeFile { filename:string;previous_filename?:string;status:string;patch?:string }
export interface MergeReview {
 gate?:string;
 headSha:string;baseSha:string;targetBranch:string;verdict:string;
 findings:Array<{severity:string}>;limitations:string[];
 verification?:{prepared:boolean;repositoryChecksPassed:boolean;candidateUnchanged:boolean};
}
export type MergeDecision={status:'merged'|'manual'|'waiting';reason:string;commitSha?:string;authorization?:FactoryDecisionAudit};

// v1 invariant: no class of change is merged by the factory. The function is
// kept so that every `manual` decision carries a reason a person can read in
// the cockpit, and so the loop's shape matches the Jira factory it copies.
export function lowRiskFiles(_files:MergeFile[]):boolean{ return false; }

export function mergeEligibility(input:{files:MergeFile[];review:MergeReview;headSha:string;baseSha:string;targetBranch:string;workerSessionId:string;reviewerSessionId:string}):MergeDecision{
 const r=input.review;
 if(!input.reviewerSessionId||input.workerSessionId===input.reviewerSessionId)return{status:'manual',reason:'An independent gate is required.'};
 if(r.headSha!==input.headSha||r.baseSha!==input.baseSha||r.targetBranch!==input.targetBranch)return{status:'manual',reason:'Review does not match the candidate and current target.'};
 if(!r.verification?.prepared||!r.verification.repositoryChecksPassed||!r.verification.candidateUnchanged)return{status:'manual',reason:'Independent verification is missing or candidate changed after verification.'};
 if(r.findings.some(f=>f.severity==='blocking')||r.verdict!=='approve')return{status:'manual',reason:'The gates did not approve the candidate.'};
 if(r.limitations.length)return{status:'manual',reason:'Review evidence carries limitations.'};
 return{status:'manual',reason:`Verdict applies to head ${input.headSha}; no merge was performed. Merge is manual in v1 for every change class.`};
}
