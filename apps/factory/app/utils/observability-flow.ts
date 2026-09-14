export type FlowStatus = "idle" | "queued" | "active" | "complete" | "attention" | "failed";

export interface FlowPosition {
  x: number;
  y: number;
}

export interface FlowNodeSpec {
  id: string;
  title: string;
  subtitle: string;
  status: FlowStatus;
  icon: string;
  position: FlowPosition;
  detail?: string;
  meta?: string;
  width?: number;
  height?: number;
}

export interface FlowEdgeSpec {
  id: string;
  source: string;
  target: string;
  status?: FlowStatus;
  label?: string;
}

export const flowStatusLabels: Record<FlowStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  active: "Running",
  complete: "Complete",
  attention: "Needs attention",
  failed: "Failed",
};

export function displayToolName(toolName: string): string {
  const names: Record<string, string> = {
    bash: "Run a command",
    investigate_repository: "Investigate repository",
    prepare_review: "Prepare review",
    audit_dependencies: "Audit dependencies",
    ask_owner: "Ask the owner",
    prepare_work: "Prepare isolated work",
    publish_work: "Publish draft PR",
    record_findings: "Record findings",
    record_review: "Record review",
    refresh_target: "Refresh target branch",
    verify_review: "Verify review",
    verify_work: "Verify work",
    migrator: "Dispatch migrator",
    "quality-gate": "Dispatch quality gate",
    "security-gate": "Dispatch security gate",
  };
  return names[toolName] || toolName.replaceAll("_", " ");
}

export function toolStateLabel(state: string): string {
  const labels: Record<string, string> = {
    "approval-requested": "Waiting for approval",
    "input-available": "Starting",
    "input-streaming": "Preparing",
    "output-available": "Finished",
    "output-error": "Failed",
  };
  return labels[state] || state.replaceAll("-", " ");
}

function compact(value: string | undefined, limit = 150): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function shortIdentifier(value: string, length = 12): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

type DeliveryStage = "request" | "worker" | "review" | "security" | "revision" | "merge" | "outcome";

const stageForPhase: Record<string, DeliveryStage> = {
  worker_starting: "worker",
  working: "worker",
  review_starting: "review",
  reviewing: "review",
  revision_starting: "revision",
  revising: "revision",
  awaiting_input: "worker",
  owner_resuming: "revision",
  merging: "merge",
  ready: "outcome",
  merged: "outcome",
  human_review: "outcome",
  blocked: "outcome",
  cancelled: "outcome",
  needs_revision: "revision",
};

const deliveryPhaseLabels: Record<string, string> = {
  worker_starting: "Starting migrator",
  working: "Migrator is building",
  review_starting: "Starting gate",
  reviewing: "Gate is inspecting",
  revision_starting: "Preparing revision",
  revising: "Migrator is revising",
  awaiting_input: "Waiting for owner input",
  owner_resuming: "Resuming branch owner",
  merging: "Checking merge readiness",
  ready: "Ready: verdict recorded, merge is manual",
  merged: "Merged",
  human_review: "Waiting for human review",
  blocked: "Blocked",
  cancelled: "Cancelled",
  needs_revision: "Revision requested",
};

const isAttentionPhase = (phase: string) => ["human_review", "needs_revision", "awaiting_input", "blocked", "cancelled"].includes(phase);

export interface DeliveryFlowInput {
  phase?: string;
  gate?: string;
  reviews?: Partial<Record<string, { verdict?: string; summary?: string }>>;
  cycle?: number;
  failedPhase?: string;
  history?: readonly { phase: string }[];
  sessionId?: string;
  childSessionId?: string;
  reviewerSessionId?: string;
  publication?: { number?: number; targetBranch?: string };
  review?: { verdict?: string; summary?: string };
  mergeDecision?: { status?: string; reason?: string };
  question?: string;
  error?: string;
}

export interface FlowModel {
  nodes: FlowNodeSpec[];
  edges: FlowEdgeSpec[];
  activeNodeId?: string;
}

function activeStageFor(input: DeliveryFlowInput): DeliveryStage | undefined {
  const phase = input.phase || "";
  const stage = stageForPhase[phase];
  return stage === "review" && input.gate === "security-gate" ? "security" : stage;
}

function deliveryStageStatus(stage: DeliveryStage, input: DeliveryFlowInput, visited: Set<DeliveryStage>): FlowStatus {
  const phase = input.phase || "";
  const activeStage = activeStageFor(input);
  const failedStage = input.failedPhase ? stageForPhase[input.failedPhase] : undefined;

  if (phase === "blocked" && stage === failedStage) return "failed";
  if (isAttentionPhase(phase) && activeStage === stage) return phase === "blocked" || phase === "cancelled" ? "failed" : "attention";
  if (activeStage === stage && !["ready", "merged"].includes(phase)) return "active";
  if (stage === "merge" && ["ready", "merged"].includes(phase)) return "complete";
  if (stage === "outcome" && ["ready", "merged"].includes(phase)) return "complete";
  if (visited.has(stage)) return "complete";
  if (!phase && stage === "request") return "idle";
  return "queued";
}

