import { defineEventHandler, getRouterParam, sendWebResponse, toWebRequest, createError } from 'h3';
import { routeAuth } from 'eve/channels/auth';
import { factoryAuth } from '../../../../../runtime/lib/route-auth';
import { readDelivery } from '../../../../../runtime/lib/delivery-store';
import { ensureDeliveryDriver, cancelDeliveryDriver } from '../../../../utils/delivery-driver';

export default defineEventHandler(async event => {
  const request = toWebRequest(event);
  const auth = await routeAuth(request, factoryAuth);
  if (auth instanceof Response) return sendWebResponse(event, auth);
  const id = getRouterParam(event, 'id');
  if (!id || !/^[a-f0-9]{64}$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid delivery ID' });
  if (!await readDelivery(id)) throw createError({ statusCode: 404, statusMessage: 'Delivery not found' });
  if (request.method === 'POST') await ensureDeliveryDriver(id, request);
  else if (request.method === 'DELETE') await cancelDeliveryDriver(id);
  else if (request.method !== 'GET') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
  const state = (await readDelivery(id))!.state;
  return { id: state.id, phase: state.phase, driver: state.driver ?? null };
});
