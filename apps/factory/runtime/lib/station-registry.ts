import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import type { RootAgent } from './root-agent-client';
import { factoryBlobPaths } from './factory-config.ts';

export interface StationRegistry {
  sessions: Record<string, RootAgent>;
  operations: Record<string, { request: string; sessionId?: string }>;
}
export function emptyRegistry(): StationRegistry { return { sessions: {}, operations: {} }; }
export function registryKey(root: RootAgent, address: string) { return `${root}:${address}`; }

// This record is host-owned. Clearing or editing cockpit history never alters
// execution identity, and replay cannot quietly substitute a different task.
export function reserveStation(registry: StationRegistry, root: RootAgent, address: string, request: unknown) {
  const key = registryKey(root, address);
  const serialized = JSON.stringify(request);
  const existing = registry.operations[key];
  if (existing) {
    if (existing.request !== serialized) throw new Error('Operation ID reused with a different station request.');
    return { start: false, sessionId: existing.sessionId };
  }
  registry.operations[key] = { request: serialized };
  return { start: true, sessionId: undefined };
}
export function bindStation(registry: StationRegistry, root: RootAgent, address: string, sessionId: string) {
  const operation = registry.operations[registryKey(root, address)];
  if (!operation) throw new Error('Station request was not reserved.');
  if (operation.sessionId && operation.sessionId !== sessionId) throw new Error('Station operation already belongs to another session.');
  if (registry.sessions[sessionId] && registry.sessions[sessionId] !== root) throw new Error('Session belongs to another root agent.');
  operation.sessionId = sessionId;
  registry.sessions[sessionId] = root;
}

const path = factoryBlobPaths.stationRegistry;
export async function readStationRegistry() {
  const response = await get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
  if (!response) return { registry: emptyRegistry(), etag: undefined };
  if (response.statusCode !== 200 || !response.stream || response.blob.etag.startsWith('W/')) throw new Error('Station registry storage unavailable.');
  return { registry: await new Response(response.stream).json() as StationRegistry, etag: response.blob.etag };
}
export async function updateStationRegistry<T>(change: (registry: StationRegistry) => T): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { registry, etag } = await readStationRegistry();
    const result = change(registry);
    try {
      await put(path, JSON.stringify(registry), { access: 'private', addRandomSuffix: false, allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {}), contentType: 'application/json' });
      return result;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && !(error instanceof Error && error.message.includes('already exists'))) throw error;
    }
  }
  throw new Error('Station registry changed concurrently. Retry the operation.');
}