function deliveryEdgeStatus(source: DeliveryStage, target: DeliveryStage, input: DeliveryFlowInput, visited: Set<DeliveryStage>): FlowStatus {
  const targetStatus = deliveryStageStatus(target, input, visited);
  const sourceStatus = deliveryStageStatus(source, input, visited);
  if (targetStatus === "active" || targetStatus === "attention" || targetStatus === "failed") return targetStatus;
  if (sourceStatus === "complete" && targetStatus === "complete") return "complete";
  return "queued";
}

export function deliveryFlow(input: DeliveryFlowInput): FlowModel {
  const phase = input.phase || "";
  const visited = new Set<DeliveryStage>(
    (input.history || []).map((entry) => stageForPhase[entry.phase]).filter((stage): stage is DeliveryStage => !!stage),
  );
  if (phase && stageForPhase[phase]) visited.add(stageForPhase[phase]);
  if (input.reviews?.["quality-gate"]) visited.add("review");
  if (input.reviews?.["security-gate"]) visited.add("security");
  if (input.gate === "security-gate" && stageForPhase[phase] === "review") visited.add("review");

  const currentLabel = deliveryPhaseLabels[phase] || "Waiting to start";
  const workerSession = input.childSessionId || input.sessionId;
  const outcomeDetail = compact(input.error || input.question || input.mergeDecision?.reason || input.review?.summary || currentLabel);
  const nodes: FlowNodeSpec[] = [
    {
      id: "request",
      title: "Work request",
      subtitle: "Accepted draft",
      status: input.phase ? "complete" : "idle",
      icon: "i-lucide-file-check-2",
      position: { x: 24, y: 126 },
      detail: "The saved brief is the input to this delivery.",
    },
    {
      id: "worker",
      title: "Migrator",
      subtitle: "v0 prototype to Nuxt",
      status: deliveryStageStatus("worker", input, visited),
      icon: "i-lucide-hammer",
      position: { x: 238, y: 126 },
      detail: workerSession ? `Session ${shortIdentifier(workerSession)}` : "An isolated Eve migrator writes the Nuxt app and publishes one draft PR.",
      meta: input.publication?.number ? `PR #${input.publication.number}` : undefined,
    },
    {
      id: "review",
      title: "Quality gate",
      subtitle: "Reruns every check",
      status: deliveryStageStatus("review", input, visited),
      icon: "i-lucide-scan-search",
      position: { x: 478, y: 126 },
      detail: "A separate gate reruns typecheck, unit, e2e and build on the exact head and compares test counts with the base.",
      meta: input.reviews?.["quality-gate"]?.verdict ? `Verdict: ${input.reviews["quality-gate"].verdict}` : undefined,
    },
    {
      id: "security",
      title: "Security gate",
      subtitle: "Secrets, injection, authz",
      status: deliveryStageStatus("security", input, visited),
      icon: "i-lucide-shield-check",
      position: { x: 716, y: 126 },
      detail: "A third session checks secrets in source, injection, authorization on routes and MCP calls, SSRF and dependency advisories.",
      meta: input.reviews?.["security-gate"]?.verdict ? `Verdict: ${input.reviews["security-gate"].verdict}` : undefined,
    },
    {
      id: "revision",
      title: "Revision loop",
      subtitle: input.cycle ? `Cycle ${input.cycle}` : "Only when needed",
      status: deliveryStageStatus("revision", input, visited),
      icon: "i-lucide-refresh-cw",
      position: { x: 597, y: 292 },
      detail: input.cycle ? "The existing branch owner receives the gate findings and keeps the same branch." : "Blocking findings from either gate send work back to its existing owner.",
      meta: input.phase === "needs_revision" ? "Review findings need a response" : undefined,
    },
    {
      id: "merge",
      title: "Manual merge",
      subtitle: "Always a person in v1",
      status: deliveryStageStatus("merge", input, visited),
      icon: "i-lucide-git-merge",
      position: { x: 956, y: 126 },
      detail: "No class of change is merged by the factory. The verdict applies to one head SHA; a person opens the PR and decides.",
      meta: input.mergeDecision?.status ? `Decision: ${input.mergeDecision.status}` : undefined,
    },
    {
      id: "outcome",
      title: "Outcome",
      subtitle: currentLabel,
      status: deliveryStageStatus("outcome", input, visited),
      icon: input.phase === "merged" ? "i-lucide-check-circle-2" : "i-lucide-flag",
      position: { x: 1196, y: 126 },
      detail: outcomeDetail,
      meta: input.publication?.targetBranch ? `Target: ${input.publication.targetBranch}` : undefined,
    },
  ];

  const edgePairs: Array<[DeliveryStage, DeliveryStage, string?]> = [
    ["request", "worker"],
    ["worker", "review"],
    ["review", "security", "approved"],
    ["security", "merge"],
    ["review", "revision", "findings"],
    ["security", "revision", "findings"],
    ["revision", "review", "re-check"],
    ["merge", "outcome"],
    ["security", "outcome", "human review"],
  ];
  const edges = edgePairs.map(([source, target, label]) => ({
    id: `${source}-${target}`,
    source,
    target,
    label,
    status: deliveryEdgeStatus(source, target, input, visited),
  }));

  return { nodes, edges, activeNodeId: phase ? activeStageFor(input) : "request" };
}

