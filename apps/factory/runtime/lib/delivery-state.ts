import type { MergeDecision, MergeReview } from './merge-policy.ts';
import type { Driver } from './delivery-driver-state.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { workerRequest } from './station-access.ts';
import { gateStations, type GateStation } from './station-access.ts';
import { deliveryFailureKindValues, resumeMessage, type ClassifiedDeliveryError } from './delivery-events.ts';
import { modelUsageSchema, type ModelUsage } from './delivery-usage.ts';
import type { WorkOrderAdmission } from '../../shared/cockpit.ts';

export const deliveryRequest = workerRequest.extend({
  // Bounds same-owner repair rounds after blocking review findings. It is not a
  // token or cost budget; model limits are configured in factory-config.ts.
  maxRevisions: z.number().int().min(0).max(10).default(3),
  // A delivery must be started from a persisted cockpit draft so host admission
  // remains bound to the exact title and brief sent to the worker.
  draftId: z.string().min(1).max(240).regex(/^[\w:.-]+$/).optional(),
});
export type DeliveryRequest = z.infer<typeof deliveryRequest>;

export const phaseValues = [
  'worker_starting',
  'working',
  'review_starting',
  'reviewing',
  'revision_starting',
  'revising',
  'awaiting_input',
  'human_review',
  'ready',
  'blocked',
  'cancelled',
  'needs_revision',
  'owner_resuming',
  'merging',
  'merged',
] as const;
export type Phase = (typeof phaseValues)[number];

export const workStateValues = [
  'queued',
  'running',
  'needs_human',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type WorkState = (typeof workStateValues)[number];

export const transitionActorValues = ['workflow', 'operator', 'reconciler', 'provider'] as const;
export type TransitionActor = (typeof transitionActorValues)[number];

export const receiptOutcomeValues = ['dispatched', 'succeeded', 'failed', 'needs_human', 'cancelled'] as const;
export type ReceiptOutcome = (typeof receiptOutcomeValues)[number];

export type ExecutionStation = 'migrator' | 'quality-gate' | 'security-gate' | 'revisions';

export interface ExecutionRef {
  attempt: number;
  station: ExecutionStation;
  operationId: string;
  sessionId: string;
  deliveryId?: string;
}

export interface DeliveryHistoryEntry {
  // `phase` is the old phase field used by the existing cockpit projection.
  phase: Phase;
  to?: Phase;
  at: string;
  actor?: TransitionActor;
  operationId?: string;
  attempt?: number;
  receiptId?: string;
  reason?: string;
  sessionId?: string;
  headSha?: string;
}

export interface DeliveryReceipt {
  schemaVersion: 1;
  receiptId: string;
  deliveryId: string;
  kind: 'transition';
  from: Phase | null;
  to: Phase;
  state: ReceiptOutcome;
  operationId: string;
  attempt: number;
  actor: TransitionActor;
  reason: string;
  expectedVersion: number;
  recordedAt: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  usd?: number;
  factorySha?: string;
  failure?: ClassifiedDeliveryError;
}

const deliveryObservationSchema = z.object({
  lastEventIndex: z.number().int().min(-1),
  lastEventAt: z.string().datetime(),
}).strict();

export interface DeliveryAdmissionFailure {
  recordedAt: string;
}

export interface DeliveryQuestion {
  question: string;
  options?: string[];
  operationId: string;
  sessionId: string;
  askedAt: string;
  answer?: string;
  answeredBy?: string;
  answeredAt?: string;
}

const deliveryQuestionSchema = z.object({
  question: z.string().min(1).max(4000),
  options: z.array(z.string().min(1).max(500)).max(10).optional(),
  operationId: z.string().min(1).max(240),
  sessionId: z.string().min(1).max(240),
  askedAt: z.string().datetime(),
  answer: z.string().min(1).max(10000).optional(),
  answeredBy: z.string().min(1).max(240).optional(),
  answeredAt: z.string().datetime().optional(),
}).strict();

export const MAX_OWNER_QUESTIONS = 32;

export const deliveryReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  receiptId: z.string().uuid(),
  deliveryId: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.literal('transition'),
  from: z.enum(phaseValues).nullable(),
  to: z.enum(phaseValues),
  state: z.enum(receiptOutcomeValues),
  operationId: z.string().min(1).max(240),
  attempt: z.number().int().positive(),
  actor: z.enum(transitionActorValues),
  reason: z.string().max(1000),
  expectedVersion: z.number().int().nonnegative(),
  recordedAt: z.string().datetime(),
  model: z.string().min(1).max(240).optional(),
  inputTokens: z.number().int().positive().optional(),
  outputTokens: z.number().int().positive().optional(),
  usd: z.number().finite().positive().optional(),
  factorySha: z.string().min(1).max(240).optional(),
  failure: z.object({
    code: z.string().min(1).max(240),
    kind: z.enum(deliveryFailureKindValues),
    message: z.string().max(700),
    status: z.number().int().min(100).max(599),
    retryable: z.boolean(),
    preservePhase: z.boolean(),
  }).optional(),
});

