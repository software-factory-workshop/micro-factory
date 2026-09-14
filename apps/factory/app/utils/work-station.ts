import { z } from "zod";
import type { EveMessageData, EveMessagePart, MessageStreamEvent } from "eve/client";
import { factoryRepository } from "../../runtime/lib/factory-config.ts";

export const stationSessionSchema = z.object({ sessionId: z.string().regex(/^wrun_[A-Za-z0-9_-]+$/), execution: z.enum(["owner", "dispatcher", "direct"]).optional(), rootAgent:z.enum(["migrator","quality-gate","security-gate"]).optional(), ownerSessionId: z.string().optional(), deliveryId: z.string().min(1).optional(), operationId: z.string().uuid().optional() });
export const stationLinkSchema = z.object({ station: z.enum(["migrator", "quality-gate", "security-gate"]), run: z.string().regex(/^wrun_[A-Za-z0-9_-]+$/), execution: z.enum(["owner", "dispatcher", "direct"]).optional(), rootAgent:z.enum(["migrator","quality-gate","security-gate"]).optional(), deliveryId: z.string().min(1).max(200).optional(), operationId: z.string().uuid().optional() });
export type StationLink = z.infer<typeof stationLinkSchema>;
export type StationKind = z.infer<typeof stationLinkSchema>["station"];
export const MIN_WORK_REQUEST_LENGTH = 20;
export const MAX_STATION_TAIL_EVENTS = 256;
export const MAX_STATION_PROJECTION_MESSAGES = 64;
export const MAX_STATION_PROJECTION_PARTS = 256;

export function parsePullRequest(value: string): number | undefined {
  const text = value.trim();
  const number = /^\d+$/.test(text) ? Number(text) : undefined;
  if (number && Number.isSafeInteger(number)) return number;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return undefined;
    const match = new RegExp(`^/${factoryRepository}/pull/(\\d+)/?$`).exec(url.pathname);
    const parsed = Number(match?.[1]);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  } catch { return undefined; }
}

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const prUrl = z.string().refine(value => parsePullRequest(value) !== undefined && value.startsWith("https://"));
const command = z.object({ command: z.string(), exitCode: z.number(), stdout: z.string(), stderr: z.string(), truncated: z.boolean().optional() });
const command2 = command.extend({ digest: z.string().optional() });
const workerResult = z.object({ station: z.literal("migrator"), operationId: z.string().uuid().optional(), sessionId: z.string(), revision: sha, prototypeRevision: sha.optional(), digest: z.string().optional(), summary: z.string(), publication: z.object({ branch: z.string(), number: z.number().int().positive(), url: prUrl, headSha: sha, baseSha: sha, ownerSessionId: z.string().optional(), targetBranch: z.string().optional(), targetHeadSha: sha.optional(), parentPrNumber: z.number().int().positive().optional() }), commands: z.array(command2) });
const gateResult = z.object({ station: z.enum(["quality-gate", "security-gate"]), gate: z.enum(["quality-gate", "security-gate"]).optional(), sessionId: z.string(), prNumber: z.number().int().positive(), url: prUrl, baseSha: sha, headSha: sha, targetBranch: z.string().optional(), verdict: z.enum(["approve", "changes_requested", "incomplete"]), summary: z.string(), findings: z.array(z.object({ severity: z.enum(["blocking", "nonblocking"]), path: z.string(), line: z.number().int().positive().optional(), message: z.string(), evidence: z.string() })), commands: z.array(command2), limitations: z.array(z.string()), attributions: z.array(z.object({ command: z.string(), exitCode: z.number(), attribution: z.string() })).optional(), testCounts: z.object({ base: z.number().optional(), head: z.number().optional() }).optional(), verification: z.object({ prepared: z.boolean(), repositoryChecksPassed: z.boolean(), candidateUnchanged: z.boolean() }).optional(), capturedAt: z.string(), note: z.string().optional() });
export function parseStationResult(value: unknown, operationId?: string) {
  const parsed = z.union([workerResult, gateResult]).safeParse(value);
  if (!parsed.success) return undefined;
  if (operationId && (parsed.data.station !== "migrator" || parsed.data.operationId !== operationId)) return undefined;
  return parsed.data;
}

export function dispatchedTask(value: unknown): string | undefined {
  const parsed = z.object({ status: z.literal("working"), taskId: z.string().min(1) }).safeParse(value);
  return parsed.success ? parsed.data.taskId : undefined;
}

export function pendingStationRequests(data: EveMessageData, hasRecordedResult = false) {
  // A child can resume outside its parent, leaving proxied requests unresolved
  // in the parent projection. Only a recorded result supersedes those requests.
  if (hasRecordedResult) return [];
  return data.messages.flatMap(message => message.parts).flatMap(part => part.type === "dynamic-tool" && part.state === "approval-requested" && part.toolMetadata?.eve?.inputRequest ? [part.toolMetadata.eve.inputRequest] : []);
}

export type StationTurn = "cancelled" | "failed" | "completed" | "running" | "unknown";

// The last turn boundary wins: cancellation of an earlier turn is not a stopped
// session after a steer or continuation starts a new turn.
export function advanceStationTurn(current: StationTurn, event: { type: string }): StationTurn {
  if (event.type === "turn.cancelled") return "cancelled";
  if (["turn.failed", "session.failed"].includes(event.type)) return "failed";
  if (event.type === "turn.completed") return "completed";
  if (["turn.started", "step.started", "message.received"].includes(event.type)) return "running";
  return current;
}

