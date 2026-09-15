<script setup lang="ts">
import { deliveryFlow, displayToolName } from "../utils/observability-flow";
import { describeDeliveryPhase, formatDeliveryUpdatedAt } from "../utils/delivery-summary";
import { MIN_WORK_REQUEST_LENGTH } from "../utils/work-station";
import { copyText, shortIdentifier } from "../utils/technical-details";
import { formatModelUsage } from "../utils/model-usage.ts";
import { missingCapabilities } from "../../runtime/lib/factory-config.ts";

interface Review {
  gate?: string;
  verdict: string;
  summary: string;
  baseSha?: string;
  headSha?: string;
  targetBranch?: string;
  findings?: Array<{ severity: string; path: string; line?: number; message: string; evidence: string }>;
  limitations?: string[];
  verification?: { prepared: boolean; repositoryChecksPassed: boolean; candidateUnchanged: boolean };
}
interface Delivery {
  id: string;
  version: number;
  phase: string;
  cycle: number;
  principalId?: string;
  updatedAt?: string;
  sessionId?: string;
  childSessionId?: string;
  reviewerSessionId?: string;
  failure?: { kind: string; retryable: boolean };
  failedPhase?: string;
  publication?: { number: number; url: string; branch?: string; targetBranch?: string; headSha?: string; targetHeadSha?: string; ownerSessionId?: string; parentPrNumber?: number; preview?: { url: string; state: string; environment: string; checkedAt: string } };
  gate?: string;
  reviews?: Partial<Record<string, Review>>;
  review?: Review;
  execution?: { attempt: number; station: string; operationId: string; sessionId: string; deliveryId?: string };
  attempt?: number;
  mergeDecision?: { status: string; reason?: string; commitSha?: string };
  bootstrap?: { repository: string; repositoryUrl: string; projectName: string; productionUrl: string; prototype: { repository: string; ref: string; revision: string }; created: { repository: boolean; project: boolean; deployment: boolean }; warnings: string[] };
  merge?: { approvedBy: string; reason: string; commitSha: string; headSha: string; targetBranch: string; mergedAt: string };
  questions?: Array<{ question: string; options?: string[]; operationId: string; sessionId: string; askedAt: string; answer?: string; answeredBy?: string; answeredAt?: string }>;
  error?: string;
  request?: { title?: string; brief?: string; parentPrNumber?: number; draftId?: string; repository?: string; prototype?: { repository: string; ref: string } };
  admission?: { kind: string; outcome?: string; scope?: string[]; evidence?: string[]; verification?: string[] };
  history: Array<{ phase: string; to?: string; at?: string; actor?: string; reason?: string; receiptId?: string; sessionId?: string; headSha?: string; operationId?: string; attempt?: number }>;
  usage?: { model?: string; inputTokens?: number; outputTokens?: number; usd?: number; factorySha?: string };
  activity?: { updatedAt: string; eventCount: number; steps: number; toolCalls: number; toolErrors: number; lastEventAt?: string; lastTool?: { toolName: string; input?: string; summary?: string; outcome: string; startedAt?: string; endedAt?: string; durationMs?: number }; lastError?: { toolName: string; message: string; at?: string }; finalMessage?: string; terminal?: { type: string; at?: string; code?: string; message?: string }; model?: string };
}
interface ReconciliationResult { eligible: boolean; reason: string; commitSha?: string }

const props = withDefaults(defineProps<{
  title?: string;
  brief?: string;
  draftId?: string;
  repository?: string;
  prototype?: { repository: string; ref: string };
  mode?: "compose" | "run";
}>(), {
  title: "",
  brief: "",
  draftId: "",
  repository: "",
  prototype: undefined,
  mode: "compose",
});
const emit = defineEmits<{ started: [value: Delivery] }>();

const route = useRoute();
const router = useRouter();
const run = ref<Delivery>();
const error = ref("");
const working = ref(false);
const stopping = ref(false);
const revision = ref("");
const mergeReason = ref("");
const merging = ref(false);
const mergeFocus = ref(false);
const confirmStop = ref(false);
const reconciliation = ref<ReconciliationResult>();
const reconciling = ref(false);
const copiedEvidence = ref<string>();
const ownerAnswer = ref("");
const revisionFocus = ref(false);
const ownerAnswerFocus = ref(false);
const answeringOwner = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let operationId: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const stopped = new Set(["human_review", "ready", "blocked", "needs_revision", "cancelled", "merged"]);
const reconcilable = new Set(["human_review", "ready", "blocked"]);
const cockpit = useCockpit();

const pendingOwnerQuestion = computed(() => run.value?.phase === "awaiting_input"
  ? [...(run.value.questions || [])].reverse().find(question => !question.answer)
  : undefined);

const flowModel = computed(() => deliveryFlow({
  phase: run.value?.phase,
  cycle: run.value?.cycle,
  failedPhase: run.value?.failedPhase,
  history: run.value?.history,
  sessionId: run.value?.sessionId,
  childSessionId: run.value?.childSessionId,
  reviewerSessionId: run.value?.reviewerSessionId,
  publication: run.value?.publication,
  review: run.value?.review,
  gate: run.value?.gate,
  reviews: run.value?.reviews,
  mergeDecision: run.value?.mergeDecision,
  error: run.value?.error,
  question: pendingOwnerQuestion.value?.question,
}));
const phaseInfo = computed(() => run.value ? describeDeliveryPhase(run.value.phase) : { label: "Workflow blueprint", color: "neutral" as const });
const runningPhases = new Set(["working", "reviewing", "revising", "owner_resuming"]);
function relativeTime(value?: string) {
  if (!value) return "";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}
