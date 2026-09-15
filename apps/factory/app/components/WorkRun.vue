<script setup lang="ts">
import { useEveAgent, defaultMessageReducer, type EveMessageData } from "eve/vue";
import type { MessageStreamEvent } from "eve/client";
import { triggerRef } from "vue";
import { dispatchedTask, parseStationToolResult, pendingStationRequests, matchesStationDelivery, advanceStationTurn, appendStationTail, boundStationProjection, eventToolId, readStationStream, type StationKind, type StationTurn } from "../utils/work-station";
import { stationFlow, displayToolName } from "../utils/observability-flow";
import type { RunDigest } from "../../runtime/lib/run-digest.ts";
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
// Only a same-owner revision waits for the owner's queued turn; a first attempt is never "queued for owner".
const queuedForOwner = computed(() => props.execution === "owner" && !!props.deliveryId && !deliveryStarted.value && digest.value?.status !== "completed" && digest.value?.status !== "failed" && digest.value?.status !== "cancelled");
// Host-side digest of the whole session: status, tool timeline, last error, terminal event, the agent's closing words.
const digest = shallowRef<RunDigest & { complete?: boolean }>();
const digestError = ref("");
const digestLoading = ref(false);
let digestTimer: ReturnType<typeof setTimeout> | undefined;
async function loadDigest() {
  if (digestLoading.value) return;
  digestLoading.value = true;
  try {
    digest.value = await $fetch<RunDigest & { complete?: boolean }>(`/factory/cockpit/run/${encodeURIComponent(props.sessionId)}/digest`, { retry: 0 });
    digestError.value = "";
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? ` (HTTP ${(error as { status: unknown }).status})` : "";
    digestError.value = `The run digest could not be read${status}. The Eve stream of ${props.sessionId} may be on another root or unavailable.`;
  } finally {
    digestLoading.value = false;
    clearTimeout(digestTimer);
    if (!disposed && (digest.value?.status === "running" || digest.value?.status === "idle" || digestError.value)) digestTimer = setTimeout(() => void loadDigest(), 6000);
  }
}
let disposed = false;
const digestTools = computed(() => digest.value?.tools ?? []);
const digestStatusLabel = computed(() => ({ idle: "No events yet", running: "Running", completed: "Turn completed", failed: "Failed", cancelled: "Cancelled", waiting_input: "Waiting for input" } as Record<string, string>)[digest.value?.status ?? ""] ?? "Unknown");
function formatDuration(ms?: number) {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
function clock(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-GB", { hour12: false });
}
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
onMounted(() => { void followChild(); void loadDigest(); });
onBeforeUnmount(() => { disposed = true; discovery?.abort(); clearTimeout(copyTimer); clearTimeout(digestTimer); });
const result = computed(() => {
  for (const part of [...parts.value].reverse()) {
    if (part.type !== "dynamic-tool" || part.state !== "output-available") continue;
    const parsed = parseStationToolResult(part.toolName, part.output, props.operationId);
    if (parsed && parsed.station === props.station) return parsed;
  }
  return undefined;
});
const digestTurn = computed<StationTurn>(() => ({ running: "running", completed: "completed", failed: "failed", cancelled: "cancelled", waiting_input: "completed" } as Record<string, StationTurn>)[digest.value?.status ?? ""] ?? "unknown");
const turn = computed(() => { const live = tailData.value ? tailTurn.value : events.value.reduce(advanceStationTurn, "unknown"); return live === "unknown" ? digestTurn.value : live; });
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
const toolActivities = computed(() => {
  const live = parts.value.filter((part): part is Extract<typeof part, { type: "dynamic-tool" }> => part.type === "dynamic-tool").map((part, index) => ({ id: `tool-${index}-${part.toolName}`, toolName: part.toolName, state: part.state }));
  if (live.length) return live;
  return digestTools.value.map(tool => ({ id: `digest-${tool.callId}`, toolName: tool.toolName, state: tool.outcome === "ok" ? "output-available" : tool.outcome === "error" ? "output-error" : "input-available" }));
});
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
const label = computed(() => result.value ? result.value.station === "migrator" ? props.execution === "owner" ? "PR revised" : "Draft PR created" : result.value.verdict === "approve" ? "Gate passed" : result.value.verdict === "changes_requested" ? "Changes requested" : "Gate incomplete" : queuedForOwner.value ? "Queued for branch owner" : needsDecision.value ? "Awaiting decision" : stopped.value ? "Cancelled" : awaitingChild.value ? "Station dispatched" : authorizations.value.length ? "Connection needed" : active.value ? "Running" : turn.value === "failed" ? "Failed" : ended.value ? "Finished without result" : digestError.value ? "Stream unavailable" : "Connecting");
watch(() => props.awaitingDecision, (waiting, previous) => {
  if (props.child && previous && !waiting && !result.value && !active.value) void reconnect();
});
async function reconnect() {
  actionError.value = "";
  const results = await Promise.allSettled([loadDigest(), discoveryError.value || !discovery ? followChild() : resume()]);
  const failed = results.filter((item): item is PromiseRejectedResult => item.status === "rejected");
  if (failed.length || digestError.value) actionError.value = digestError.value || `Could not reconnect: ${failed.map(item => item.reason instanceof Error ? item.reason.message : String(item.reason)).join("; ")}`;
}
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
      <section v-if="digest || digestError" class="run-digest" :data-status="digest?.status" aria-label="What happened in this station run">
        <div class="run-digest-heading">
          <UBadge :color="digest?.status === 'running' ? 'primary' : digest?.status === 'failed' || (digest?.status === 'completed' && !result) ? 'error' : digest?.status === 'cancelled' ? 'neutral' : 'success'" variant="soft">{{ digestError ? 'Digest unavailable' : digestStatusLabel }}</UBadge>
          <span v-if="digest" class="small muted">{{ digest.steps }} model steps · {{ digest.toolCalls }} tool calls<template v-if="digest.toolErrors"> · {{ digest.toolErrors }} failed</template> · {{ digest.eventCount.toLocaleString('en-US') }} events<template v-if="digest.firstAt"> · {{ clock(digest.firstAt) }}–{{ clock(digest.lastAt) }}</template><template v-if="digest.model"> · {{ digest.model }}</template></span>
          <UButton size="xs" variant="ghost" :loading="digestLoading" icon="i-lucide-refresh-cw" @click="loadDigest">Refresh</UButton>
        </div>
        <p v-if="digestError" class="run-digest-error">{{ digestError }}</p>
        <template v-if="digest">
          <p v-if="digest.terminal && digest.status !== 'running'" class="run-digest-line"><strong>Session ended</strong> <code>{{ digest.terminal.type }}</code><template v-if="digest.terminal.at"> at {{ clock(digest.terminal.at) }}</template><template v-if="digest.terminal.code"> · {{ digest.terminal.code }}</template><template v-if="digest.terminal.message"> · {{ digest.terminal.message }}</template><template v-if="digest.finishReason"> · finish reason <code>{{ digest.finishReason }}</code></template></p>
          <p v-else-if="digest.lastTool" class="run-digest-line"><strong>Now</strong> {{ displayToolName(digest.lastTool.toolName) }} · {{ digest.lastTool.outcome === 'running' ? 'running' : digest.lastTool.outcome === 'ok' ? 'finished' : 'failed' }}<template v-if="digest.lastTool.input"> · <span class="muted">{{ digest.lastTool.input }}</span></template><template v-if="digest.lastAt"> · last event {{ clock(digest.lastAt) }}</template></p>
          <UAlert v-if="digest.lastError && !result" color="error" variant="soft" :title="`Last failing tool · ${digest.lastError.toolName}`" :description="digest.lastError.message" />
          <UAlert v-if="digest.status === 'completed' && !result && !needsDecision && !digest.pendingInput" color="warning" variant="soft" title="Finished without a host result" description="The station ended its turn normally, but never produced the publication or review the workflow waits for. The tool timeline below shows where it stopped." />
          <p v-if="digest.pendingInput" class="run-digest-line"><strong>Waiting for input</strong> <code>{{ digest.pendingInput.kind || 'input' }}</code> · request {{ shortIdentifier(digest.pendingInput.requestId, 24) }}<template v-if="digest.pendingInput.prompt"> · {{ digest.pendingInput.prompt }}</template></p>
          <blockquote v-if="digest.finalMessage && !result" class="agent-words"><p class="small muted">The agent's own closing words (model text, not host evidence):</p><p>{{ digest.finalMessage }}</p></blockquote>
          <details v-if="digestTools.length" class="tool-timeline" :open="!active">
            <summary>Tool timeline · {{ digest.toolCalls }} calls<template v-if="digestTools.length < digest.toolCalls"> (last {{ digestTools.length }})</template></summary>
            <div class="tool-counts"><span v-for="(count, name) in digest.toolCounts" :key="name"><code>{{ name }}</code> ×{{ count.calls }}<template v-if="count.errors"> · {{ count.errors }} failed</template></span></div>
            <div class="tool-table-wrap">
              <table class="tool-table">
                <thead><tr><th>#</th><th>Time</th><th>Tool</th><th>Input</th><th>Result</th><th>Took</th></tr></thead>
                <tbody>
                  <tr v-for="(tool, index) in digestTools" :key="tool.callId" :data-outcome="tool.outcome">
                    <td>{{ index + 1 + Math.max(0, digest.toolCalls - digestTools.length) }}</td>
                    <td><time :datetime="tool.startedAt">{{ clock(tool.startedAt) }}</time></td>
                    <td><code>{{ tool.toolName }}</code></td>
                    <td class="tool-input">{{ tool.input || '' }}</td>
                    <td class="tool-result"><span class="tool-dot" aria-hidden="true" />{{ tool.outcome === 'running' ? 'running…' : tool.summary || (tool.outcome === 'ok' ? 'ok' : 'failed') }}</td>
                    <td>{{ formatDuration(tool.durationMs) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </template>
      </section>
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
      <UButton v-if="!result && (error || discoveryError || digestError || (!active && !ended && !stopped))" variant="outline" :loading="digestLoading" @click="reconnect">Reconnect</UButton>
      <p v-if="!result && discoveryError && !digestError" class="small muted">The live stream filter matched no events for this attempt; the digest above is read from the whole session instead.</p>
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
.run-digest { margin:18px 0; padding:14px 16px; border:1px solid var(--ui-border); border-radius:6px; background:var(--ui-bg-muted); }
.run-digest[data-status="failed"] { border-color:#e3b3af; }
.run-digest-heading { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.run-digest-heading button { margin-left:auto; }
.run-digest-line { margin:10px 0 0; font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
.run-digest-error { margin:10px 0 0; color:#a33d37; font-size:12px; }
.run-digest .agent-words { margin:12px 0 0; padding:10px 14px; border-left:3px solid var(--ui-border); }
.run-digest .agent-words p { margin:0; white-space:pre-wrap; font-size:12px; line-height:1.6; }
.run-digest .agent-words p + p { margin-top:6px; }
.tool-timeline { margin:12px 0 0; }
.tool-timeline summary { font-weight:600; font-size:13px; }
.tool-counts { display:flex; gap:10px; flex-wrap:wrap; margin:10px 0; font-size:11px; color:var(--ui-text-muted); }
.tool-table-wrap { overflow-x:auto; }
.tool-table { width:100%; border-collapse:collapse; font-size:11.5px; }
.tool-table th, .tool-table td { padding:5px 8px; text-align:left; vertical-align:top; border-top:1px solid var(--ui-border); }
.tool-table th { border-top:0; color:var(--ui-text-muted); font-weight:600; }
.tool-table td:nth-child(1), .tool-table td:nth-child(6) { white-space:nowrap; color:var(--ui-text-muted); }
.tool-input, .tool-result { max-width:360px; overflow-wrap:anywhere; }
.tool-input { color:var(--ui-text-muted); font-family:ui-monospace, monospace; font-size:10.5px; }
.tool-dot { display:inline-block; width:7px; height:7px; margin-right:6px; border-radius:50%; background:#75a9ad; vertical-align:middle; }
tr[data-outcome="error"] .tool-dot { background:#c2413b; }
tr[data-outcome="error"] .tool-result { color:#a33d37; }
tr[data-outcome="running"] .tool-dot { background:#007f8c; box-shadow:0 0 0 3px rgba(0,127,140,.15); }
</style>
