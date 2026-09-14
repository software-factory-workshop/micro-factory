import { defineHook } from 'eve/hooks';
import { log } from 'evlog';
import { updateCockpit } from '../lib/cockpit-store';
import { changeRecord } from '../../shared/cockpit';
import { stationOf,stationRequest } from '../lib/station-access';
export default defineHook({events:{async 'session.started'(_,ctx){
 const station=stationOf(ctx);if(!station)return;const request=stationRequest(ctx);
 try {await updateCockpit(doc=>doc.runs[ctx.session.id]??changeRecord(doc,'runs',ctx.session.id,{station,rootAgent:station,label:'title'in request?request.title:`${station} on PR #${request.prNumber}`,operationId:request.operationId},0));}catch{log.warn({factory:{stage:'cockpit_history',outcome:'unavailable',reason:'storage_write_failed'}});}
}}});
