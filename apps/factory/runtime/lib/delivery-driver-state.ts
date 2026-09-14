import { randomUUID } from 'node:crypto';
import { terminal, type Delivery } from './delivery-state.ts';

export interface Driver {
  generation: string;
  origin: string;
  requestedAt: number;
  runId?: string;
  status: 'starting' | 'running' | 'stopped';
}

// A start receipt can be lost. Competing runs elect exactly one owner before
// advancing; retrying an uncertain start never creates a second station worker.
export function reserveDriver(state: Delivery, origin: string, endedRunId?: string, now = Date.now()) {
  if (terminal(state.phase)) return null;
  const previous = state.driver;
  if (previous?.runId && previous.runId !== endedRunId && previous.status !== 'stopped') return null;
  if (previous && !previous.runId && now - previous.requestedAt < 60_000) return null;
  const generation = previous && !previous.runId ? previous.generation : randomUUID();
  state.driver = { generation, origin: previous && !previous.runId ? previous.origin : origin, requestedAt: now, status: 'starting' };
  state.version++;
  return { ...state.driver };
}

export function electDriver(state: Delivery, generation: string, runId: string) {
  if (terminal(state.phase) || state.driver?.generation !== generation) return false;
  if (state.driver.runId && state.driver.runId !== runId) return false;
  state.driver.runId = runId;
  state.driver.status = 'running';
  state.version++;
  return true;
}

export function ownsDriver(state: Delivery, generation: string, runId: string) {
  return state.driver?.generation === generation && state.driver.runId === runId && state.driver.status === 'running';
}

export function finishIfTerminal(state: Delivery, generation: string, runId: string) {
  if (!ownsDriver(state, generation, runId)) return true;
  if (!terminal(state.phase)) return false;
  state.driver!.status = 'stopped';
  state.version++;
  return true;
}