const activityLine = computed(() => {
  const current = activity.value;
  if (!current) return undefined;
  const activity = current;
  const last = activity.lastTool;
  const lastText = last ? `last ${last.outcome === "running" ? "running" : last.outcome === "error" ? "failed" : "finished"} ${displayToolName(last.toolName).toLowerCase()}${last.summary ? ` → ${last.summary}` : ""}` : undefined;
  return [`step ${activity.steps}`, `${activity.toolCalls} tool calls${activity.toolErrors ? ` (${activity.toolErrors} failed)` : ""}`, lastText, activity.lastEventAt ? `last event ${relativeTime(activity.lastEventAt)}` : undefined].filter(Boolean).join(" · ");
});
const phaseDetail = computed(() => pendingOwnerQuestion.value?.question || run.value?.error || (run.value && runningPhases.has(run.value.phase) && activityLine.value) || run.value?.mergeDecision?.reason || run.value?.review?.summary || (run.value && runningPhases.has(run.value.phase) ? "Station accepted; waiting for its first events." : "The durable workflow is observing the next station."));
const currentAttempt = computed(() => attempts.value.find(item => item.sessionId === run.value?.execution?.sessionId) ?? attempts.value.at(-1));
// Deliveries recorded before the loop kept `activity` still have their station stream: read
// its digest once so an old failure explains itself too.
type Activity = NonNullable<Delivery["activity"]>;
const fetchedActivity = ref<Activity>();
let fetchedFor: string | undefined;
const activity = computed<Activity | undefined>(() => run.value?.activity ?? fetchedActivity.value);
watch(() => [run.value?.id, run.value?.activity, currentAttempt.value?.sessionId, run.value?.phase] as const, async ([id, recorded, sessionId, phase]) => {
  if (!id || recorded || !sessionId || !phase || !stopped.has(phase) || fetchedFor === sessionId) return;
  fetchedFor = sessionId;
  try {
    const digest = await $fetch<{ eventCount: number; steps: number; toolCalls: number; toolErrors: number; lastAt?: string; lastTool?: Activity["lastTool"]; lastError?: Activity["lastError"]; finalMessage?: string; terminal?: Activity["terminal"]; model?: string }>(`/factory/cockpit/run/${encodeURIComponent(sessionId)}/digest`, { retry: 0 });
    if (fetchedFor !== sessionId) return;
    fetchedActivity.value = { updatedAt: new Date().toISOString(), eventCount: digest.eventCount, steps: digest.steps, toolCalls: digest.toolCalls, toolErrors: digest.toolErrors, lastEventAt: digest.lastAt, lastTool: digest.lastTool, lastError: digest.lastError, finalMessage: digest.finalMessage, terminal: digest.terminal, model: digest.model };
  } catch {
    // The attempt link still leads to the full run page.
  }
}, { immediate: true });
const updatedLabel = computed(() => formatDeliveryUpdatedAt(run.value?.updatedAt));
const usageLabel = computed(() => formatModelUsage(run.value?.usage));
const gateReviews = computed(() => Object.entries(run.value?.reviews ?? {}).filter((entry): entry is [string, Review] => !!entry[1]));
const allFindings = computed(() => gateReviews.value.flatMap(([gate, review]) => (review.findings ?? []).map(finding => ({ ...finding, gate }))).sort((a, b) => Number(b.severity === "blocking") - Number(a.severity === "blocking")));
const allLimitations = computed(() => gateReviews.value.flatMap(([gate, review]) => (review.limitations ?? []).map(item => `${gate}: ${item}`)));
type AttentionKind = "blocked" | "flawed" | "waiting" | "ready" | "running" | "done";
const attention = computed<AttentionKind>(() => {
  const phase = run.value?.phase;
  if (!phase) return "running";
  if (phase === "blocked") return "blocked";
  if (phase === "awaiting_input") return "waiting";
  if (phase === "human_review" || phase === "needs_revision") return "flawed";
  if (phase === "ready") return "ready";
  if (phase === "cancelled" || phase === "merged") return "done";
  return "running";
});
const attempts = computed(() => {
  const seen = new Map<string, { attempt: number; station: string; sessionId: string; operationId?: string }>();
  for (const entry of run.value?.history ?? []) {
    if (!entry.sessionId) continue;
    const to = entry.to || entry.phase;
    const station = ["working", "worker_starting"].includes(to) ? "migrator" : to === "revising" || to === "revision_starting" ? "migrator" : to === "reviewing" || to === "review_starting" ? (run.value?.gate ?? "quality-gate") : undefined;
    if (!station) continue;
    seen.set(`${entry.sessionId}:${entry.operationId ?? ""}`, { attempt: entry.attempt ?? 0, station, sessionId: entry.sessionId, operationId: entry.operationId });
  }
  if (run.value?.execution) seen.set(`${run.value.execution.sessionId}:${run.value.execution.operationId}`, { attempt: run.value.execution.attempt, station: run.value.execution.station, sessionId: run.value.execution.sessionId, operationId: run.value.execution.operationId });
  return [...seen.values()].sort((a, b) => a.attempt - b.attempt);
});
function attemptLink(item: { station: string; sessionId: string; operationId?: string }) {
  const station = item.station === "revisions" ? "migrator" : item.station;
  // Eve tags events with its own message delivery id, not the factory delivery id; filter only when the host recorded one for this exact session.
  const execution = run.value?.execution;
  const eveDeliveryId = execution && execution.sessionId === item.sessionId && execution.operationId === item.operationId ? execution.deliveryId : undefined;
  return { path: "/work/run", query: { station, run: item.sessionId, rootAgent: station, ...(eveDeliveryId ? { deliveryId: eveDeliveryId } : {}), ...(item.operationId && station === "migrator" ? { operationId: item.operationId } : {}) } };
}
const briefLength = computed(() => props.brief.trim().length);
const briefReady = computed(() => briefLength.value >= MIN_WORK_REQUEST_LENGTH);
const canCompose = computed(() => props.mode === "compose" && !!props.draftId && !!props.repository && !!props.prototype);
const repoUrl = (repository?: string) => repository ? `https://github.com/${repository}` : "";
// Both gates approved the exact published head with no blocking finding, and nothing is merged yet.
const mergeable = computed(() => {
  const value = run.value;
  const head = value?.publication?.headSha;
  if (!value || !head || !["ready", "human_review"].includes(value.phase)) return false;
  return ["quality-gate", "security-gate"].every(gate => { const review = value.reviews?.[gate]; return review?.verdict === "approve" && review.headSha === head && !(review.findings ?? []).some(f => f.severity === "blocking"); });
});
async function approveMerge() {
  if (!run.value || !mergeable.value || merging.value || mergeReason.value.trim().length < 3) return;
  merging.value = true;
  error.value = "";
  try {
    run.value = await $fetch<Delivery>(`/factory/delivery/${encodeURIComponent(run.value.id)}/merge`, { method: "POST", body: { operationId: crypto.randomUUID(), reason: mergeReason.value.trim() }, retry: 0 });
    mergeReason.value = "";
  } catch {
    error.value = "The merge was not confirmed. Refresh: the pull request may still be open with your approval pending.";
  } finally {
    merging.value = false;
  }
}
function selectFlowNode(id: string) {
  const delivery = run.value;
  if (!delivery) return;
  const station = id === "worker" ? "migrator" : id === "review" ? "quality-gate" : id === "security" ? "security-gate" : undefined;
  const sessionId = station === "migrator" ? delivery.childSessionId || delivery.sessionId : station ? attempts.value.filter(item => item.station === station).at(-1)?.sessionId : undefined;
  if (!station || !sessionId) return;
  void router.push({ path: "/work/run", query: { station, run: sessionId, deliveryId: delivery.id, rootAgent: station } });
}