export interface DeliveryReview {
  gate?: GateStation;
  verdict: string;
  summary: string;
  headSha: string;
  baseSha: string;
  targetBranch: string;
  findings: Array<{ severity: string; path: string; line?: number; message: string; evidence: string }>;
  limitations: string[];
  verification?: { prepared: boolean; repositoryChecksPassed: boolean; candidateUnchanged: boolean };
}

export interface Delivery {
  schemaVersion: 1;
  kind: 'code_change';
  id: string;
  version: number;
  request: DeliveryRequest;
  // The host-attached admission that satisfied the Cedar start_task policy.
  admission?: WorkOrderAdmission;
  principalId: string;
  state: WorkState;
  phase: Phase;
  cycle: number;
  attempt: number;
  changeId?: string;
  execution?: ExecutionRef;
  createdAt: string;
  updatedAt: string;
  observation: {
    lastEventIndex: number;
    lastEventAt: string;
  };
  leaseUntil?: number;
  driver?: Driver;
  sessionId?: string;
  childSessionId?: string;
  operationId: string;
  deliveryId?: string;
  publication?: {
    number: number;
    url: string;
    headSha: string;
    targetHeadSha: string;
    targetBranch: string;
    ownerSessionId: string;
    branch: string;
  };
  // Which gate runs next. Reviews accumulate per gate; `review` is the last one.
  gate?: GateStation;
  reviews?: Partial<Record<GateStation, DeliveryReview>>;
  review?: DeliveryReview;
  mergeDecision?: MergeDecision;
  mergeReview?: MergeReview;
  reviewerSessionId?: string;
  resumeAttemptedAt?: number;
  resumeOperationId?: string;
  resumeMessage?: string;
  resumeRequests?: Record<string, boolean>;
  questions: DeliveryQuestion[];
  usage?: ModelUsage;
  failure?: ClassifiedDeliveryError;
  failedPhase?: Phase;
  admissionFailure?: DeliveryAdmissionFailure;
  revisionRequests?: Record<string, string>;
  revisionBrief?: string;
  error?: string;
  history: DeliveryHistoryEntry[];
  // Receipts are held only during an update and written before the projection.
  pendingReceipts?: DeliveryReceipt[];
}

export interface TransitionOptions {
  actor?: TransitionActor;
  reason?: string;
  operationId?: string;
}

export const MAX_DELIVERY_HISTORY = 64;

