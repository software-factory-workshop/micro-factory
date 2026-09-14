import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { documentSchema,emptyDocument,CockpitConflict,type CockpitDocument } from '../../shared/cockpit.ts';
import { factoryBlobPaths } from './factory-config.ts';
const pathname=factoryBlobPaths.cockpit;
export async function readCockpit() {
 const response=await get(pathname,{access:'private',useCache:false,headers:{'accept-encoding':'identity'}});
 if(!response)return {document:emptyDocument(),etag:undefined};
 if(response.blob.etag.startsWith('W/'))throw new Error('Storage returned a weak ETag; refusing an unsafe conditional update.');
 if(response.statusCode!==200||!response.stream)throw new Error('Cockpit storage could not be read.');
 return {document:documentSchema.parse(await new Response(response.stream).json()),etag:response.blob.etag};
}
export interface CockpitStorage {
 read():Promise<{document:CockpitDocument;etag:string|undefined}>;
 write(document:CockpitDocument,etag:string|undefined):Promise<boolean>;
}
export async function mutateCockpit<T>(storage:CockpitStorage,change:(document:CockpitDocument)=>T):Promise<T> {
 for(let attempt=0;attempt<5;attempt++) {
  const {document,etag}=await storage.read();const result=change(document);
  if(await storage.write(document,etag))return result;
 }
 throw new CockpitConflict('The cockpit is busy. Retry the save.');
}
const storage:CockpitStorage={read:readCockpit,async write(document,etag){
 try {await put(pathname,JSON.stringify(document),{access:'private',addRandomSuffix:false,allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}),contentType:'application/json'});return true;}
 catch(error){if(error instanceof BlobPreconditionFailedError||error instanceof Error&&error.message.includes('already exists'))return false;throw error;}
}};
export function updateCockpit<T>(change:(document:CockpitDocument)=>T):Promise<T>{return mutateCockpit(storage,change);}