function historyPhase(entry: Delivery["history"][number]) {
  return describeDeliveryPhase(entry.to || entry.phase).label;
}
function historyAt(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function gateColor(value?: boolean) {
  return value === true ? "success" : value === false ? "error" : "neutral";
}
function gateLabel(value?: boolean) {
  return value === true ? "passed" : value === false ? "failed" : "not recorded";
}
function mergeColor(status?: string) {
  return status === "merged" ? "success" : status === "waiting" ? "warning" : "neutral";
}
function findingColor(severity: string) {
  return severity === "blocking" ? "error" : "warning";
}

async function remember(value: Delivery) {
  try {
    const row = cockpit.items.value.runs.find((item) => item.id === value.id);
    await cockpit.save("runs", value.id, { label: props.title || "Project", station: "loop" }, row?.version ?? 0);
  } catch {
    // Keep the authoritative delivery link even if its history index is unavailable.
  }
}

function schedule() {
  if (!disposed && run.value && !stopped.has(run.value.phase)) timer = setTimeout(() => void refresh(), 3000);
}

async function start() {
  if (!canCompose.value || working.value) return;
  working.value = true;
  error.value = "";
  operationId ??= crypto.randomUUID();
  try {
    run.value = await $fetch<Delivery>("/factory/delivery", { method: "POST", body: { operationId, draftId: props.draftId, title: props.title, brief: props.brief, repository: props.repository, prototype: props.prototype }, retry: 0 });
    emit("started", run.value);
    await router.replace({ path: "/work/run", query: { delivery: run.value.id } });
    await remember(run.value);
    operationId = undefined;
    schedule();
  } catch {
    error.value = "Could not confirm the loop start. Retry uses the same operation ID.";
  } finally {
    working.value = false;
  }
}

async function refresh() {
  if (!run.value || working.value) return;
  working.value = true;
  try {
    run.value = await $fetch<Delivery>(`/factory/delivery/${encodeURIComponent(run.value.id)}`, { retry: 0 });
    error.value = "";
  } catch {
    error.value = "Could not refresh this delivery. Reconnect to the same run.";
  } finally {
    working.value = false;
    schedule();
  }
}

async function submitOwnerAnswer(value = ownerAnswer.value) {
  const delivery = run.value;
  const question = pendingOwnerQuestion.value;
  const answer = value.trim();
  if (!delivery || !question || !answer || answeringOwner.value || working.value) return;
  answeringOwner.value = true;
  error.value = "";
  try {
    run.value = await $fetch<Delivery>(`/factory/delivery/${encodeURIComponent(delivery.id)}/answer`, {
      method: "POST",
      body: { operationId: question.operationId, answer },
      retry: 0,
    });
    ownerAnswer.value = "";
    schedule();
  } catch {
    error.value = "Could not send the answer. The migrator is still waiting for you.";
  } finally {
    answeringOwner.value = false;
  }
}

async function reconcile() {
  if (!run.value?.publication || reconciling.value) return;
  reconciling.value = true;
  try {
    reconciliation.value = await $fetch<ReconciliationResult>(`/factory/delivery/${encodeURIComponent(run.value.id)}/reconcile`, { retry: 0 });
    error.value = "";
  } catch {
    error.value = "Could not verify GitHub merge evidence. No delivery state was changed.";
  } finally {
    reconciling.value = false;
  }
}

async function resume() {
  if (!run.value || working.value) return;
  working.value = true;
  try {
    run.value = await $fetch<Delivery>(`/factory/delivery/${encodeURIComponent(run.value.id)}/resume`, { method: "POST", body: { operationId: operationId ??= crypto.randomUUID() }, retry: 0 });
    operationId = undefined;
    error.value = "";
    schedule();
  } catch {
    error.value = "Could not resume this delivery. The existing operation is retained.";
  } finally {
    working.value = false;
  }
}

function requestCancel() {
  if (!run.value || working.value || stopping.value) return;
  confirmStop.value = true;
}
async function cancel() {
  if (!run.value || working.value || stopping.value) return;
  confirmStop.value = false;
  stopping.value = true;
  clearTimeout(timer);
  try {
    run.value = await $fetch<Delivery>(`/factory/delivery/${encodeURIComponent(run.value.id)}/cancel`, { method: "POST", retry: 0 });
  } catch {
    error.value = "Cancellation is unconfirmed. Reconnect to check the same run.";
  } finally {
    stopping.value = false;
  }
}

async function revise() {
  if (!run.value || working.value) return;
  working.value = true;
  operationId ??= crypto.randomUUID();
  try {
    run.value = await $fetch<Delivery>(`/factory/delivery/${encodeURIComponent(run.value.id)}/revise`, { method: "POST", body: { operationId, brief: revision.value }, retry: 0 });
    operationId = undefined;
    revision.value = "";
    error.value = "";
    schedule();
  } catch {
    error.value = "Could not confirm the revision. Your request is retained.";
  } finally {
    working.value = false;
  }
}
function copyLabel(value: string) {
  return copiedEvidence.value === value ? "Copied" : "Copy";
}
async function copyEvidence(value: string) {
  try {
    if (!await copyText(value)) throw new Error("Clipboard unavailable");
    copiedEvidence.value = value;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copiedEvidence.value = undefined; }, 1800);
  } catch {
    error.value = "Could not copy that value. Expand the technical evidence to select it.";
  }
}

