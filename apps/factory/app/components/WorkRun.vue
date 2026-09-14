<script setup lang="ts">
import { useEveAgent, defaultMessageReducer, type EveMessageData } from "eve/vue";
import type { MessageStreamEvent } from "eve/client";
import { triggerRef } from "vue";
import { dispatchedTask, parseStationToolResult, pendingStationRequests, matchesStationDelivery, advanceStationTurn, appendStationTail, boundStationProjection, eventToolId, readStationStream, type StationKind, type StationTurn } from "../utils/work-station";
import { stationFlow } from "../utils/observability-flow";
import { copyText, shortIdentifier } from "../utils/technical-details";
import { formatModelUsage } from "../utils/model-usage.ts";
import { modelUsageFromEvents } from "../../runtime/lib/delivery-events.ts";
const props = defineProps<{ sessionId: string; station: StationKind; child?: boolean; awaitingDecision?: boolean; execution?: "owner" | "dispatcher" | "direct"; rootAgent?: "migrator" | "quality-gate" | "security-gate"; deliveryId?: string; operationId?: string }>();
const emit = defineEmits<{ settled: [value: boolean]; recorded: [value: boolean] }>();
const { data, events, status, error, resume, respond } = useEveAgent({ host: import.meta.client && props.rootAgent ? `${window.location.origin}/${props.rootAgent}` : undefined, initialSession: { sessionId: props.sessionId, streamIndex: 0 }, resume: true });
const actionError = ref("");
const copiedEvidence = ref<string>();
let copyTimer: ReturnType<typeof setTimeout> | undefined;
const childSettled = ref(false);
const deliveryStarted = ref(false);
const queuedForOwner = computed(() => !!props.deliveryId && !deliveryStarted.value);
const runLink = computed(() => `/work/run?${new URLSearchParams({ station: props.station, ...(props.rootAgent?{rootAgent:props.rootAgent}:{}), run: props.sessionId, ...(props.execution ? { execution: props.execution } : {}), ...(props.deliveryId ? { deliveryId: props.deliveryId } : {}), ...(props.operationId ? { operationId: props.operationId } : {}) })}`);
const childRecorded = ref(false);
const cancellationRequested = ref(false);
const confirmStop = ref(false);
const stopping = ref(false);
const discoveredChild = ref<string>();
const discoveryError = ref(false);
let discovery: AbortController | undefined;
const tailData = shallowRef<EveMessageData>();
const tailEvents = shallowRef<MessageStreamEvent[]>([]);
const tailTurn = ref<StationTurn>("unknown");
const answering = ref<string>();
const freeformAnswers = ref<Record<string, string>>({});
const parts = computed(() => (tailData.value || data.value).messages.flatMap(message => message.parts));
const pendingRequests = computed(() => pendingStationRequests(tailData.value || data.value, !!result.value || childRecorded.value));
const needsDecision = computed(() => !result.value && !childRecorded.value && (!!props.awaitingDecision || pendingRequests.value.length > 0));
const childId = computed(() => {
  if (props.child || props.execution === "owner" || props.execution === "direct") return undefined;
  const event = events.value.find(event => event.type === "subagent.called");
  return discoveredChild.value || (event?.type === "subagent.called" ? event.data.childSessionId : undefined);
});
const taskId = computed(() => {
  const part = parts.value.find(part => part.type === "dynamic-tool" && part.toolName === props.station && dispatchedTask(part.output));
  return part?.type === "dynamic-tool" ? dispatchedTask(part.output) : undefined;
});
const awaitingChild = computed(() => !props.child && !!taskId.value && !childId.value && !stopped.value);
async function followChild() {
  if (discovery) return;
  const controller = new AbortController();
  discovery = controller;
  discoveryError.value = false;
  try {
    const reducer = defaultMessageReducer();
    tailData.value = reducer.initial();
    tailEvents.value = [];
    tailTurn.value = "unknown";
    deliveryStarted.value = false;
    // A background task may emit subagent.called after the dispatcher's turn ends.
    // The chat composable stops at that boundary; follow the durable tail directly.
    for await (const event of readStationStream(props.sessionId, controller.signal)) {
      if (props.deliveryId) {
        if (!matchesStationDelivery(event, props.deliveryId, deliveryStarted.value)) continue;
        deliveryStarted.value = true;
      }
      appendStationTail(tailEvents.value, event);
      triggerRef(tailEvents);
      tailTurn.value = advanceStationTurn(tailTurn.value, event);
      tailData.value = boundStationProjection(reducer.reduce(tailData.value, event), props.station, props.operationId);
      if (event.type === "subagent.called" && event.data.name === props.station) {
        discoveredChild.value = event.data.childSessionId;
      }
    }
    if (!controller.signal.aborted && !result.value && !stopped.value) discoveryError.value = true;
  } catch { if (!controller.signal.aborted && !result.value && !stopped.value) discoveryError.value = true; }
  finally { controller.abort(); discovery = undefined; }
}
onMounted(() => { void followChild(); });
onBeforeUnmount(() => { discovery?.abort(); clearTimeout(copyTimer); });
const result = computed(() => {
  for (const part of [...parts.value].reverse()) {
    if (part.type !== "dynamic-tool" || part.state !== "output-available") continue;
    const parsed = parseStationToolResult(part.toolName, part.output, props.operationId);
    if (parsed && parsed.station === props.station) return parsed;
  }
  return undefined;
});
const turn = computed(() => tailData.value ? tailTurn.value : events.value.reduce(advanceStationTurn, "unknown"));
const active = computed(() => turn.value === "running" || (!tailData.value && ["submitted", "streaming", "resuming"].includes(status.value)));
const stopped = computed(() => turn.value === "cancelled");
const ended = computed(() => ["completed", "failed"].includes(turn.value));
watch(() => !!result.value, value => emit("recorded", value), { immediate: true });
watch(() => !!result.value || (!needsDecision.value && (stopped.value || (ended.value && !active.value))), value => emit("settled", value), { immediate: true });
const canStop = computed(() => !props.child && !stopping.value && !queuedForOwner.value && !result.value && !childRecorded.value && (needsDecision.value || (childId.value ? !childSettled.value : !stopped.value && (!!taskId.value || (active.value && !ended.value)))));
const authorizations = computed(() => parts.value.filter(part => part.type === "authorization" && part.state === "required"));
const step = computed(() => {
  const part = parts.value.filter(part => part.type === "dynamic-tool").at(-1);
  return part?.toolName.replaceAll("_", " ") || "Preparing the station";
});
const summary = computed(() => (tailData.value || data.value).messages.filter(message => message.role === "assistant").flatMap(message => message.parts.flatMap(part => part.type === "text" ? [part.text] : [])).join("\n"));
const usageEvents = computed(() => props.deliveryId ? tailEvents.value : events.value);
const usageLabel = computed(() => formatModelUsage(modelUsageFromEvents(usageEvents.value)));
const tailEventRows = computed(() => tailEvents.value.map((event, index) => ({ event, index, toolId: eventToolId(event) })));
const toolActivities = computed(() => parts.value.filter((part): part is Extract<typeof part, { type: "dynamic-tool" }> => part.type === "dynamic-tool").map((part, index) => ({ id: `tool-${index}-${part.toolName}`, toolName: part.toolName, state: part.state })));
function authorizationLink(value: string | undefined) {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : undefined; } catch { return undefined; }
}
const stationTitle = computed(() => props.station === "migrator" ? "Migrator" : props.station === "quality-gate" ? "Quality gate" : "Security gate");
const flowModel = computed(() => stationFlow({
  station: props.station,
  active: active.value,
  ended: ended.value,
  stopped: stopped.value,
  needsDecision: needsDecision.value,
  awaitingAuthorization: authorizations.value.length > 0,
  result: result.value ? { verdict: result.value.station !== "migrator" ? result.value.verdict : undefined, summary: result.value.summary } : undefined,
  taskId: taskId.value,
  execution: props.execution,
  child: props.child,
  tools: toolActivities.value,
}));
const label = computed(() => result.value ? result.value.station === "migrator" ? props.execution === "owner" ? "PR revised" : "Draft PR created" : result.value.verdict === "approve" ? "Gate passed" : result.value.verdict === "changes_requested" ? "Changes requested" : "Gate incomplete" : queuedForOwner.value ? "Queued for branch owner" : needsDecision.value ? "Awaiting decision" : stopped.value ? "Stopped" : awaitingChild.value ? "Station dispatched" : authorizations.value.length ? "Connection needed" : active.value ? "Running" : ended.value ? "Incomplete" : "Disconnected");
watch(() => props.awaitingDecision, (waiting, previous) => {
  if (props.child && previous && !waiting && !result.value && !active.value) void reconnect();
});
async function reconnect() { try { actionError.value = ""; if (discoveryError.value || !discovery) await followChild(); else await resume(); } catch { actionError.value = "Could not reconnect. Keep the run link to try again."; } }
async function answer(requestId: string, optionId: string) {
  if (answering.value) return;
  answering.value = requestId;
  try {
    await respond([{ requestId, optionId }]);
  } catch { answering.value = undefined; actionError.value = "Could not submit the decision. Reconnect before trying again."; }
}
async function answerFreeform(requestId: string) {
  const text = freeformAnswers.value[requestId]?.trim();
  if (!text || answering.value) return;
  answering.value = requestId;
  try {
    await respond([{ requestId, text }]);
    freeformAnswers.value[requestId] = "";
  } catch { answering.value = undefined; actionError.value = "Could not submit the answer. Reconnect before trying again."; }
}
watch(pendingRequests, requests => { if (!requests.some(request => request.requestId === answering.value)) answering.value = undefined; });
function requestStop() {
  if (stopping.value || !canStop.value) return;
  confirmStop.value = true;
}
async function stop() {
  if (stopping.value || !canStop.value) return;
  confirmStop.value = false;
  stopping.value = true;
  actionError.value = "";
  try {
    await $fetch(`/eve/v1/session/${props.sessionId}/cancel`, { method: "POST", body: { tasks: true } });
    cancellationRequested.value = true;
  } catch { actionError.value = "Cancellation could not be confirmed. Reconnect to check the run."; }
  finally { stopping.value = false; }
}
function copyLabel(value: string) {
  return copiedEvidence.value === value ? "Copied" : "Copy";
}
function stringifyEventData(value: unknown) {
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}
async function copyEvidence(value: string) {
  try {
    if (!await copyText(value)) throw new Error("Clipboard unavailable");
    copiedEvidence.value = value;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copiedEvidence.value = undefined; }, 1800);
  } catch {
    actionError.value = "Could not copy that value. Select it from the technical evidence instead.";
  }
}
</script>
<template>
  <div :class="{ 'panel station-run': !child }">
    <template v-if="!childId">
      <div class="run-heading"><h2>{{ stationTitle }}</h2><div class="run-heading-meta"><UBadge :color="result && (result.station === 'migrator' || result.verdict === 'approve') ? 'success' : 'neutral'" variant="soft">{{ label }}</UBadge><span v-if="usageLabel" class="run-usage" aria-label="Model usage">{{ usageLabel }}</span></div></div>
      <p v-if="queuedForOwner" role="status">Waiting for the existing branch owner to begin this revision. Earlier results belong to earlier work.</p>
      <p v-else-if="awaitingChild" role="status">Waiting for the {{ stationTitle.toLowerCase() }} session. The task has been dispatched.</p>
      <p v-else-if="active && !result && !authorizations.length && !needsDecision" role="status">{{ step }}…</p>
      <div v-for="authorization in authorizations" :key="`${authorization.name}-${authorization.stepIndex}`"><p>{{ authorization.description }}</p><p>{{ authorization.authorization?.instructions }}</p><code v-if="authorization.authorization?.userCode">{{ authorization.authorization.userCode }}</code><UButton v-if="authorizationLink(authorization.authorization?.url)" :to="authorizationLink(authorization.authorization?.url)" target="_blank" rel="noopener noreferrer">Connect {{ authorization.displayName }}</UButton></div>
      <CockpitFlow
        :id="`station-${sessionId}-${child ? 'child' : 'root'}`"
        :title="`${stationTitle} activity`"
        description="Live stages derived from the Eve event stream. The highlighted action is what this station is doing now."
        :nodes="flowModel.nodes"
        :edges="flowModel.edges"
      />
      <details v-if="tailEventRows.length" class="tail-events">
        <summary>Recent event tail · {{ tailEventRows.length }} events</summary>
        <ol>
          <li v-for="row in tailEventRows" :key="`${row.event.meta?.id || row.event.meta?.at || 'event'}-${row.index}`">
            <div class="tail-event-heading"><code>{{ row.event.type }}</code><span>tool id <code>{{ row.toolId || 'unpaired' }}</code></span><time :datetime="row.event.meta?.at">{{ row.event.meta?.at }}</time></div>
            <pre>{{ stringifyEventData(row.event) }}</pre>
          </li>
        </ol>
      </details>
        <template v-if="result">
        <p>{{ result.summary }}</p>
        <template v-if="result.station === 'migrator'"><UButton :to="result.publication.url" target="_blank" rel="noopener noreferrer" icon="i-lucide-git-pull-request">Open {{ execution === 'owner' ? 'PR' : 'draft PR' }} #{{ result.publication.number }}</UButton><p class="small muted">Branch <code>{{ shortIdentifier(result.publication.branch, 24) }}</code> · head <code>{{ shortIdentifier(result.publication.headSha) }}</code> · base <code>{{ shortIdentifier(result.publication.baseSha) }}</code></p><details class="technical-evidence"><summary>Technical evidence</summary><dl><div><dt>Branch</dt><dd><code>{{ result.publication.branch }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(result.publication.branch)">{{ copyLabel(result.publication.branch) }}</UButton></dd></div><div><dt>Head SHA</dt><dd><code>{{ result.publication.headSha }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(result.publication.headSha)">{{ copyLabel(result.publication.headSha) }}</UButton></dd></div><div><dt>Base SHA</dt><dd><code>{{ result.publication.baseSha }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(result.publication.baseSha)">{{ copyLabel(result.publication.baseSha) }}</UButton></dd></div><div v-if="result.publication.targetBranch"><dt>PR target</dt><dd><code>{{ result.publication.targetBranch }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(result.publication.targetBranch)">{{ copyLabel(result.publication.targetBranch) }}</UButton></dd></div><div v-if="result.publication.parentPrNumber"><dt>Parent PR</dt><dd>#{{ result.publication.parentPrNumber }}</dd></div><div v-if="result.publication.ownerSessionId"><dt>Branch owner session</dt><dd><code>{{ result.publication.ownerSessionId }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(result.publication.ownerSessionId)">{{ copyLabel(result.publication.ownerSessionId) }}</UButton></dd></div></dl></details><p class="small muted">The quality gate and the security gate review this head independently.</p></template>
        <template v-else><p><a class="review-pr-link" :href="result.url" target="_blank" rel="noopener noreferrer">PR #{{ result.prNumber }}</a> · Reviewed head <code>{{ shortIdentifier(result.headSha) }}</code></p><p class="small muted">{{ result.capturedAt }} · Verdict applies to head <code>{{ result.headSha }}</code>; no merge was performed.</p><p v-if="result.attributions?.length" class="small muted">Check attribution: <span v-for="a in result.attributions" :key="a.command"><code>{{ a.command }}</code> exit {{ a.exitCode }} ({{ a.attribution }}) </span></p><p v-if="result.testCounts" class="small muted">Unit tests · base {{ result.testCounts.base ?? '?' }} · head {{ result.testCounts.head ?? '?' }}</p><details class="technical-evidence"><summary>Technical evidence</summary><dl><div><dt>Reviewed head SHA</dt><dd><code>{{ result.headSha }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(result.headSha)">{{ copyLabel(result.headSha) }}</UButton></dd></div><div><dt>Base SHA</dt><dd><code>{{ result.baseSha }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(result.baseSha)">{{ copyLabel(result.baseSha) }}</UButton></dd></div><div v-if="result.targetBranch"><dt>PR target</dt><dd><code>{{ result.targetBranch }}</code><UButton size="xs" variant="ghost" @click="copyEvidence(result.targetBranch)">{{ copyLabel(result.targetBranch) }}</UButton></dd></div></dl></details><UCard v-for="(finding, index) in [...result.findings].sort((a, b) => Number(b.severity === 'blocking') - Number(a.severity === 'blocking'))" :key="index" class="review-finding"><UBadge :color="finding.severity === 'blocking' ? 'error' : 'neutral'" variant="soft">{{ finding.severity }}</UBadge><h3>{{ finding.path }}<span v-if="finding.line">:{{ finding.line }}</span></h3><p>{{ finding.message }}</p><p class="small">Evidence: {{ finding.evidence }}</p></UCard><p v-if="!result.findings.length">No findings were recorded.</p><ul v-if="result.limitations.length"><li v-for="item in result.limitations" :key="item">{{ item }}</li></ul></template>
        <details class="checks"><summary>Command evidence · {{ result.commands.length }} checks</summary><details v-for="(command, index) in result.commands" :key="index"><summary><code>{{ command.command }}</code> · exit {{ command.exitCode }}<template v-if="command.digest"> · digest <code>{{ shortIdentifier(command.digest) }}</code></template></summary><p v-if="command.truncated" class="small muted">Output is truncated.</p><pre>{{ command.stdout }}</pre><pre v-if="command.stderr">{{ command.stderr }}</pre></details></details>
      </template>
      <p v-else-if="!active && summary" class="summary">{{ summary }}</p>
      <UAlert v-if="!result && !active && ended && !stopped && !awaitingChild && !needsDecision" color="warning" title="No completed result" description="The station ended without a recorded PR or review result. Inspect the run before trying again." />
      <UButton v-if="!result && (error || discoveryError || (!active && !ended && !stopped))" variant="outline" @click="reconnect">Reconnect</UButton>
    </template>
    <fieldset v-for="request in pendingRequests" :key="request.requestId" class="decision"><legend>Awaiting decision</legend><p>{{ request.prompt }}</p><UButton v-for="option in request.options || []" :key="option.id" :color="option.style === 'danger' ? 'error' : 'primary'" :disabled="!!answering" @click="answer(request.requestId, option.id)">{{ option.label }}</UButton><UTextarea v-if="request.allowFreeform || request.display === 'text'" v-model="freeformAnswers[request.requestId]" :rows="3" :maxlength="10000" aria-label="Answer the pending request" placeholder="Type an answer…" :disabled="!!answering" /><UButton v-if="request.allowFreeform || request.display === 'text'" :disabled="!freeformAnswers[request.requestId]?.trim() || !!answering" :loading="answering === request.requestId" @click="answerFreeform(request.requestId)">Send answer</UButton><p class="small muted">This decision applies to the existing station run. No option is selected automatically.</p></fieldset>
    <WorkRun v-if="childId" :session-id="childId" :station="station" :awaiting-decision="needsDecision" child @settled="childSettled = $event" @recorded="childRecorded = $event" />
    <div v-if="!child" class="run-actions"><UButton v-if="childId && discoveryError && !childRecorded" variant="outline" @click="reconnect">Reconnect decisions</UButton><UButton v-if="canStop || stopping" color="error" variant="outline" :loading="stopping" :disabled="stopping" @click="requestStop">Stop {{ stationTitle.toLowerCase() }}</UButton><a :href="runLink" :aria-label="`Open run ${sessionId}`">Open run <code>{{ shortIdentifier(sessionId) }}</code></a></div>
    <UModal
      :open="confirmStop"
      :title="`Stop this ${stationTitle.toLowerCase()} station?`"
      description="The current run will be cancelled. Its recorded evidence and run link remain available."
      @update:open="(value) => { confirmStop = value; }"
    >
      <template #body>
        <p class="small muted">Stop the station only if you want to end this attempt. A later run can start from the saved request.</p>
        <div class="confirm-actions">
          <UButton color="error" :loading="stopping" :disabled="stopping" @click="stop">Stop station</UButton>
          <UButton variant="ghost" color="neutral" :disabled="stopping" @click="confirmStop = false">Keep running</UButton>
        </div>
      </template>
    </UModal>
    <p v-if="cancellationRequested && canStop" role="status">Cancellation requested. Waiting for the station to stop.</p>
    <UAlert v-if="actionError" color="warning" title="Action not completed" :description="actionError" />
  </div>
