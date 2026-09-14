import { parseStationToolResult, matchesStationDelivery } from '../../app/utils/work-station.ts';
import { parseFactoryEvent, parseSubagentCalledEvent, parseSuccessfulActionResultEvent } from './factory-protocol.ts';
export function projectRunEvent(value:unknown,operationId?:string) {
 const parsed=parseSuccessfulActionResultEvent(value);if(!parsed)return undefined;
 const result=parsed.data.result;
 const output=parseStationToolResult(result.toolName,result.output,operationId);
 return output?{kind:'work' as const,output}:undefined;
}
export async function readRun(session:{getStreamTailIndex():Promise<number>;getEventStream(options:{startIndex:number}):Promise<ReadableStream<unknown>>},filter:{operationId?:string;deliveryId?:string}={}) {
 const tail=await session.getStreamTailIndex();if(tail>30000)throw new Error('Run exceeds the bounded result window; use its Eve stream.');
 const reader=(await session.getEventStream({startIndex:0})).getReader();let result:ReturnType<typeof projectRunEvent>;let terminal:string|undefined;let timedOut=false;let read=0;let deliveryStarted=false;let childSessionId:string|undefined;
 const timeout=setTimeout(()=>{timedOut=true;void reader.cancel();},15000);
 try {for(let index=0;index<=tail;index++){const item=await reader.read();if(item.done)break;read++;const event=parseFactoryEvent(item.value);if(!event)continue;
  if(filter.deliveryId){if(!matchesStationDelivery(event,filter.deliveryId,deliveryStarted))continue;deliveryStarted=true;}
  const child=parseSubagentCalledEvent(event);if(child&&['migrator','quality-gate','security-gate'].includes(String(child.name)))childSessionId=child.childSessionId;
  if(event.type==='turn.started'){terminal=undefined;result=undefined;}
  result=projectRunEvent(item.value,filter.operationId)||result;
  if(['turn.completed','turn.cancelled','turn.failed','session.failed'].includes(event.type))terminal=event.type;
 }} finally {clearTimeout(timeout);await reader.cancel();}
 return {result,terminal,childSessionId,streamIndex:tail,complete:!timedOut&&read>tail};
}

export async function readStationRun(attachSession:(id:string)=>Parameters<typeof readRun>[0]|Promise<Parameters<typeof readRun>[0]>,id:string,filter:Parameters<typeof readRun>[1]={}) {
 const parent=await readRun(await attachSession(id),filter);
 if(!parent.complete||!parent.childSessionId||filter.deliveryId)return {...parent,sessionId:id};
 const child=await readRun(await attachSession(parent.childSessionId),{operationId:filter.operationId});
 return {...child,sessionId:parent.childSessionId,dispatcherSessionId:id};
}