watch(() => route.query.delivery, async (id) => {
  clearTimeout(timer);
  if (typeof id !== "string") return;
  reconciliation.value = undefined;
  try {
    run.value = await $fetch<Delivery>(`/factory/delivery/${encodeURIComponent(id)}`);
    schedule();
  } catch {
    error.value = "Could not load this delivery. Keep its URL to retry.";
  }
}, { immediate: true });

onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
  clearTimeout(copyTimer);
});
</script>

<template>
  <section class="panel delivery-panel">
    <div class="panel-heading delivery-heading">
      <div>
        <p class="delivery-eyebrow"><UIcon name="i-lucide-workflow" aria-hidden="true" /> Project</p>
        <h2>{{ run?.request?.title || title || "Migrate a v0 prototype" }}</h2>
      </div>
      <div class="delivery-heading-badges">
        <UBadge :color="phaseInfo.color" variant="soft">{{ phaseInfo.label }}</UBadge>
        <UBadge v-if="run?.phase === 'blocked' && run.failure" :color="run.failure.retryable ? 'warning' : 'neutral'" variant="soft">
          {{ run.failure.kind }} · {{ run.failure.retryable ? 'retryable' : 'not retryable' }}
        </UBadge>
      </div>
    </div>
    <p class="delivery-path-label">Durable execution</p>
    <p class="delivery-intro">The host generates the target repository from the shell template and its Vercel project, then the migrator turns the v0 prototype into a Nuxt application and publishes one pull request from <code>dev</code> to <code>main</code> with a live preview. The quality gate and then the security gate review that exact head. Blocking findings return to the same branch owner for at most the configured number of revisions. When both gates approve, you approve here and the host merges into <code>main</code>.</p>
    <div v-if="run?.request?.brief" class="delivery-brief">
      <p class="delivery-brief-label">Brief</p>
      <p class="delivery-brief-text">{{ run.request.brief }}</p>
      <p class="small muted">
        <template v-if="run.request.prototype">Prototype <a :href="repoUrl(run.request.prototype.repository)" target="_blank" rel="noopener noreferrer">{{ run.request.prototype.repository }}</a> @ <code>{{ run.bootstrap?.prototype.revision?.slice(0, 10) || run.request.prototype.ref }}</code> · </template>
        <template v-if="run.request.repository">target <a :href="repoUrl(run.request.repository)" target="_blank" rel="noopener noreferrer">{{ run.request.repository }}</a></template>
        <template v-if="run.bootstrap"> · production <a :href="run.bootstrap.productionUrl" target="_blank" rel="noopener noreferrer">{{ run.bootstrap.productionUrl.replace('https://', '') }}</a></template>
      </p>
      <p v-if="run.bootstrap" class="small muted">Bootstrap: repository {{ run.bootstrap.created.repository ? 'generated from the template' : 'reused' }}, Vercel project {{ run.bootstrap.created.project ? 'created' : 'reused' }}, production {{ run.bootstrap.created.deployment ? 'deploy of main started' : 'already deployed' }}.<template v-if="run.bootstrap.warnings.length"> Warnings: {{ run.bootstrap.warnings.join(' ') }}</template></p>
    </div>
    <div v-if="run?.admission" class="delivery-brief admission">
      <p class="delivery-brief-label">Admission · {{ run.admission.kind }}</p>
      <p v-if="run.admission.outcome" class="delivery-brief-text">{{ run.admission.outcome }}</p>
      <ul v-if="run.admission.scope?.length" class="small"><li v-for="item in run.admission.scope" :key="item">{{ item }}</li></ul>
    </div>

    <ClientOnly>
      <CockpitFlow
        id="delivery-observability"
        title="Delivery workflow"
        :description="run ? 'Live phase and handoff state from the durable delivery snapshot.' : mode === 'compose' ? 'A preview of the handoffs that will be observed once you start a delivery.' : 'Select a delivery from Recent work to follow its live handoffs.'"
        :nodes="flowModel.nodes"
        :edges="flowModel.edges"
        :height="316"
        @select="selectFlowNode"
      />
      <template #fallback><div class="flow-loading" role="status">Loading workflow map…</div></template>
    </ClientOnly>

    <div v-if="run" class="delivery-live" role="status">
      <span class="delivery-live-dot" :class="`phase-${run.phase}`" aria-hidden="true" />
      <div><strong>{{ phaseInfo.label }}</strong><span>{{ phaseDetail }}</span></div>
      <span class="delivery-updated">{{ updatedLabel }}</span>
    </div>
    <fieldset v-if="pendingOwnerQuestion" class="decision owner-question" :class="{ focused: ownerAnswerFocus }">
      <legend>Waiting for you</legend>
      <p>{{ pendingOwnerQuestion.question }}</p>
      <div v-if="pendingOwnerQuestion.options?.length" class="owner-question-options">
        <UButton v-for="option in pendingOwnerQuestion.options" :key="option" variant="outline" :disabled="answeringOwner || working" @click="submitOwnerAnswer(option)">{{ option }}</UButton>
      </div>
      <UFormField label="Your answer" name="owner-answer">
        <UTextarea v-model="ownerAnswer" :rows="3" :maxlength="10000" placeholder="Answer the worker’s question…" :disabled="answeringOwner || working" />
      </UFormField>
      <UButton :disabled="!ownerAnswer.trim() || answeringOwner || working" :loading="answeringOwner" icon="i-lucide-send" @click="submitOwnerAnswer()">Send answer</UButton>
      <p class="small muted">The answer is recorded with your authenticated principal before the existing worker is resumed.</p>
    </fieldset>
    <p v-if="run" class="delivery-id">Delivery <code>{{ shortIdentifier(run.id) }}</code> · cycle {{ run.cycle }}<template v-if="run.publication?.targetBranch"> · target {{ shortIdentifier(run.publication.targetBranch, 24) }}</template></p>
    <p v-if="run && usageLabel" class="delivery-usage">Model usage · {{ usageLabel }}</p>
    <details v-if="run" class="technical-evidence">
      <summary>Technical evidence</summary>
      <dl>
        <div><dt>Delivery ID</dt><dd><code>{{ run.id }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(run.id)">{{ copyLabel(run.id) }}</UButton></dd></div>
        <div v-if="run.principalId"><dt>Principal</dt><dd><code>{{ run.principalId }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(run.principalId)">{{ copyLabel(run.principalId) }}</UButton></dd></div>
        <div v-if="run.request?.title"><dt>Request title</dt><dd>{{ run.request.title }}</dd></div>
        <div v-if="run.request?.parentPrNumber"><dt>Parent PR</dt><dd>#{{ run.request.parentPrNumber }}</dd></div>
        <div v-if="run.publication?.targetBranch"><dt>Target branch</dt><dd><code>{{ run.publication.targetBranch }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(run.publication.targetBranch)">{{ copyLabel(run.publication.targetBranch) }}</UButton></dd></div>
        <div v-if="run.publication?.ownerSessionId"><dt>Branch owner</dt><dd><code>{{ run.publication.ownerSessionId }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(run.publication.ownerSessionId)">{{ copyLabel(run.publication.ownerSessionId) }}</UButton></dd></div>
        <div v-if="run.publication?.branch"><dt>Published branch</dt><dd><code>{{ run.publication.branch }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(run.publication.branch)">{{ copyLabel(run.publication.branch) }}</UButton></dd></div>
        <div><dt>Cycle</dt><dd>{{ run.cycle }}</dd></div>
        <div v-if="run.usage?.factorySha"><dt>Factory SHA</dt><dd><code>{{ run.usage.factorySha }}</code></dd></div>
      </dl>
    </details>
    <div v-if="run?.mergeDecision" class="delivery-note delivery-decision"><UBadge :color="mergeColor(run.mergeDecision.status)" variant="soft">Merge decision · {{ run.mergeDecision.status }}</UBadge><span v-if="run.mergeDecision.reason">{{ run.mergeDecision.reason }}</span></div>
    <p v-if="run?.error" class="delivery-error" role="alert">{{ run.error }}</p>
    <section v-if="activity" class="station-activity" aria-labelledby="station-activity-heading">
      <div class="section-heading"><h3 id="station-activity-heading">What the station did</h3><span class="small muted">{{ activity.steps }} model steps · {{ activity.toolCalls }} tool calls<template v-if="activity.toolErrors"> · {{ activity.toolErrors }} failed</template><template v-if="activity.model"> · {{ activity.model }}</template></span></div>
      <dl class="activity-grid">
        <div v-if="activity.terminal"><dt>Session ended</dt><dd><code>{{ activity.terminal.type }}</code><template v-if="activity.terminal.at"> · {{ historyAt(activity.terminal.at) }}</template><template v-if="activity.terminal.code"> · {{ activity.terminal.code }}</template><span v-if="activity.terminal.message"> · {{ activity.terminal.message }}</span></dd></div>
        <div v-else-if="activity.lastEventAt"><dt>Last event</dt><dd>{{ historyAt(activity.lastEventAt) }} ({{ relativeTime(activity.lastEventAt) }})</dd></div>
        <div v-if="activity.lastError" class="activity-error"><dt>Last failing tool</dt><dd><code>{{ activity.lastError.toolName }}</code> · {{ activity.lastError.message }}</dd></div>
        <div v-if="activity.lastTool"><dt>Last tool</dt><dd><code>{{ activity.lastTool.toolName }}</code> · {{ activity.lastTool.outcome === 'ok' ? 'finished' : activity.lastTool.outcome === 'error' ? 'failed' : 'running' }}<template v-if="activity.lastTool.input"> · <span class="muted">{{ activity.lastTool.input }}</span></template><template v-if="activity.lastTool.summary"> → {{ activity.lastTool.summary }}</template></dd></div>
      </dl>
      <blockquote v-if="activity.finalMessage" class="agent-words"><p class="small muted">The agent's own closing words (model text, not host evidence):</p><p>{{ activity.finalMessage }}</p></blockquote>
      <p v-if="currentAttempt" class="small"><NuxtLink :to="attemptLink(currentAttempt)">Open the full tool timeline of this station run</NuxtLink></p>
    </section>
    <section v-if="attempts.length" class="review-evidence" aria-labelledby="attempts-heading">
      <div class="section-heading"><h3 id="attempts-heading">Attempts</h3><span class="small muted">{{ attempts.length }} station runs</span></div>
      <ul class="attempt-list">
        <li v-for="item in attempts" :key="`${item.sessionId}:${item.operationId}`"><NuxtLink :to="attemptLink(item)">Attempt {{ item.attempt }} · {{ item.station }} · <code>{{ shortIdentifier(item.sessionId, 18) }}</code></NuxtLink></li>
      </ul>
    </section>

    <section v-if="gateReviews.length" class="review-evidence" aria-labelledby="delivery-review-heading">
      <div class="section-heading"><h3 id="delivery-review-heading">Gate verdicts</h3><span class="small muted">Verdict applies to head <code>{{ run?.review?.headSha || run?.publication?.headSha }}</code>{{ run?.merge ? '; merged after approval' : '; nothing merged until you approve' }}.</span></div>
      <div v-for="[gate, review] in gateReviews" :key="gate" class="gate-verdict">
        <div class="review-gates" :aria-label="`${gate} verification`">
          <UBadge color="neutral" variant="soft">{{ gate }} · {{ review.verdict }}</UBadge>
          <template v-if="review.verification">
            <UBadge :color="gateColor(review.verification.prepared)" variant="soft">Prepared · {{ gateLabel(review.verification.prepared) }}</UBadge>
            <UBadge :color="gateColor(review.verification.repositoryChecksPassed)" variant="soft">Checks · {{ gateLabel(review.verification.repositoryChecksPassed) }}</UBadge>
            <UBadge :color="gateColor(review.verification.candidateUnchanged)" variant="soft">Head unchanged · {{ gateLabel(review.verification.candidateUnchanged) }}</UBadge>
          </template>
        </div>
        <p class="delivery-note">{{ review.summary }}</p>
      </div>
      <div class="review-findings">
        <h4>Findings · blocking first</h4>
        <UCard v-for="(finding, index) in allFindings" :key="`${finding.path}-${finding.line || 'file'}-${index}`" class="review-finding">
          <UBadge :color="findingColor(finding.severity)" variant="soft">{{ finding.severity }} · {{ finding.gate }}</UBadge>
          <h4>{{ finding.path }}<span v-if="finding.line">:{{ finding.line }}</span></h4>
          <p>{{ finding.message }}</p>
          <p class="small">Evidence: {{ finding.evidence }}</p>
        </UCard>
        <p v-if="!allFindings.length" class="small muted">No findings were recorded.</p>
      </div>
      <div v-if="allLimitations.length" class="review-limitations">
        <h4>Limitations</h4>
        <ul><li v-for="limitation in allLimitations" :key="limitation">{{ limitation }}</li></ul>
      </div>
    </section>

    <section v-if="run?.history?.length" class="phase-timeline" aria-labelledby="phase-timeline-heading">
      <div class="section-heading"><h3 id="phase-timeline-heading">Phase timeline</h3><span class="small muted">{{ run.history.length }} transitions</span></div>
      <ol>
        <li v-for="(entry, index) in run.history" :key="entry.receiptId || `${entry.at || 'phase'}-${index}`">
          <span class="timeline-dot" aria-hidden="true" />
          <div class="timeline-entry">
            <div class="timeline-heading"><strong>{{ historyPhase(entry) }}</strong><time v-if="entry.at" :datetime="entry.at">{{ historyAt(entry.at) }}</time></div>
            <p v-if="entry.reason">{{ entry.reason }}</p>
            <p class="small muted"><span v-if="entry.actor">Actor <code>{{ entry.actor }}</code></span><span v-if="entry.sessionId"> · Session <code>{{ shortIdentifier(entry.sessionId, 18) }}</code></span><span v-if="entry.receiptId"> · Receipt <code>{{ shortIdentifier(entry.receiptId, 18) }}</code></span></p>
          </div>
        </li>
      </ol>
    </section>

    <div class="delivery-actions" :data-attention="attention" aria-label="Actions for this project">
      <UButton v-if="canCompose && !run" :disabled="!title.trim() || !briefReady || working || stopping" :loading="working" icon="i-lucide-play" @click="start">Start migration</UButton>
      <UButton v-if="attention === 'blocked'" color="warning" :disabled="working" icon="i-lucide-rotate-ccw" @click="resume">Resume</UButton>
      <UButton v-if="attention === 'flawed'" :disabled="working" icon="i-lucide-message-square-more" @click="revisionFocus = true">Request revision</UButton>
      <UButton v-if="attention === 'waiting'" icon="i-lucide-message-circle-reply" @click="ownerAnswerFocus = true">Answer</UButton>
      <UButton v-if="mergeable" color="success" icon="i-lucide-git-merge" :disabled="merging" @click="mergeFocus = true">Approve and merge</UButton>
      <UButton v-if="run?.merge && run.bootstrap" :to="run.bootstrap.productionUrl" target="_blank" rel="noopener noreferrer" icon="i-lucide-rocket">Open production</UButton>
      <UButton v-if="attention === 'ready' && run?.publication" :to="run.publication.url" target="_blank" rel="noopener noreferrer" icon="i-lucide-git-pull-request">Open PR #{{ run.publication.number }}</UButton>
      <UButton v-else-if="run?.publication" :to="run.publication.url" target="_blank" rel="noopener noreferrer" variant="outline" icon="i-lucide-git-pull-request">PR #{{ run.publication.number }}</UButton>
      <UButton v-if="run?.publication?.preview?.url && run.publication.preview.state === 'success'" :to="run.publication.preview.url" target="_blank" rel="noopener noreferrer" variant="outline" icon="i-lucide-globe">Open preview</UButton>
      <span v-else-if="run?.publication?.preview" class="small muted">Preview {{ run.publication.preview.state }}</span>
      <UButton v-if="run?.publication && reconcilable.has(run.phase)" variant="outline" :loading="reconciling" :disabled="working || reconciling" icon="i-lucide-shield-check" @click="reconcile">Check manual merge</UButton>
      <UButton v-if="run && attention !== 'blocked'" variant="outline" :loading="working" icon="i-lucide-refresh-cw" @click="refresh">Refresh</UButton>
      <UButton v-if="run && !stopped.has(run.phase)" variant="outline" color="error" :loading="stopping" :disabled="working || stopping" @click="requestCancel">Stop</UButton>
    </div>
    <p v-if="run" class="small muted">Attention: <strong>{{ attention }}</strong>. Verdicts apply to head <code>{{ run.publication?.headSha || 'not published' }}</code>{{ run.merge ? `; merged into ${run.merge.targetBranch} as ${run.merge.commitSha.slice(0, 10)} after ${run.merge.approvedBy} approved` : '; the host merges only after your approval' }}.</p>
    <fieldset v-if="mergeable" class="decision merge-approval" :class="{ focused: mergeFocus }">
      <legend>Approve the merge</legend>
      <p class="small">Both gates approved head <code>{{ run?.publication?.headSha?.slice(0, 12) }}</code>. Open the preview first; on approval the host squash-merges PR #{{ run?.publication?.number }} into <code>{{ run?.publication?.targetBranch }}</code> and Vercel deploys production.</p>
      <UFormField label="Reason (recorded on the receipt)" name="merge-reason"><UInput v-model="mergeReason" :maxlength="1000" placeholder="Preview checked: board renders with my identity, cards persist…" /></UFormField>
      <UButton color="success" icon="i-lucide-git-merge" :loading="merging" :disabled="merging || mergeReason.trim().length < 3" @click="approveMerge">Merge into {{ run?.publication?.targetBranch }}</UButton>
    </fieldset>
    <UModal
      :open="confirmStop"
      title="Stop this delivery?"
      description="The workflow will be cancelled. Its saved request and evidence remain available."
      @update:open="(value) => { confirmStop = value; }"
    >
      <template #body>
        <p class="small muted">Stopping ends the current durable attempt and cancels its active stations. You can keep the run link to inspect the recorded phases.</p>
        <div class="confirm-actions">
          <UButton color="error" :loading="stopping" :disabled="stopping" @click="cancel">Stop delivery</UButton>
          <UButton variant="ghost" color="neutral" :disabled="stopping" @click="confirmStop = false">Keep running</UButton>
        </div>
      </template>
    </UModal>
    <UAlert v-if="reconciliation" :color="reconciliation.eligible ? 'success' : 'warning'" variant="soft" title="Manual merge evidence" :description="reconciliation.reason" />
    <p v-if="mode === 'compose'" class="delivery-requirement" :class="{ ready: briefReady }" role="status">A durable delivery needs at least {{ MIN_WORK_REQUEST_LENGTH }} characters in the brief ({{ briefLength }}/{{ MIN_WORK_REQUEST_LENGTH }}).</p>
    <p v-if="error" class="delivery-error" role="alert">{{ error }}</p>

    <details v-if="run" class="technical-evidence missing-capabilities">
      <summary>Not in this factory (v1)</summary>
      <ul><li v-for="item in missingCapabilities" :key="item">{{ item }}</li></ul>
    </details>

    <div v-if="run && ['ready', 'human_review', 'blocked', 'needs_revision'].includes(run.phase)" class="revision-request" :class="{ focused: revisionFocus }">
      <UFormField label="Request the next revision" name="revision">
        <UTextarea v-model="revision" :rows="3" placeholder="Describe what the branch owner should address…" />
      </UFormField>
      <UButton :disabled="revision.trim().length < 20 || working" :loading="working" icon="i-lucide-message-square-more" @click="revise">Request revision</UButton>
    </div>
  </section>
</template>

<style scoped>
.delivery-panel { padding: 24px; margin-top: 24px; }
.delivery-heading { margin-bottom: 8px; }
.delivery-heading-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.delivery-heading h2 { margin: 0; font-size: 22px; font-weight: 600; text-wrap: balance; }
.delivery-eyebrow { display: flex; align-items: center; gap: 7px; margin: 0 0 7px; color: var(--ui-primary); font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; }
.delivery-intro { max-width: 850px; margin: 0; color: var(--ui-text-muted); line-height: 1.65; }
.delivery-brief { margin-top: 18px; padding: 14px 16px; border-left: 3px solid var(--ui-primary); background: #f5fbfb; }
.delivery-brief-label { margin: 0 0 5px; color: var(--ui-primary); font-size: 10px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
.delivery-brief-text { margin: 0; color: var(--ui-text); line-height: 1.6; white-space: pre-wrap; }
.delivery-path-label { margin: 18px 0 6px; color: var(--ui-primary); font-size: 10px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
.delivery-requirement { margin: 10px 0 0; color: #a33d37; font-size: 12px; }
.delivery-requirement.ready { color: #28765b; }
.flow-loading { display: grid; min-height: 180px; margin: 24px 0; place-items: center; border: 1px solid var(--ui-border); border-radius: 8px; color: var(--ui-text-muted); font-size: 12px; }
.delivery-live { display: flex; align-items: center; gap: 11px; margin: 20px 0 0; padding: 12px 14px; border: 1px solid #dce9e9; border-radius: 6px; background: #f5fbfb; }
.delivery-live-dot { width: 9px; height: 9px; flex-shrink: 0; border-radius: 50%; background: #a6b5b8; }
.delivery-live-dot.phase-working, .delivery-live-dot.phase-reviewing, .delivery-live-dot.phase-revising, .delivery-live-dot.phase-worker_starting, .delivery-live-dot.phase-review_starting, .delivery-live-dot.phase-revision_starting, .delivery-live-dot.phase-owner_resuming, .delivery-live-dot.phase-merging { background: var(--ui-primary); box-shadow: 0 0 0 4px rgba(0, 127, 140, 0.1); }
.delivery-live-dot.phase-human_review, .delivery-live-dot.phase-needs_revision { background: #bb7410; }
.delivery-live-dot.phase-awaiting_input { background: #bb7410; box-shadow: 0 0 0 4px rgba(187, 116, 16, 0.1); }
.delivery-live-dot.phase-blocked, .delivery-live-dot.phase-cancelled { background: #bf4c43; }
.delivery-live div { display: grid; gap: 2px; min-width: 0; }
.delivery-live strong { color: #2d545c; font-size: 12px; }
.delivery-live div span { overflow: hidden; color: var(--ui-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.delivery-updated { margin-left: auto; flex-shrink: 0; color: var(--ui-text-muted); font-size: 11px; }
.delivery-id, .delivery-note, .delivery-error { margin: 14px 0 0; font-size: 12px; line-height: 1.6; }
.station-activity { margin-top: 18px; padding: 14px 16px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-bg-muted); }
.activity-grid { display: grid; gap: 8px; margin: 10px 0 0; font-size: 12px; }
.activity-grid div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 10px; align-items: baseline; }
.activity-grid dt { color: var(--ui-text-muted); }
.activity-grid dd { margin: 0; overflow-wrap: anywhere; }
.activity-error dd { color: #a33d37; }
.agent-words { margin: 12px 0 0; padding: 10px 14px; border-left: 3px solid var(--ui-border); }
.agent-words p { margin: 0; white-space: pre-wrap; font-size: 12px; line-height: 1.6; }
.agent-words p + p { margin-top: 6px; }
.delivery-usage { margin: 8px 0 0; color: var(--ui-text-muted); font-size: 12px; }
.delivery-id { color: var(--ui-text-muted); overflow-wrap: anywhere; }
.technical-evidence { margin: 16px 0 0; padding: 12px 14px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-bg-muted); font-size: 12px; }
.technical-evidence summary { cursor: pointer; font-weight: 600; }
.technical-evidence dl { display: grid; gap: 9px; margin: 12px 0 0; }
.technical-evidence dl div { display: grid; grid-template-columns: 110px minmax(0, 1fr); align-items: center; gap: 10px; }
.technical-evidence dt { color: var(--ui-text-muted); }
.technical-evidence dd { display: flex; min-width: 0; align-items: center; gap: 8px; margin: 0; overflow-wrap: anywhere; }
.technical-evidence code { overflow-wrap: anywhere; }
.delivery-note { color: #53666e; }
.delivery-decision { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.owner-question { display: grid; gap: 12px; margin: 20px 0 0; border: 1px solid var(--ui-border); padding: 18px; }
.owner-question legend { padding: 0 8px; font-weight: 600; }
.owner-question p { margin: 0; }
.owner-question-options { display: flex; gap: 8px; flex-wrap: wrap; }
.delivery-error { color: #a33d37; }
.delivery-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
.review-evidence, .phase-timeline { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--ui-border); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-heading h3, .review-findings h4, .review-limitations h4 { margin: 0; color: var(--ui-text); font-size: 15px; font-weight: 650; }
.review-gates { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.review-findings { display: grid; gap: 12px; margin-top: 18px; }
.review-findings h4, .review-limitations h4 { font-size: 13px; }
.review-finding { display: grid; gap: 5px; }
.review-finding h4 { margin: 4px 0 0; font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.review-finding p { margin: 0; line-height: 1.55; }
.review-limitations { margin-top: 18px; }
.review-limitations ul { margin: 10px 0 0; padding-left: 20px; list-style: disc; }
.phase-timeline ol { display: grid; gap: 0; margin: 16px 0 0; padding: 0; list-style: none; }
.phase-timeline li { position: relative; display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 12px; padding-bottom: 18px; }
.phase-timeline li:not(:last-child)::before { position: absolute; top: 12px; bottom: 0; left: 5px; width: 1px; background: #cbdadc; content: ""; }
.timeline-dot { position: relative; z-index: 1; width: 10px; height: 10px; margin-top: 3px; border: 2px solid var(--ui-primary); border-radius: 50%; background: #fff; }
.timeline-entry { min-width: 0; }
.timeline-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.timeline-heading strong { color: #2d545c; font-size: 12px; }
.timeline-heading time { flex-shrink: 0; color: var(--ui-text-muted); font-size: 11px; }
.timeline-entry p { margin: 5px 0 0; line-height: 1.5; }
.confirm-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
.revision-request.focused, .owner-question.focused { outline: 2px solid var(--ui-primary); outline-offset: 4px; }
.attempt-list { margin: 12px 0 0; padding-left: 20px; list-style: disc; }
.attempt-list a { color: var(--ui-primary); text-decoration: underline; }
.gate-verdict { margin-top: 12px; }
.missing-capabilities ul { margin: 10px 0 0; padding-left: 20px; list-style: disc; }
.revision-request { display: grid; gap: 12px; max-width: 700px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--ui-border); }
@media (max-width: 700px) {
  .delivery-live { align-items: flex-start; flex-wrap: wrap; }
  .delivery-updated { width: 100%; margin-left: 20px; }
}
</style>
