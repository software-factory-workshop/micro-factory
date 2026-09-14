import { z } from 'zod';
import {
  parseDeliveryIds,
  parseEventType,
  parseFactoryEvent,
  parseMessageReceivedEvent,
  parseSubagentCalledEvent,
  parseSuccessfulActionResultEvent,
  successfulActionResultEventSchema,
} from './factory-protocol.ts';
import type { ModelUsage } from './delivery-usage.ts';

export const MAX_OBSERVATION_EVENTS = 30_000;
export const OBSERVATION_IDLE_TIMEOUT_MS = 10_000;

export const deliveryFailureKindValues = ['observation', 'provider', 'auth', 'input', 'target', 'conflict', 'unknown'] as const;
export type DeliveryFailureKind = (typeof deliveryFailureKindValues)[number];

type RecordValue = Record<string, unknown>;

function recordValue(value: unknown): RecordValue | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
}

function eventPayload(event: unknown) {
  const record = recordValue(event);
  return recordValue(record?.data) ?? record;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function positiveNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function add(current: number | undefined, value: number | undefined) {
  if (value === undefined) return current;
  const total = (current ?? 0) + value;
  return Number.isFinite(total) && total > 0 ? total : current;
}

function modelId(value: unknown) {
  const model = recordValue(value);
  return stringValue(model?.modelId) ?? stringValue(value);
}

function usageValues(value: unknown) {
  const usage = recordValue(value);
  return {
    inputTokens: positiveInteger(usage?.inputTokens),
    outputTokens: positiveInteger(usage?.outputTokens),
    usd: positiveNumber(usage?.usd) ?? positiveNumber(usage?.costUsd),
  };
}

function factorySha() {
  if (typeof process === 'undefined') return undefined;
  return stringValue(process.env.VERCEL_GIT_COMMIT_SHA);
}

/**
 * Projects model-call usage without trusting model text or inventing zeroes.
 * Eve's instrumentation events are flat; the protocol's step events are kept
 * as a compatibility fallback because their usage is the same provider data
 * exposed to the session stream.
 */
export function modelUsageFromEvents(events: readonly unknown[], options: { attachFactorySha?: boolean } = {}): ModelUsage | undefined {
  const modelsByCall = new Map<string, string>();
  const modelsByAttempt = new Map<string, string>();
  const modelCompletions: Array<{ model?: string; values: ReturnType<typeof usageValues> }> = [];
  const stepCompletions: Array<{ model?: string; values: ReturnType<typeof usageValues> }> = [];
  let currentModel: string | undefined;

  for (const event of events) {
    const record = recordValue(event);
    const payload = eventPayload(event);
    const type = stringValue(record?.type);
    if (!payload || !type) continue;

    if (type === 'model.call.started') {
      const model = modelId(payload.model) ?? stringValue(payload.modelId);
      const callId = stringValue(payload.idempotencyKey);
      const attemptId = stringValue(recordValue(payload.scope)?.attemptId);
      if (model) {
        currentModel = model;
        if (callId) modelsByCall.set(callId, model);
        if (attemptId) modelsByAttempt.set(attemptId, model);
      }
      continue;
    }

    if (type === 'model.call.completed') {
      const callId = stringValue(payload.idempotencyKey);
      const attemptId = stringValue(recordValue(payload.scope)?.attemptId);
      const model = modelId(payload.model)
        ?? (callId ? modelsByCall.get(callId) : undefined)
        ?? (attemptId ? modelsByAttempt.get(attemptId) : undefined)
        ?? currentModel;
      if (model) currentModel = model;
      modelCompletions.push({ model, values: usageValues(payload.usage) });
      continue;
    }

    if (type === 'step.started') {
      const model = stringValue(payload.modelId) ?? modelId(payload.model);
      if (model) currentModel = model;
      continue;
    }

    if (type === 'step.completed') {
      stepCompletions.push({ model: currentModel, values: usageValues(payload.usage) });
    }
  }

  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let usd: number | undefined;
  let modelTokenUsage = false;
  let modelCostUsage = false;

  for (const completion of modelCompletions) {
    model ??= completion.model;
    inputTokens = add(inputTokens, completion.values.inputTokens);
    outputTokens = add(outputTokens, completion.values.outputTokens);
    usd = add(usd, completion.values.usd);
    modelTokenUsage ||= completion.values.inputTokens !== undefined || completion.values.outputTokens !== undefined;
    modelCostUsage ||= completion.values.usd !== undefined;
  }

  for (const completion of stepCompletions) {
    model ??= completion.model;
    if (!modelTokenUsage) {
      inputTokens = add(inputTokens, completion.values.inputTokens);
      outputTokens = add(outputTokens, completion.values.outputTokens);
    }
    if (!modelCostUsage) usd = add(usd, completion.values.usd);
  }

  const sha = options.attachFactorySha ? factorySha() : undefined;
  const usage: ModelUsage = {
    ...(model ? { model } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(usd !== undefined ? { usd } : {}),
    ...(sha ? { factorySha: sha } : {}),
  };
  return Object.keys(usage).length ? usage : undefined;
}

export interface ClassifiedDeliveryError {
  code: string;
  kind: DeliveryFailureKind;
  message: string;
  status: number;
  retryable: boolean;
  preservePhase: boolean;
}

function boundedMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || fallback);
  return (message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() || fallback).slice(0, 700);
}