export function latestStationTurn(events: readonly { type: string }[]): StationTurn {
  return events.reduce(advanceStationTurn, "unknown");
}

// WorkRun still needs a recent event tail for the station projection, but it
// must not copy the complete durable session history on every streamed event.
export function appendStationTail(tail: MessageStreamEvent[], event: MessageStreamEvent) {
  tail.push(event);
  if (tail.length > MAX_STATION_TAIL_EVENTS) tail.splice(0, tail.length - MAX_STATION_TAIL_EVENTS);
}

// Eve stamps the same call ID onto the request, input, dispatch and result
// events. Keep that correlation visible in the cockpit without making the UI
// understand every event variant in the protocol.
export function eventToolId(event: { type: string; data?: unknown }): string | undefined {
  const record = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : undefined;
  if (!record) return undefined;

  const directId = [record.callId, record.toolCallId, record.toolId].find((value): value is string => typeof value === "string" && value.length > 0);
  if (directId) return directId;

  const result = record.result;
  if (result && typeof result === "object") {
    const resultRecord = result as Record<string, unknown>;
    if (typeof resultRecord.callId === "string" && resultRecord.callId.length > 0) return resultRecord.callId;
  }

  if (event.type === "actions.requested" && Array.isArray(record.actions)) {
    const ids = record.actions
      .filter((action): action is Record<string, unknown> => !!action && typeof action === "object")
      .map(action => action.callId)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (ids.length) return ids.join(", ");
  }

  return undefined;
}

function stationProjectionPin(part: EveMessagePart, station: StationKind, operationId?: string) {
  if (part.type === "authorization") return part.state === "required";
  if (part.type !== "dynamic-tool") return false;
  if (part.state === "approval-requested") return true;
  if (part.toolName !== station || part.state !== "output-available") return false;
  return !!dispatchedTask(part.output) || !!parseStationToolResult(part.toolName, part.output, operationId);
}

// The Eve reducer is intentionally an accumulator, so a long replay grows
// messages and parts forever. Keep the recent UI window plus the bounded set
// of active semantic parts that must survive that window: pending requests,
// authorizations, dispatch receipts, and the matching station result.
export function boundStationProjection(data: EveMessageData, station: StationKind, operationId?: string): EveMessageData {
  const pinned = new Set<EveMessagePart>();
  const pinnedMessageIds = new Set<string>();
  for (const message of [...data.messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (pinned.size >= MAX_STATION_PROJECTION_PARTS) break;
      if (stationProjectionPin(part, station, operationId)) {
        pinned.add(part);
        pinnedMessageIds.add(message.id);
      }
    }
    if (pinned.size >= MAX_STATION_PROJECTION_PARTS) break;
  }

  const pinnedMessages = data.messages.filter(message => pinnedMessageIds.has(message.id)).slice(-MAX_STATION_PROJECTION_MESSAGES);
  const remainingMessages = MAX_STATION_PROJECTION_MESSAGES - pinnedMessages.length;
  const recentMessages = remainingMessages ? data.messages.filter(message => !pinnedMessageIds.has(message.id)).slice(-remainingMessages) : [];
  const selectedIds = new Set([...pinnedMessages, ...recentMessages].map(message => message.id));
  const selectedMessages = data.messages.filter(message => selectedIds.has(message.id));
  const keptParts = new Set<EveMessagePart>();
  for (const message of selectedMessages) for (const part of message.parts) if (pinned.has(part)) keptParts.add(part);
  for (const message of [...selectedMessages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      if (keptParts.size >= MAX_STATION_PROJECTION_PARTS) break;
      keptParts.add(part);
    }
    if (keptParts.size >= MAX_STATION_PROJECTION_PARTS) break;
  }
  return { messages: selectedMessages.map(message => ({ ...message, parts: message.parts.filter(part => keptParts.has(part)) })) } satisfies EveMessageData;
}

// Eve's Vue entry is browser-bundled; its generic client entry contains Node
// package aliases that conflict with Nuxt's #shared alias. Follow the public
// same-origin NDJSON route and keep Eve's Vue reducer for message projection.
export async function* readStationStream(sessionId: string, signal: AbortSignal): AsyncGenerator<MessageStreamEvent> {
  const response = await fetch(`/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0`, { cache: "no-store", signal });
  if (!response.ok || !response.body) throw new Error("Station stream is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      if (chunk.done && buffer.trim()) { lines.push(buffer); buffer = ""; }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (!event || typeof event.type !== "string" || !event.data || typeof event.data !== "object") throw new Error("Invalid station event");
        yield event;
      }
      if (chunk.done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function matchesStationDelivery(event: { meta?: { deliveryIds?: readonly string[] } }, deliveryId: string, started: boolean) {
  return event.meta?.deliveryIds?.includes(deliveryId) === true || (started && event.meta?.deliveryIds === undefined);
}

export function parseStationToolResult(toolName: string, output: unknown, operationId?: string) {
  if (["publish_work", "record_review"].includes(toolName)) return parseStationResult(output, operationId);
  if (toolName !== "prepare_work") return undefined;
  const cached = z.object({ phase: z.literal("Already published"), result: z.unknown() }).safeParse(output);
  return cached.success ? parseStationResult(cached.data.result, operationId) : undefined;
}