const allowedTransitions: Record<Phase, readonly Phase[]> = {
  worker_starting: ['working', 'review_starting', 'revision_starting', 'human_review', 'blocked', 'needs_revision', 'cancelled'],
  working: ['review_starting', 'awaiting_input', 'human_review', 'blocked', 'needs_revision', 'cancelled'],
  review_starting: ['reviewing', 'human_review', 'blocked', 'needs_revision', 'cancelled'],
  reviewing: ['review_starting', 'ready', 'human_review', 'revision_starting', 'merging', 'blocked', 'needs_revision', 'cancelled'],
  revision_starting: ['revising', 'human_review', 'blocked', 'needs_revision', 'cancelled'],
  revising: ['review_starting', 'awaiting_input', 'human_review', 'blocked', 'needs_revision', 'cancelled'],
  human_review: ['owner_resuming', 'revision_starting', 'merging', 'blocked', 'cancelled'],
  ready: ['merging', 'revision_starting', 'human_review', 'cancelled'],
  blocked: ['worker_starting', 'working', 'review_starting', 'reviewing', 'revision_starting', 'revising', 'human_review', 'ready', 'needs_revision', 'owner_resuming', 'merging', 'cancelled'],
  cancelled: [],
  needs_revision: ['revision_starting', 'human_review', 'cancelled'],
  owner_resuming: ['working', 'human_review', 'blocked', 'cancelled'],
  awaiting_input: ['owner_resuming', 'cancelled'],
  merging: ['merged', 'human_review', 'blocked', 'cancelled'],
  merged: [],
};

export function canTransition(from: Phase, to: Phase) {
  return allowedTransitions[from].includes(to);
}

export const terminal = (phase: Phase) => ['human_review', 'ready', 'blocked', 'cancelled', 'needs_revision', 'merged'].includes(phase);

