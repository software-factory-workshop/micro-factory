import { z } from "zod";
import { WorkError,workBranch } from "./work-github.ts";
import { parseSuccessfulActionResultEvent } from "./factory-protocol.ts";
const publication=z.object({branch:z.string(),number:z.number(),headSha:z.string(),ownerSessionId:z.string(),targetBranch:z.string(),targetHeadSha:z.string()});
export function ownerFromBody(body:string) {
 const id=body.match(/(?:Factory-Owner: |Native Eve session: )(wrun_[A-Za-z0-9]+)/)?.[1];
 if(!id)throw new WorkError("ownership_unverified","No factory owner is recorded. Contribute through a new child PR instead.");
 return id;
}
// Only host-emitted successful tool results count. Text, user messages and PR body do not grant ownership.
export function ownerPublication(event:unknown,ownerId:string,number:number,branch:string) {
 const parsed=parseSuccessfulActionResultEvent(event);
 if(!parsed||parsed.data.result.toolName!=="publish_work")return null;
 const output=z.object({station:z.literal("migrator"),sessionId:z.literal(ownerId),revisionProtocol:z.literal(1),publication}).safeParse(parsed.data.result.output);
 if(!output.success)return null;
 const result=output.data;
 if(result.publication.number!==number||result.publication.ownerSessionId!==ownerId||result.publication.branch!==branch||branch!==workBranch(ownerId))return null;
 return result.publication;
}
async function readOwnerStream(session:{getStreamTailIndex():Promise<number>;getEventStream(options:{startIndex:number}):Promise<ReadableStream<unknown>>},ownerId:string,number:number,branch:string){
 const tail=await session.getStreamTailIndex();
 if(tail>120000)throw new WorkError("owner_unavailable","Owner history exceeds the bounded verification window.");
 const reader=(await session.getEventStream({startIndex:0})).getReader();let found=null;
 const timer=setTimeout(()=>void reader.cancel(),45000);
 try{for(let n=0;n<=tail;n++){const item=await reader.read();if(item.done)break;found=ownerPublication(item.value,ownerId,number,branch)||found;}}
 finally{clearTimeout(timer);await reader.cancel();}
 if(!found)throw new WorkError("owner_unavailable","The original owner is unavailable or predates revision support. Create a child PR; this branch will not be adopted by another agent.");
 return found;
}

export async function verifyOwnerStream(...args:Parameters<typeof readOwnerStream>){
 try{return await readOwnerStream(...args);}catch(error){
  if(error instanceof WorkError)throw error;
  throw new WorkError("owner_unavailable","The original owner cannot be reached in this deployment. Create a child PR instead; ownership was not transferred.");
 }
}
