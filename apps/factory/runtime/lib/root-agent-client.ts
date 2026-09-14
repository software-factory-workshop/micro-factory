import { Client } from 'eve/client';
import { getVercelOidcToken } from '@vercel/oidc';
import { readStationRegistry } from './station-registry';
import { factoryPorts } from './factory-config.ts';
export type RootAgent = 'migrator' | 'quality-gate' | 'security-gate';
export function factoryOrigin() { return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${factoryPorts.cockpit}`; }
export async function serviceHeaders():Promise<Record<string,string>> {
 if(!process.env.VERCEL) return {'content-type':'application/json'};
 const token=await getVercelOidcToken();
 return {'content-type':'application/json',authorization:`Bearer ${token}`,'x-vercel-trusted-oidc-idp-token':token};
}
export async function rootRequest(root:RootAgent,path:string,body:unknown) {
 const response=await fetch(`${factoryOrigin()}/${root}${path}`,{method:'POST',headers:await serviceHeaders(),body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
 const result=await response.json();if(!response.ok)throw new Error(result.error?.message||result.error||`Agent request failed (${response.status})`);return result;
}
export async function recordedRoot(id:string):Promise<RootAgent|undefined> {
 const value=(await readStationRegistry()).registry.sessions[id];
 return value==='migrator'||value==='quality-gate'||value==='security-gate'?value:undefined;
}
async function streamTailIndex(root:RootAgent,id:string) {
 const response=await fetch(`${factoryOrigin()}/${root}/eve/v1/session/${encodeURIComponent(id)}/stream?includeTailIndex=1`,{cache:'no-store',headers:await serviceHeaders(),redirect:'error',signal:AbortSignal.timeout(15000)});
 await response.body?.cancel();
 if(!response.ok)throw new Error(`Eve stream tail unavailable (${response.status})`);
 const value=response.headers.get('x-eve-stream-tail-index');
 if(!value||!/^-?\d+$/.test(value))throw new Error('Eve stream did not return a valid tail index.');
 const tail=Number(value);
 if(!Number.isSafeInteger(tail)||tail<-1)throw new Error('Eve stream returned an invalid tail index.');
 return tail;
}
export function rootSession(root:RootAgent,id:string) {
 const client=new Client({host:`${factoryOrigin()}/${root}`,headers:serviceHeaders,redirect:'error'});
 const session=client.sessions.attach(id);
 return {
  getStreamTailIndex:async()=>streamTailIndex(root,id),
  getEventStream:async(options:{startIndex:number;signal?:AbortSignal})=>{
   const iterator=session.stream({startIndex:options.startIndex,follow:false,signal:options.signal})[Symbol.asyncIterator]();
   return new ReadableStream({
    async pull(controller){try{const item=await iterator.next();if(item.done)controller.close();else controller.enqueue(item.value);}catch(error){controller.error(error);}},
    async cancel(){await iterator.return?.();},
   });
  },
  cancel:async(options?:{tasks?:boolean})=>session.cancel(options),
  send:async(message:string,options?:{auth?:{attributes?:Readonly<Record<string,unknown>>}})=>rootRequest(root,`/factory/session/${encodeURIComponent(id)}/continue`,{message,revision:options?.auth?.attributes?.factoryRevision}),
 };
}

export async function factorySession<T>(id:string,fallback:(id:string)=>T){const root=await recordedRoot(id);return root?rootSession(root,id):fallback(id);}
