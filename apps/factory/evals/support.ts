export interface JsonRecord {
  readonly [key: string]: unknown;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function property(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function stringProperty(value: unknown, key: string): string | undefined {
  const result = property(value, key);
  return typeof result === "string" ? result : undefined;
}

export function nested(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>((current, key) => property(current, key), value);
}

export function toolResultEvents(events: readonly unknown[], toolName: string): readonly JsonRecord[] {
  return events.filter((event): event is JsonRecord => {
    const result = nested(event, "data", "result");
    return isRecord(result) && result.kind === "tool-result" && result.toolName === toolName;
  });
}

export function toolResultOutput(event: unknown): unknown {
  return nested(event, "data", "result", "output");
}

export function toolResultError(event: unknown): unknown {
  return nested(event, "data", "result", "error");
}

export function toolResultName(event: unknown): string | undefined {
  return stringProperty(nested(event, "data", "result"), "toolName");
}

export function toolResultNames(events: readonly unknown[]): readonly string[] {
  return events.flatMap(event => {
    const name = toolResultName(event);
    return name ? [name] : [];
  });
}

export function eventTypes(events: readonly unknown[]): readonly string[] {
  return events.flatMap(event => {
    const type = stringProperty(event, "type");
    return type ? [type] : [];
  });
}

export function lastToolResultIndex(events: readonly unknown[], toolName: string): number {
  let result = -1;
  events.forEach((event, index) => {
    if (toolResultName(event) === toolName) result = index;
  });
  return result;
}

export function isSessionTerminal(type: string | undefined): boolean {
  return type === "session.completed" || type === "session.failed" || type === "session.waiting";
}

export async function readNdjsonUntilSessionTerminal(response: Response, maxEvents = 2_000): Promise<readonly JsonRecord[]> {
  if (!response.ok) throw new Error(`Eve station stream failed with HTTP ${response.status}.`);
  if (!response.body) throw new Error("Eve station stream returned no body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: JsonRecord[] = [];
  let pending = "";
  let terminal = false;

  const consume = (line: string) => {
    if (!line.trim()) return;
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) throw new Error("Eve station stream emitted a non-object event.");
    events.push(parsed);
    if (events.length > maxEvents) throw new Error(`Eve station stream exceeded the ${maxEvents}-event safety bound.`);
    terminal = isSessionTerminal(stringProperty(parsed, "type"));
  };

  try {
    while (!terminal) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        consume(line);
        if (terminal) break;
      }
      if (chunk.done) {
        if (pending.trim()) consume(pending);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return events;
}
