import { defineState } from "eve/context";
import type { WorkPublication } from "./work-github";
import type { CommandEvidence } from "./command-evidence";
import type { GateStation } from "./station-access";
export interface VerificationFinding { severity: "blocking" | "nonblocking"; path: string; line?: number; message: string; evidence: string }
export interface CheckAttribution { command: string; exitCode: number; attribution: "passed" | "candidate" | "baseline" | "infrastructure" }
export interface WorkState {
 sandboxStarted:boolean; prepared:boolean; revision:string; prototypeRevision:string;
 baseline:Array<{file:string;sha256:string}>; commands:CommandEvidence[];
 pull:null|{number:number;url:string;title:string;body:string;baseSha:string;headSha:string;targetBranch?:string;files:Array<{filename:string;previous_filename?:string;status:string;patch?:string}>};
 publication:null|WorkPublication;
 operationId:string; activeBrief:string; targetBranch:string; targetHeadSha:string; parentPrNumber?:number; mergeTarget:boolean;
 completedOperations:Record<string,unknown>; basePrepared:boolean; verificationFindings:VerificationFinding[];
 contextGaps:string[]; recorded:boolean; verifiedDigest:string|null; reviewVerified:boolean;
 gate:GateStation|null; attributions:CheckAttribution[]; baseTestCount?:number; candidateTestCount?:number; e2eRanOnHead:boolean; secretScanClean:boolean|null;
}
export const workState=defineState<WorkState>("factory.work",()=>({sandboxStarted:false,prepared:false,revision:"",prototypeRevision:"",baseline:[],commands:[],pull:null,publication:null,operationId:"",activeBrief:"",targetBranch:"main",targetHeadSha:"",mergeTarget:false,completedOperations:{},basePrepared:false,verificationFindings:[],contextGaps:[],recorded:false,verifiedDigest:null,reviewVerified:false,gate:null,attributions:[],e2eRanOnHead:false,secretScanClean:null}));
