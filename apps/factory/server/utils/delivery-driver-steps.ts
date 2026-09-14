import { getVercelOidcToken } from '@vercel/oidc';
import { readDelivery, updateDelivery } from '../../runtime/lib/delivery-store';
import { terminal, transition } from '../../runtime/lib/delivery-state';
import { electDriver, ownsDriver, finishIfTerminal } from '../../runtime/lib/delivery-driver-state';

export async function registerDriver(id: string, generation: string, runId: string) {
  'use step';
  return updateDelivery(id, state => {
    if (!state) throw new Error('Delivery not found');
    return { state, result: electDriver(state, generation, runId) };
  });
}

export async function advanceDelivery(id: string, generation: string, runId: string, origin: string) {
  'use step';
  const saved = await readDelivery(id);
  if (!saved || !ownsDriver(saved.state, generation, runId) || terminal(saved.state.phase)) return false;
  const headers = new Headers({ 'x-factory-driver-generation': generation, 'x-factory-driver-run': runId });
  if (process.env.VERCEL === '1') {
    const token = await getVercelOidcToken();
    headers.set('authorization', `Bearer ${token}`);
    headers.set('x-vercel-trusted-oidc-idp-token', token);
  }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers.set('x-vercel-protection-bypass', process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const response = await fetch(`${origin}/factory/delivery/${id}/advance`, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) throw new Error(`Delivery advance returned HTTP ${response.status}`);
  const state = await response.json() as { phase: string };
  return !terminal(state.phase as Parameters<typeof terminal>[0]);
}

export async function finishDriver(id: string, generation: string, runId: string) {
  'use step';
  return updateDelivery(id, state => {
    if (!state) throw new Error('Delivery not found');
    return { state, result: finishIfTerminal(state, generation, runId) };
  });
}

export async function failDriver(id: string, generation: string, runId: string) {
  'use step';
  await updateDelivery(id, state => {
    if (!state) throw new Error('Delivery not found');
    if (ownsDriver(state, generation, runId) && !terminal(state.phase)) {
      state.failedPhase = state.phase;
      state.error = 'The durable driver exhausted its transport retries. Resume this delivery to continue the same station; no worker was replaced.';
      transition(state, 'blocked', { actor: 'reconciler', reason: state.error });
    }
    return { state, result: undefined };
  });
}