</template>
<style scoped>
.station-run { padding:28px; margin-top:24px; overflow-wrap:anywhere; }
.run-heading, .run-actions { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.run-heading-meta { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.run-usage { color:var(--ui-text-muted); font-size:12px; }
h2 { font-size:22px; font-weight:600; }
h3 { font-weight:600; margin-top:10px; }
p { line-height:1.65; margin:16px 0; }
.run-actions a, .review-pr-link { color:var(--ui-primary); text-decoration:underline; }
.decision { border:1px solid var(--ui-border); padding:18px; margin:20px 0; }
.decision legend { font-weight:600; padding:0 8px; }
.decision button { margin-right:12px; }
.review-finding, .run-actions { margin-top:20px; }
ul { padding-left:22px; list-style:disc; }
.summary, pre { white-space:pre-wrap; }
.checks { margin:24px 0; }
.checks details { margin:16px 0; }
.technical-evidence { margin:20px 0; padding:14px 16px; border:1px solid var(--ui-border); border-radius:6px; background:var(--ui-bg-muted); }
.technical-evidence summary { font-weight:600; }
.technical-evidence dl { display:grid; gap:10px; margin:14px 0 0; }
.technical-evidence dl div { display:grid; grid-template-columns:minmax(110px, 150px) minmax(0, 1fr); align-items:center; gap:10px; }
.technical-evidence dt { color:var(--ui-text-muted); font-size:12px; }
.technical-evidence dd { display:flex; min-width:0; align-items:center; gap:8px; margin:0; overflow-wrap:anywhere; }
.technical-evidence code { min-width:0; overflow-wrap:anywhere; }
summary { cursor:pointer; }
pre { background:var(--ui-bg-muted); padding:12px; max-height:280px; overflow:auto; }
.tail-events { margin:24px 0; padding:14px 16px; border:1px solid var(--ui-border); border-radius:6px; background:var(--ui-bg-muted); }
.tail-events summary { font-weight:600; }
.tail-events ol { display:grid; gap:12px; margin:14px 0 0; padding-left:20px; }
.tail-events li { padding-left:4px; }
.tail-event-heading { display:flex; align-items:center; gap:8px; flex-wrap:wrap; color:var(--ui-text-muted); font-size:11px; }
.tail-event-heading time { margin-left:auto; }
.tail-events pre { margin:8px 0 0; max-height:180px; font-size:11px; }
.confirm-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:18px; }
</style>