export function operationFor(id: string, kind: string, cycle: number) {
  const h = createHash('sha256').update(`${id}:${kind}:${cycle}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function workStateForPhase(phase: Phase): WorkState {
  switch (phase) {
    case 'worker_starting':
    case 'review_starting':
    case 'revision_starting':
      return 'queued';
    case 'working':
    case 'reviewing':
    case 'revising':
    case 'owner_resuming':
    case 'merging':
      return 'running';
    case 'human_review':
    case 'ready':
    case 'needs_revision':
    case 'awaiting_input':
      return 'needs_human';
    case 'blocked':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'merged':
      return 'succeeded';
  }
}

function boundedReason(reason: string | undefined, from: Phase | null, to: Phase) {
  const fallback = from ? `Workflow moved work from ${from} to ${to}.` : `Work was admitted in ${to}.`;
  const clean = (reason || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean || fallback).slice(0, 1000);
}

function transitionReceiptId(deliveryId: string, from: Phase | null, to: Phase, operationId: string, attempt: number) {
  return operationFor(deliveryId, `transition:${from || 'none'}:${to}:${operationId}`, attempt);
}

function receiptFor(state: Delivery, from: Phase | null, to: Phase, options: Required<TransitionOptions>, expectedVersion: number): DeliveryReceipt {
  return {
    schemaVersion: 1,
    receiptId: transitionReceiptId(state.id, from, to, options.operationId, state.attempt),
    deliveryId: state.id,
    kind: 'transition',
    from,
    to,
    state: to === 'merged' ? 'succeeded' : to === 'cancelled' ? 'cancelled' : ['human_review', 'ready', 'needs_revision', 'awaiting_input'].includes(to) ? 'needs_human' : to === 'blocked' ? 'failed' : 'dispatched',
    operationId: options.operationId,
    attempt: state.attempt,
    actor: options.actor,
    reason: options.reason,
    expectedVersion,
    recordedAt: new Date().toISOString(),
    ...(state.usage ? state.usage : {}),
    ...(state.failure ? { failure: state.failure } : {}),
  };
}

type LegacyDelivery = Omit<Delivery, 'schemaVersion' | 'kind' | 'state' | 'attempt' | 'observation' | 'questions'> & Partial<Pick<Delivery, 'schemaVersion' | 'kind' | 'state' | 'attempt' | 'observation' | 'questions'>>;

export function normalizeDelivery(raw: LegacyDelivery): Delivery {
  if (!/^[a-f0-9]{64}$/.test(raw.id)) throw new Error('Invalid delivery ID');
  if (!phaseValues.includes(raw.phase)) throw new Error('Invalid delivery phase');
  if (!Number.isInteger(raw.version) || raw.version < 1) throw new Error('Invalid delivery version');
  if (!Number.isInteger(raw.cycle) || raw.cycle < 0) throw new Error('Invalid delivery cycle');
  const request = deliveryRequest.parse(raw.request);
  const usage = raw.usage ? modelUsageSchema.parse(raw.usage) : undefined;
  const observation = raw.observation ? deliveryObservationSchema.parse(raw.observation) : { lastEventIndex: -1, lastEventAt: new Date().toISOString() };
  const attempt = raw.attempt ?? raw.cycle + 1;
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Invalid delivery attempt');
  const history = Array.isArray(raw.history) ? raw.history : [];
  const questions = Array.isArray(raw.questions) ? raw.questions.map(question => deliveryQuestionSchema.parse(question)).slice(-MAX_OWNER_QUESTIONS) : [];
  return {
    ...raw,
    request,
    schemaVersion: 1,
    kind: 'code_change',
    state: workStateForPhase(raw.phase),
    attempt,
    observation,
    questions,
    ...(usage ? { usage } : {}),
    ...(raw.changeId || raw.publication ? { changeId: raw.changeId ?? raw.id } : {}),
    history: history.slice(-MAX_DELIVERY_HISTORY),
  } as Delivery;
}

export function newDelivery(principalId: string, request: DeliveryRequest): Delivery {
  const id = createHash('sha256').update(`${principalId}:${request.operationId}`).digest('hex');
  const now = new Date().toISOString();
  const operationId = operationFor(id, 'migrator', 0);
  const delivery: Delivery = {
    schemaVersion: 1,
    kind: 'code_change',
    id,
    version: 1,
    request,
    principalId,
    state: 'queued',
    phase: 'worker_starting',
    cycle: 0,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    observation: { lastEventIndex: -1, lastEventAt: now },
    operationId,
    questions: [],
    history: [],
  };
  delivery.pendingReceipts = [{
    schemaVersion: 1,
    receiptId: transitionReceiptId(id, null, 'worker_starting', request.operationId, 1),
    deliveryId: id,
    kind: 'transition',
    from: null,
    to: 'worker_starting',
    state: 'dispatched',
    operationId: request.operationId,
    attempt: 1,
    actor: 'workflow',
    reason: 'Work item admitted by the factory workflow.',
    expectedVersion: 0,
    recordedAt: now,
  }];
  return delivery;
}

export function admissionRecoveryAction(id: string, request: DeliveryRequest) {
  return {
    method: 'POST' as const,
    path: '/factory/delivery' as const,
    body: request,
    description: 'Retry the original request with the same operationId. The deterministic delivery ID is reused and outer admission is retried.',
  };
}

function admissionFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  return (message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() || 'unknown error').slice(0, 700);
}

export function recordAdmissionFailure(state: Delivery, error: unknown) {
  if (state.phase !== 'worker_starting') throw new Error('Admission failure can only be recorded before worker start.');
  const reason = `Outer workflow admission failed: ${admissionFailureMessage(error)}. Retry the original POST with the same operationId to retry admission for this delivery.`;
  state.failedPhase = 'worker_starting';
  state.admissionFailure = { recordedAt: new Date().toISOString() };
  state.error = reason.slice(0, 1000);
  transition(state, 'blocked', { actor: 'provider', reason });
  return state;
}

export function retryAdmission(state: Delivery) {
  if (state.phase !== 'blocked' || state.failedPhase !== 'worker_starting' || !state.admissionFailure) return false;
  transition(state, 'worker_starting', {
    actor: 'operator',
    operationId: state.request.operationId,
    reason: 'Retrying outer workflow admission for the existing delivery.',
  });
  delete state.failedPhase;
  delete state.admissionFailure;
  delete state.error;
  return true;
}

export function transition(state: Delivery, phase: Phase, options: TransitionOptions = {}) {
  if (state.phase === phase) return undefined;
  if (!canTransition(state.phase, phase)) throw new Error(`Illegal delivery transition: ${state.phase} -> ${phase}`);

  const from = state.phase;
  const operationId = options.operationId ?? state.operationId;
  const receipt = receiptFor(state, from, phase, {
    actor: options.actor ?? 'workflow',
    reason: boundedReason(options.reason, from, phase),
    operationId,
  }, state.version);
  state.pendingReceipts = [...(state.pendingReceipts ?? []), receipt];
  state.history = [...state.history, {
    phase: from,
    to: phase,
    at: receipt.recordedAt,
    actor: receipt.actor,
    operationId: receipt.operationId,
    attempt: receipt.attempt,
    receiptId: receipt.receiptId,
    reason: receipt.reason,
    sessionId: state.childSessionId || state.sessionId,
    headSha: state.publication?.headSha,
  }].slice(-MAX_DELIVERY_HISTORY);
  state.phase = phase;
  state.state = workStateForPhase(phase);
  state.updatedAt = receipt.recordedAt;
  state.version++;
  delete state.leaseUntil;
  return receipt;
}

export function beginRevision(state: Delivery, operationId: string, brief: string, options: TransitionOptions = {}) {
  if (state.cycle >= state.request.maxRevisions) throw new Error('Maximum delivery revisions reached. Human review is required.');
  if (!canTransition(state.phase, 'revision_starting')) throw new Error(`Illegal delivery transition: ${state.phase} -> revision_starting`);
  state.cycle++;
  state.attempt++;
  state.operationId = operationId;
  state.revisionBrief = brief;
  state.gate = gateStations[0];
  delete state.error;
  delete state.resumeMessage;
  return transition(state, 'revision_starting', { ...options, operationId });
}

export function nextGate(current: GateStation | undefined): GateStation | undefined {
  if (!current) return gateStations[0];
  const index = gateStations.indexOf(current);
  return index >= 0 ? gateStations[index + 1] : undefined;
}

// A review is usable only for the host-published candidate and captured target.
// Gates run in order; every gate must approve without limitations before `ready`.
export function applyReview(state: Delivery, review: DeliveryReview) {
  const publication = state.publication;
  if (!publication || review.headSha !== publication.headSha || review.baseSha !== publication.targetHeadSha || review.targetBranch !== publication.targetBranch) {
    throw new Error('Review is not bound to the published head and target.');
  }
  const gate = review.gate ?? state.gate ?? gateStations[0]!;
  state.review = { ...review, gate };
  state.reviews = { ...state.reviews, [gate]: state.review };
  if (review.findings.some(finding => finding.severity === 'blocking') && state.cycle < state.request.maxRevisions) {
    const operationId = operationFor(state.id, 'revision', state.cycle + 1);
    return beginRevision(state, operationId, `Original task remains in force. Fix the ${gate} findings, preserve all original requirements, run verify_work, and update your existing PR.\n${JSON.stringify(review.findings)}`, {
      reason: `${gate} found blocking issues; the original owner gets a bounded revision.`,
    });
  }
  const clean = review.verdict === 'approve' && !review.limitations.length && !review.findings.some(finding => finding.severity === 'blocking');
  const following = nextGate(gate);
  if (clean && following) {
    state.gate = following;
    state.operationId = operationFor(state.id, following, state.cycle);
    return transition(state, 'review_starting', { operationId: state.operationId, reason: `${gate} approved head ${publication.headSha}; ${following} is next. No merge was performed.` });
  }
  if (clean) {
    return transition(state, 'ready', { reason: `All gates approved head ${publication.headSha}; no merge was performed.` });
  }
  return transition(state, 'human_review', { reason: `${gate} requires a human decision for head ${publication.headSha}; no merge was performed.` });
}

export function referenceState(publication: NonNullable<Delivery['publication']>, actual: { state: string; headSha: string; targetBranch: string; targetHeadSha: string }): 'current' | 'needs_revision' | 'blocked' {
  if (actual.state !== 'open' || actual.targetBranch !== publication.targetBranch) return 'blocked';
  return actual.headSha === publication.headSha && actual.targetHeadSha === publication.targetHeadSha ? 'current' : 'needs_revision';
}

export function claimAdvance(state: Delivery, now = Date.now()) {
  if (terminal(state.phase) || (state.leaseUntil || 0) > now) return null;
  state.leaseUntil = now + 60_000;
  state.version++;
  return structuredClone(state);
}

export function commitAdvance(current: Delivery, candidate: Delivery, claimedVersion: number) {
  if (current.version !== claimedVersion) return current;
  const versionDelta = Math.max(1, candidate.version - claimedVersion);
  delete candidate.leaseUntil;
  candidate.version = current.version + versionDelta;
  candidate.state = workStateForPhase(candidate.phase);
  candidate.updatedAt = new Date().toISOString();
  return candidate;
}

export function requestResume(state: Delivery, operationId?: string) {
  if (operationId && state.resumeRequests?.[operationId]) return state;
  if (state.phase === 'human_review' && !state.publication && state.childSessionId) {
    if (!operationId) throw new Error('An operation ID is required to resume the original worker.');
    state.resumeRequests = { ...state.resumeRequests, [operationId]: true };
    state.resumeOperationId = operationId;
    delete state.resumeAttemptedAt;
    delete state.resumeMessage;
    transition(state, 'owner_resuming', { actor: 'operator', operationId, reason: 'Operator requested continuation by the existing worker owner.' });
  } else if (state.phase === 'blocked' && state.failedPhase) {
    transition(state, state.failedPhase, { actor: 'operator', operationId, reason: 'Operator requested recovery of the failed delivery phase.' });
    if (operationId) state.resumeRequests = { ...state.resumeRequests, [operationId]: true };
  } else {
    throw new Error('This delivery requires review or a published-owner revision, not worker recovery.');
  }
  delete state.error;
  return state;
}

function boundedOwnerText(value: string, limit: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function askOwnerQuestion(
  state: Delivery,
  input: { question: string; options?: string[]; operationId: string; sessionId: string },
  askedAt = new Date().toISOString(),
) {
  const existing = [...state.questions].reverse().find(question => question.operationId === input.operationId && !question.answer);
  if (existing && state.phase === 'awaiting_input') return existing;
  if (!['working', 'revising'].includes(state.phase)) throw new Error('An owner question can only be asked while the worker is executing.');
  if (state.operationId !== input.operationId) throw new Error('The worker operation is not the active delivery operation.');
  if (state.questions.some(question => !question.answer)) throw new Error('This delivery is already waiting for an owner answer.');
  if (state.questions.length >= MAX_OWNER_QUESTIONS) throw new Error('This delivery has reached its owner-question limit.');
  const question = boundedOwnerText(input.question, 4000);
  if (!question) throw new Error('An owner question is required.');
  const options = input.options?.map(option => boundedOwnerText(option, 500)).filter(Boolean).slice(0, 10);
  const entry: DeliveryQuestion = {
    question,
    ...(options?.length ? { options } : {}),
    operationId: input.operationId,
    sessionId: input.sessionId,
    askedAt,
  };
  state.questions = [...state.questions, entry];
  transition(state, 'awaiting_input', { operationId: input.operationId, reason: 'The worker needs an owner answer before it can continue.' });
  return entry;
}

export function answerOwnerQuestion(state: Delivery, operationId: string, answer: string, principalId: string, answeredAt = new Date().toISOString()) {
  const question = [...state.questions].reverse().find(candidate => candidate.operationId === operationId);
  if (!question) throw new Error('No pending owner question matches this operation.');
  const cleanAnswer = boundedOwnerText(answer, 10000);
  if (!cleanAnswer) throw new Error('An owner answer is required.');
  if (question.answer) {
    if (question.answer !== cleanAnswer) throw new Error('This owner question already has a different answer.');
    return state;
  }
  if (state.phase !== 'awaiting_input') throw new Error('This delivery is not waiting for an owner answer.');
  question.answer = cleanAnswer;
  question.answeredBy = principalId;
  question.answeredAt = answeredAt;
  state.resumeOperationId = operationId;
  state.resumeMessage = resumeMessage(operationId, cleanAnswer);
  delete state.resumeAttemptedAt;
  delete state.error;
  delete state.failure;
  transition(state, 'owner_resuming', { actor: 'operator', operationId, reason: 'The authenticated owner answered the worker question.' });
  return state;
}
