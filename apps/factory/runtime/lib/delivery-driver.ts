import { getVercelOidcToken } from '@vercel/oidc';
import { factoryPorts } from './factory-config.ts';

// Agent services notify the outer Nuxt workflow host. The host owns orchestration;
// no Eve session, tool executor, or model launches the workflow.
async function driverRequest(id: string, request: Request, method: 'POST' | 'DELETE') {
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.FACTORY_COCKPIT_ORIGIN || `http://127.0.0.1:${factoryPorts.cockpit}`);
  const headers = new Headers();
  if (process.env.VERCEL === '1') {
    const token = await getVercelOidcToken();
    headers.set('authorization', `Bearer ${token}`);
    headers.set('x-vercel-trusted-oidc-idp-token', token);
  } else {
    const token = request.headers.get('authorization');
    if (token) headers.set('authorization', token);
  }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers.set('x-vercel-protection-bypass', process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const response = await fetch(`${origin}/api/factory/delivery/${id}/driver`, {
    method, headers, redirect: 'error', signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Outer workflow ${method} returned HTTP ${response.status}`);
}

export function ensureDeliveryDriver(id: string, request: Request) {
  return driverRequest(id, request, 'POST');
}

export function cancelDeliveryDriver(id: string, request: Request) {
  return driverRequest(id, request, 'DELETE');
}
