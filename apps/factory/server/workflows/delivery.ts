import { getWorkflowMetadata, sleep } from 'workflow';
import { registerDriver, advanceDelivery, finishDriver, failDriver } from '../utils/delivery-driver-steps';

export async function deliveryDriver(id: string, generation: string, origin: string) {
  'use workflow';
  const runId = getWorkflowMetadata().workflowRunId;
  if (!await registerDriver(id, generation, runId)) return;
  while (true) {
    let active: boolean;
    try {
      active = await advanceDelivery(id, generation, runId, origin);
    } catch {
      await failDriver(id, generation, runId);
      active = false;
    }
    // A resume may arrive after the advance observed a terminal phase. Only
    // the atomic finish handshake can decide whether this driver should exit.
    if (!active && await finishDriver(id, generation, runId)) return;
    await sleep('5s');
  }
}
