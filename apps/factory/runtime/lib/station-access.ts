import { createHash } from "node:crypto";
import { z } from "zod";
export const MIN_WORK_REQUEST_LENGTH = 20;
export const migratorRequest = z.object({operationId:z.string().uuid(),title:z.string().trim().min(1).max(160),brief:z.string().trim().min(MIN_WORK_REQUEST_LENGTH).max(18000),parentPrNumber:z.number().int().positive().optional()}).strict();
export const gateRequest = z.object({operationId:z.string().uuid(),prNumber:z.number().int().positive()}).strict();
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

export const revisionRequest=z.object({operationId:z.string().uuid(),prNumber:z.number().int().positive(),brief:z.string().trim().min(MIN_WORK_REQUEST_LENGTH).max(18000)}).strict();
export function currentRevision(ctx:SessionContext & {session:{auth:{current?:{attributes:Readonly<Record<string,unknown>>}|null}}}) {
 const raw=ctx.session.auth.current?.attributes.factoryRevision;
 return typeof raw==="string"?revisionRequest.parse(JSON.parse(raw)):null;
}

export function stationDeliveryId(ctx:SessionContext) {
 const value=ctx.session.auth.initiator?.attributes.factoryDeliveryId;
 return typeof value==="string"&&/^[a-f0-9]{64}$/.test(value)?value:null;
}

export function stationAddress(principalId:string,station:string,operationId:string,addressPrefix?:string){return createHash("sha256").update(JSON.stringify([addressPrefix||principalId,station,operationId])).digest("hex");}
