import { getRun, start } from 'workflow/api';
import { readDelivery, updateDelivery } from '../../runtime/lib/delivery-store';
import { terminal } from '../../runtime/lib/delivery-state';
import { reserveDriver } from '../../runtime/lib/delivery-driver-state';
import { deliveryDriver } from '../workflows/delivery';

export async function ensureDeliveryDriver(id: string, request: Request) {
  const saved = await readDelivery(id);
  if (!saved || terminal(saved.state.phase)) return;
  const prior = saved.state.driver;
  let endedRunId: string | undefined;
  if (prior?.runId && prior.status !== 'stopped') {
    const status = await getRun(prior.runId).status;
    if (!['completed', 'failed', 'cancelled'].includes(status)) return;
    endedRunId = prior.runId;
  }
  // Pin every server-side advance to the same immutable deployment as this run.
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(request.url).origin;
  if (!process.env.VERCEL_URL && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('A local driver requires a loopback origin. Vercel must supply VERCEL_URL.');
  }
  const reserved = await updateDelivery(id, state => {
    if (!state) throw new Error('Delivery not found');
    return { state, result: reserveDriver(state, origin, endedRunId) };
  });
  if (!reserved) return;
  // Deliberately no credential in durable arguments or receipts. A lost start
  // response is recovered by the workflow's own first-step CAS registration.
  const run = await start(deliveryDriver, [id, reserved.generation, reserved.origin]);
  await updateDelivery(id, state => {
    if (!state) throw new Error('Delivery not found');
    if (state.driver?.generation === reserved.generation && !state.driver.runId) {
      state.driver.runId = run.runId;
      state.version++;
    }
    return { state, result: undefined };
  });
}

export async function cancelDeliveryDriver(id: string) {
  const saved = await readDelivery(id);
  if (saved?.state.driver?.runId) await getRun(saved.state.driver.runId).cancel();
}

