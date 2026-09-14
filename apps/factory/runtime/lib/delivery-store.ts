import { get, list, put, BlobPreconditionFailedError } from '@vercel/blob';
import {
  deliveryReceiptSchema,
  normalizeDelivery,
  type Delivery,
  type DeliveryReceipt,
} from './delivery-state.ts';
import { factoryBlobPaths } from './factory-config.ts';

function deliveryPath(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid delivery ID');
  return `${factoryBlobPaths.deliveryPrefix}${id}.json`;
}

export function deliveryReceiptPath(deliveryId: string, receiptId: string) {
  deliveryPath(deliveryId);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receiptId)) {
    throw new Error('Invalid delivery receipt ID');
  }
  return `${factoryBlobPaths.deliveryPrefix}${deliveryId}/receipts/${receiptId}.json`;
}

function isAlreadyExists(error: unknown) {
  return error instanceof BlobPreconditionFailedError || error instanceof Error && /already exists|already uploaded|conflict/i.test(error.message);
}

export async function readDelivery(id: string) {
  const response = await get(deliveryPath(id), {
    access: 'private',
    useCache: false,
    headers:{'accept-encoding':'identity'},
  });
  if (!response) return null;
  if (response.blob.etag.startsWith('W/')) {
    throw new Error('Storage returned a weak ETag; refusing an unsafe conditional update.');
  }
  if (response.statusCode !== 200 || !response.stream) throw new Error('Delivery storage unavailable');
  const raw = await new Response(response.stream).json() as Delivery;
  return { state: normalizeDelivery(raw), etag: response.blob.etag };
}

export async function readDeliveryReceipt(deliveryId: string, receiptId: string) {
  const response = await get(deliveryReceiptPath(deliveryId, receiptId), {
    access: 'private',
    useCache: false,
    headers:{'accept-encoding':'identity'},
  });
  if (!response) return null;
  if (response.statusCode !== 200 || !response.stream) throw new Error('Delivery receipt storage unavailable');
  return deliveryReceiptSchema.parse(await new Response(response.stream).json());
}

// Receipt IDs are content-derived from the work item, transition and
// operation. A retry may therefore safely observe the original immutable row.
export async function writeDeliveryReceipt(receipt: DeliveryReceipt) {
  const validated = deliveryReceiptSchema.parse(receipt);
  const pathname = deliveryReceiptPath(validated.deliveryId, validated.receiptId);
  try {
    await put(pathname, JSON.stringify(validated), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json',
    });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = await readDeliveryReceipt(validated.deliveryId, validated.receiptId);
    if (
      !existing ||
      existing.deliveryId !== validated.deliveryId ||
      existing.from !== validated.from ||
      existing.to !== validated.to ||
      existing.operationId !== validated.operationId ||
      existing.attempt !== validated.attempt ||
      existing.actor !== validated.actor ||
      existing.reason !== validated.reason
    ) {
      throw new Error('Delivery receipt key already exists with different transition data.');
    }
  }
}

export async function listDeliveryReceipts(deliveryId: string) {
  deliveryPath(deliveryId);
  const prefix = `${factoryBlobPaths.deliveryPrefix}${deliveryId}/receipts/`;
  const receiptIds: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const blob of page.blobs) {
      const name = blob.pathname.slice(prefix.length);
      if (name.endsWith('.json')) receiptIds.push(name.slice(0, -'.json'.length));
    }
    if (page.hasMore && !page.cursor) throw new Error('Delivery receipt listing returned no pagination cursor.');
    cursor = page.cursor;
  } while (cursor);

  const receipts = await Promise.all(receiptIds.map(receiptId => readDeliveryReceipt(deliveryId, receiptId)));
  return receipts
    .filter((receipt): receipt is DeliveryReceipt => receipt !== null)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.receiptId.localeCompare(right.receiptId));
}

export async function updateDelivery<T>(
  id: string,
  change: (state: Delivery | null) => { state: Delivery; result: T },
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const prior = await readDelivery(id);
    const changed = change(prior?.state || null);
    const pendingReceipts = changed.state.pendingReceipts ?? [];

    // The FDK receipt contract is intentionally receipt-first. If the
    // projection write fails, the immutable intent remains available to the
    // reconciler and a retry reuses its content-derived receipt ID.
    for (const receipt of pendingReceipts) await writeDeliveryReceipt(receipt);
    delete changed.state.pendingReceipts;
    const state = normalizeDelivery(changed.state);

    try {
      await put(deliveryPath(id), JSON.stringify(state), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: !!prior,
        ...(prior ? { ifMatch: prior.etag } : {}),
        contentType: 'application/json',
      });
      return changed.result;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && !isAlreadyExists(error)) throw error;
    }
  }
  throw new Error('Delivery changed concurrently. Retry the operation.');
}
