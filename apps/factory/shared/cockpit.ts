import { z } from 'zod';
export const idSchema = z.string().min(1).max(240).regex(/^[\w:.-]+$/);
const admissionText = z.string().trim().min(1).max(4000);
const admissionList = z.array(admissionText).min(1).max(20);
export const workOrderAdmissionSchema = z.discriminatedUnion('kind', [
 z.object({kind:z.literal('work_order'),outcome:admissionText,scope:admissionList,evidence:admissionList,verification:admissionList}).strict(),
 z.object({kind:z.literal('clarification'),questions:admissionList,blockingDecision:admissionText}).strict(),
 z.object({kind:z.literal('unsupported'),reason:admissionText,evidence:admissionList}).strict(),
]);
export type WorkOrderAdmission = z.infer<typeof workOrderAdmissionSchema>;
export const draftInput = z.object({ title: z.string().trim().min(1).max(200), request: z.string().trim().min(1).max(40000), admission: workOrderAdmissionSchema.optional() }).strict();
export const feedbackInput = z.object({ verdict: z.enum(['useful','not-useful']), reason: z.string().max(500) }).strict();
export const runInput = z.object({ label: z.string().max(200), station: z.enum(['migrator','quality-gate','security-gate','loop']), operationId: z.string().max(240).optional(), execution: z.enum(['owner','dispatcher','direct']).optional(), rootAgent:z.enum(['migrator','quality-gate','security-gate']).optional(), deliveryId: z.string().optional() }).strict();
export const recordSchema = z.object({ id: idSchema, version: z.number().int().positive(), updatedAt: z.string(), createdAt: z.string(), value: z.record(z.string(), z.unknown()) });
export type CockpitRecord = z.infer<typeof recordSchema>;
export const collections = ['drafts','feedback','runs'] as const;
export type Collection = typeof collections[number];
export const documentSchema = z.object({ schemaVersion: z.literal(1), imported: z.array(z.string()).default([]), versions: z.record(z.string(),z.number().int().nonnegative()).default({}), drafts: z.record(z.string(),recordSchema), feedback: z.record(z.string(),recordSchema), runs: z.record(z.string(),recordSchema) });
export type CockpitDocument = z.infer<typeof documentSchema>;
export function emptyDocument(): CockpitDocument { return {schemaVersion:1,imported:[],versions:{},drafts:{},feedback:{},runs:{}}; }
export function parseValue(collection:Collection, value:unknown) { return ({drafts:draftInput,feedback:feedbackInput,runs:runInput}[collection]).parse(value); }
export class CockpitConflict extends Error {}
export function changeRecord(doc:CockpitDocument, collection:Collection, id:string, value:unknown|null, expectedVersion:number, now=new Date().toISOString()): CockpitRecord | null {
 idSchema.parse(id); const previous=doc[collection][id];
 if((previous?.version??0)!==expectedVersion)throw new CockpitConflict('This item changed. Reload before saving; your edit has not been discarded.');
 const key=collection+':'+id;const version=Math.max(doc.versions[key]??0,previous?.version??0)+1;
 doc.versions[key]=version;
 if(value===null){delete doc[collection][id];return null;}
 const next={id,version,createdAt:previous?.createdAt??now,updatedAt:now,value:parseValue(collection,value)};
 doc[collection][id]=next;return next;
}

export function importRecords(doc:CockpitDocument,collection:Collection,records:Array<{id:string;value:unknown}>) {
 for(const record of records){const key=collection+':'+idSchema.parse(record.id);if(doc.imported.includes(key))continue;
  if(!doc[collection][record.id])changeRecord(doc,collection,record.id,record.value,0);
  doc.imported.push(key);
 }
 return Object.values(doc[collection]);
}
