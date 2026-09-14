import type { CheckAttribution } from "./work-state.ts";
const infrastructurePattern=/E(?:AI_AGAIN|NOTFOUND|CONNRESET|TIMEDOUT)|ERR_PNPM_(?:FETCH|META_FETCH|NO_OFFLINE)|Killed|out of memory|browser.*(?:not found|failed to launch)/i;
// Failures are attributed by the host from two runs, never from model text:
// head fails and base passes the same check -> candidate; both fail -> baseline;
// exit >= 126, a signal or a network/install error -> infrastructure.
export function attributeFailure(_check:string,head:{exitCode:number;stdout:string;stderr:string},base?:{exitCode:number;stdout:string;stderr:string}):CheckAttribution["attribution"]{
 if(head.exitCode===0)return "passed";
 const text=`${head.stdout}\n${head.stderr}`;
 if(head.exitCode>=126||head.exitCode<0||infrastructurePattern.test(text))return "infrastructure";
 if(base&&base.exitCode!==0)return "baseline";
 return "candidate";
}
