import { createHash } from "node:crypto";
import { z } from "zod";
export const MIN_WORK_REQUEST_LENGTH = 20;
import { factoryRepository, prototypeRepository } from "./factory-config.ts";
// owner/name, GitHub's own character set. The host, never a model, chooses these values.
export const repositoryName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);
export const prototypeInput = z.object({repository:repositoryName,ref:z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/).default("main")}).strict();
export const migratorRequest = z.object({operationId:z.string().uuid(),title:z.string().trim().min(1).max(160),brief:z.string().trim().min(MIN_WORK_REQUEST_LENGTH).max(18000),parentPrNumber:z.number().int().positive().optional(),repository:repositoryName.default(factoryRepository),prototype:prototypeInput.default({repository:prototypeRepository,ref:"main"})}).strict();
// Gates receive the prototype from the host, never from the candidate: the snapshot manifest lives in the
// migrator's sandbox and is not published, so a gate cannot learn the prototype from the PR head.
export const gateRequest = z.object({operationId:z.string().uuid(),prNumber:z.number().int().positive(),repository:repositoryName.default(factoryRepository),prototype:prototypeInput.optional()}).strict();
// Legacy names kept so the copied delivery loop and tests read unchanged.
export const workerRequest = migratorRequest;
export const reviewerRequest = gateRequest;
export const stationValues = ["migrator", "quality-gate", "security-gate"] as const;
export type Station = (typeof stationValues)[number];
export type GateStation = Exclude<Station, "migrator">;
export const gateStations: readonly GateStation[] = ["quality-gate", "security-gate"];
export function isGate(station: Station): station is GateStation { return station !== "migrator"; }
type SessionContext = {session:{auth:{initiator?:{attributes:Readonly<Record<string,unknown>>}|null}}};
export function stationOf(ctx:SessionContext):Station|null {
 const value=ctx.session.auth.initiator?.attributes.factoryStation;
 return (stationValues as readonly unknown[]).includes(value) ? value as Station : null;
}
export function requireStation(ctx:SessionContext,expected:Station) {
 if(stationOf(ctx)!==expected) throw new Error(`This capability requires an authenticated ${expected} station session.`);
}
export function requireGate(ctx:SessionContext):GateStation {
 const station=stationOf(ctx);
 if(!station||!isGate(station)) throw new Error("This capability requires an authenticated gate station session.");
 return station;
}
export function stationRequest(ctx:SessionContext) {
 const raw=ctx.session.auth.initiator?.attributes.factoryRequest;
 if(typeof raw!=="string") throw new Error("Missing trusted station request.");
 return stationOf(ctx)==="migrator" ? migratorRequest.parse(JSON.parse(raw)) : gateRequest.parse(JSON.parse(raw));
}

export const revisionRequest=z.object({operationId:z.string().uuid(),prNumber:z.number().int().positive(),brief:z.string().trim().min(MIN_WORK_REQUEST_LENGTH).max(18000),repository:repositoryName.default(factoryRepository)}).strict();
export function currentRevision(ctx:SessionContext & {session:{auth:{current?:{attributes:Readonly<Record<string,unknown>>}|null}}}) {
 const raw=ctx.session.auth.current?.attributes.factoryRevision;
 return typeof raw==="string"?revisionRequest.parse(JSON.parse(raw)):null;
}

export function stationDeliveryId(ctx:SessionContext) {
 const value=ctx.session.auth.initiator?.attributes.factoryDeliveryId;
 return typeof value==="string"&&/^[a-f0-9]{64}$/.test(value)?value:null;
}

export function stationAddress(principalId:string,station:string,operationId:string,addressPrefix?:string){return createHash("sha256").update(JSON.stringify([addressPrefix||principalId,station,operationId])).digest("hex");}