export interface StationToolActivity {
  id: string;
  toolName: string;
  state: string;
}

export interface StationFlowInput {
  station: "migrator" | "quality-gate" | "security-gate";
  active: boolean;
  ended: boolean;
  stopped: boolean;
  needsDecision: boolean;
  awaitingAuthorization: boolean;
  result?: { verdict?: string; summary?: string };
  taskId?: string;
  execution?: "owner" | "dispatcher" | "direct";
  child?: boolean;
  tools: readonly StationToolActivity[];
}

function stationStatus(input: StationFlowInput): FlowStatus {
  if (input.result) return "complete";
  if (input.needsDecision || input.awaitingAuthorization) return "attention";
  if (input.stopped) return "failed";
  if (input.active) return "active";
  if (input.ended) return "failed";
  return "queued";
}

export function stationFlow(input: StationFlowInput): FlowModel {
  const stationName = input.station === "migrator" ? "Migrator" : input.station === "quality-gate" ? "Quality gate" : "Security gate";
  const resultTitle = input.station === "migrator" ? "Draft PR" : "Gate verdict";
  const resultDetail = input.result?.summary || (input.station === "migrator" ? "The published PR will appear here." : "The exact-head verdict will appear here.");
  const maxTools = 6;
  const visibleTools = input.tools.slice(-maxTools);
  const hiddenTools = input.tools.length - visibleTools.length;
  const nodes: FlowNodeSpec[] = [
    {
      id: "request",
      title: "Work request",
      subtitle: input.child ? "Assigned task" : "Station input",
      status: "complete",
      icon: "i-lucide-inbox",
      position: { x: 24, y: 118 },
      detail: "The station is bound to the authenticated work request and its target.",
    },
    {
      id: "agent",
      title: stationName,
      subtitle: input.execution === "owner" ? "Existing branch owner" : "Eve agent session",
      status: stationStatus(input),
      icon: input.station === "migrator" ? "i-lucide-bot" : "i-lucide-shield-check",
      position: { x: 246, y: 118 },
      detail: input.taskId ? `Background task ${shortIdentifier(input.taskId)}` : `${stationName} is following the station contract in its own session.`,
      meta: input.awaitingAuthorization ? "Connection required" : undefined,
    },
  ];

  if (hiddenTools > 0) {
    nodes.push({
      id: "earlier-tools",
      title: `${hiddenTools} earlier action${hiddenTools === 1 ? "" : "s"}`,
      subtitle: "Session history",
      status: "complete",
      icon: "i-lucide-history",
      position: { x: 468, y: 118 },
      detail: "Earlier actions remain in the Eve stream; the map keeps the latest actions readable.",
    });
  }

  visibleTools.forEach((tool, index) => {
    nodes.push({
      id: tool.id,
      title: displayToolName(tool.toolName),
      subtitle: toolStateLabel(tool.state),
      status: tool.state === "approval-requested" ? "attention" : tool.state === "output-error" ? "failed" : tool.state === "output-available" ? "complete" : "active",
      icon: tool.state === "output-error" ? "i-lucide-circle-x" : tool.state === "approval-requested" ? "i-lucide-circle-alert" : "i-lucide-terminal-square",
      position: { x: 468 + (hiddenTools > 0 ? 216 : 0) + index * 216, y: 118 },
      detail: `Recorded tool: ${tool.toolName}`,
    });
  });

  const resultX = 468 + (hiddenTools > 0 ? 216 : 0) + visibleTools.length * 216;
  nodes.push({
    id: "result",
    title: resultTitle,
    subtitle: input.result ? (input.result.verdict || "Recorded") : input.needsDecision ? "Waiting for decision" : "Pending",
    status: input.result ? "complete" : input.needsDecision ? "attention" : input.ended || input.stopped ? "failed" : "queued",
    icon: input.result ? "i-lucide-check-circle-2" : "i-lucide-flag",
    position: { x: resultX, y: 118 },
    detail: compact(resultDetail, 180),
  });

  const chain = ["request", "agent", ...(hiddenTools > 0 ? ["earlier-tools"] : []), ...visibleTools.map((tool) => tool.id), "result"];
  const edges: FlowEdgeSpec[] = chain.slice(1).map((target, index) => {
    const source = chain[index]!;
    const sourceNode = nodes.find((node) => node.id === source)!;
    const targetNode = nodes.find((node) => node.id === target)!;
    const status: FlowStatus = targetNode.status === "active" || targetNode.status === "attention" || targetNode.status === "failed"
      ? targetNode.status
      : sourceNode.status === "complete" && targetNode.status === "complete" ? "complete" : "queued";
    return { id: `${source}-${target}`, source, target, status };
  });

  const activeNode = [...nodes].reverse().find((node) => node.status === "active" || node.status === "attention") || nodes.at(-1);
  return { nodes, edges, activeNodeId: activeNode?.id };
}