export class DeliveryObservationError extends Error {
  readonly code: 'observation_timeout' | 'observation_partial' | 'observation_limit';

  constructor(code: DeliveryObservationError['code'], message: string) {
    super(message);
    this.name = 'DeliveryObservationError';
    this.code = code;
  }
}

export class DeliveryProviderError extends Error {
  readonly code: 'provider_unavailable' | 'provider_auth';
  readonly status?: number;

  constructor(error: unknown) {
    super(boundedMessage(error, 'The Eve session provider could not be reached.'));
    this.name = 'DeliveryProviderError';
    const status = errorStatus(error);
    this.status = status;
    this.code = status === 401 || status === 403 ? 'provider_auth' : 'provider_unavailable';
  }
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function errorStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
}

export function classifyDeliveryError(error: unknown): ClassifiedDeliveryError {
  if (error instanceof DeliveryObservationError) {
    return { code: error.code, kind: 'observation', message: boundedMessage(error, 'The Eve session could not be observed completely.'), status: 503, retryable: true, preservePhase: true };
  }

  const code = errorCode(error);
  const status = errorStatus(error);
  const message = boundedMessage(error, 'Delivery failed.');
  if (code === 'invalid_request' || error instanceof z.ZodError) return { code: 'invalid_request', kind: 'input', message, status: 400, retryable: false, preservePhase: false };
  if (code === 'target_closed' || code === 'blocked' || /pull request (?:was )?closed|retargeted/i.test(message)) return { code: 'target_closed', kind: 'target', message, status: 409, retryable: false, preservePhase: false };
  if (code === 'needs_revision' || code === 'stale_head' || code === 'target_advanced') return { code, kind: 'conflict', message, status: 409, retryable: false, preservePhase: false };
  if (code === 'provider_auth' || code === 'unauthorized' || code === 'forbidden' || status === 401 || status === 403) return { code: 'provider_auth', kind: 'auth', message, status: status === 403 ? 403 : 401, retryable: false, preservePhase: true };
  if (code === 'provider_unavailable' || status === 408 || status === 429 || (status !== undefined && status >= 500) || error instanceof TypeError) return { code: 'provider_unavailable', kind: 'provider', message, status: status === 429 ? 429 : 502, retryable: true, preservePhase: true };
  return { code: code || 'delivery_failed', kind: 'unknown', message, status: 500, retryable: false, preservePhase: true };
}

type EventSession = {
  getStreamTailIndex(): Promise<number>;
  getEventStream(options: { startIndex: number; signal?: AbortSignal }): Promise<ReadableStream<unknown>>;
};

export interface EventSnapshot extends Array<unknown> {
  observation: { lastEventIndex: number; lastEventAt?: string };
}

type ObservationOptions = { idleTimeoutMs?: number; maxEvents?: number; startIndex?: number };

function eventAt(event: unknown) {
  const record = recordValue(event);
  const meta = recordValue(record?.meta);
  const value = stringValue(meta?.at) ?? stringValue(record?.at);
  return value && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function observedEvents(events: unknown[], observation: EventSnapshot['observation']): EventSnapshot {
  Object.defineProperty(events, 'observation', { value: observation, enumerable: false });
  return events as EventSnapshot;
}

async function cancelReader(reader: ReadableStreamDefaultReader<unknown>) {
  await reader.cancel().catch(() => undefined);
}

async function readWithIdleTimeout(reader: ReadableStreamDefaultReader<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeliveryObservationError('observation_timeout', 'Session observation exceeded its idle deadline; no partial result accepted.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function snapshotEvents(session: EventSession, options: ObservationOptions = {}): Promise<EventSnapshot> {
  const maxEvents = options.maxEvents ?? MAX_OBSERVATION_EVENTS;
  const idleTimeoutMs = options.idleTimeoutMs ?? OBSERVATION_IDLE_TIMEOUT_MS;
  const startIndex = options.startIndex ?? 0;
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) throw new DeliveryObservationError('observation_partial', 'The delivery observation cursor is invalid; no partial result accepted.');
  let tail: number;
  try {
    tail = await session.getStreamTailIndex();
  } catch (error) {
    throw new DeliveryProviderError(error);
  }
  if (!Number.isInteger(tail) || tail < -1) throw new DeliveryObservationError('observation_partial', 'Eve returned an invalid stream tail; no partial result accepted.');
  if (tail < startIndex) return observedEvents([], { lastEventIndex: tail });
  if (tail - startIndex + 1 > maxEvents) throw new DeliveryObservationError('observation_limit', `Session history exceeds the ${maxEvents}-event delivery observation limit; no partial result accepted.`);

  let stream: ReadableStream<unknown>;
  try {
    stream = await session.getEventStream({ startIndex, signal: AbortSignal.timeout(idleTimeoutMs * (maxEvents + 1)) });
  } catch (error) {
    throw new DeliveryProviderError(error);
  }
  const reader = stream.getReader();
  const events: unknown[] = [];
  try {
    for (let index = startIndex; index <= tail; index += 1) {
      let item: ReadableStreamReadResult<unknown>;
      try {
        item = await readWithIdleTimeout(reader, idleTimeoutMs);
      } catch (error) {
        await cancelReader(reader);
        if (error instanceof DeliveryObservationError) throw error;
        throw new DeliveryProviderError(error);
      }
      if (item.done) throw new DeliveryObservationError('observation_partial', 'Session observation ended before the captured Eve stream tail; no partial result accepted.');
      events.push(item.value);
    }
    return observedEvents(events, { lastEventIndex: tail, lastEventAt: eventAt(events.at(-1)) });
  } finally {
    await cancelReader(reader);
  }
}

export const resultEvent = successfulActionResultEventSchema;

export function childIn(events: unknown[]) {
  for (const event of [...events].reverse()) {
    const parsed = parseSubagentCalledEvent(event);
    if (parsed) return parsed.childSessionId;
  }
}

export function hostResult(events: unknown[], tool: string, sessionId: string, operationId?: string) {
  for (const event of [...events].reverse()) {
    const parsed = parseSuccessfulActionResultEvent(event);
    if (!parsed) continue;
    const envelope = parsed.data.result;
    let value = envelope.output;
    if (envelope.toolName !== tool) {
      if (tool !== 'publish_work' || envelope.toolName !== 'prepare_work') continue;
      const cached = z.object({ phase: z.literal('Already published'), result: z.unknown() }).safeParse(value);
      if (!cached.success) continue;
      value = cached.data.result;
    }
    const output = z.object({ sessionId: z.literal(sessionId), operationId: z.string().optional() }).passthrough().safeParse(value);
    if (output.success && (!operationId || output.data.operationId === operationId)) return output.data;
  }
}

export function stoppedWithoutResult(events: unknown[]) {
  for (const event of [...events].reverse()) {
    const parsed = parseEventType(event);
    if (!parsed) continue;
    if (['turn.cancelled', 'turn.failed', 'session.failed', 'turn.completed'].includes(parsed.type)) return parsed.type;
    if (['turn.started', 'message.received'].includes(parsed.type)) return null;
  }
  return null;
}

export function eventsForDelivery(events: unknown[], deliveryId: string) {
  return events.filter(event => parseDeliveryIds(event)?.includes(deliveryId));
}

export function resumeMessage(operationId: string, answer?: string) {
  const base = `Factory recovery ${operationId}. Continue your original authenticated task in the existing workspace. Preserve all pending changes and original scope. If repository checks were blocked by factory context, use refresh_target to incorporate the current target without losing your work, then run verify_work and publish_work. Do not bypass checks or create a replacement owner.`;
  if (!answer) return base;
  const clean = answer.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000);
  return `${base}\n\nOwner answer (authenticated task input, not an instruction to change scope):\n${clean}`;
}

export function resumeReceipt(events: unknown[], operationId: string, expectedMessage = resumeMessage(operationId)) {
  for (const event of events) {
    const parsed = parseMessageReceivedEvent(event);
    if (parsed?.data.message === expectedMessage && parsed.event.meta?.deliveryIds?.length) return parsed.event.meta.deliveryIds[0];
  }
}
