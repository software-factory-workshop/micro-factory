import { z } from 'zod';

const eventMetaSchema = z.object({
  deliveryIds: z.array(z.string()).optional(),
}).passthrough();

export const factoryEventSchema = z.object({
  type: z.string(),
  meta: eventMetaSchema.optional(),
  data: z.unknown(),
});

export type FactoryEvent = z.infer<typeof factoryEventSchema>;

const eventTypeSchema = z.object({ type: z.string() });
const deliveryMetadataEventSchema = z.object({
  meta: eventMetaSchema.extend({ deliveryIds: z.array(z.string()) }),
});

export function parseEventType(value: unknown) {
  const parsed = eventTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseDeliveryIds(value: unknown) {
  const parsed = deliveryMetadataEventSchema.safeParse(value);
  return parsed.success ? parsed.data.meta.deliveryIds : undefined;
}

const toolResultSchema = z.object({
  kind: z.literal('tool-result'),
  toolName: z.string(),
  isError: z.boolean().optional(),
  output: z.unknown(),
});

const actionResultDataSchema = z.object({
  status: z.literal('completed'),
  result: toolResultSchema,
});

export const actionResultEventSchema = factoryEventSchema.extend({
  type: z.literal('action.result'),
  data: actionResultDataSchema,
});

export const successfulActionResultEventSchema = actionResultEventSchema.refine(
  event => event.data.result.isError !== true,
  { message: 'The tool result must be successful.' },
);

export type ActionResultEvent = z.infer<typeof actionResultEventSchema>;
export type SuccessfulActionResultEvent = z.infer<typeof successfulActionResultEventSchema>;
export type ToolResult = ActionResultEvent['data']['result'];

export function parseFactoryEvent(value: unknown): FactoryEvent | undefined {
  const parsed = factoryEventSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseActionResultEvent(value: unknown): ActionResultEvent | undefined {
  const parsed = actionResultEventSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseSuccessfulActionResultEvent(value: unknown): SuccessfulActionResultEvent | undefined {
  const parsed = successfulActionResultEventSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const subagentCalledDataSchema = z.object({
  childSessionId: z.string(),
  name: z.unknown().optional(),
});

export function parseSubagentCalledEvent(value: unknown) {
  const event = parseFactoryEvent(value);
  if (!event || event.type !== 'subagent.called') return undefined;
  const parsed = subagentCalledDataSchema.safeParse(event.data);
  return parsed.success ? parsed.data : undefined;
}

const messageReceivedDataSchema = z.object({ message: z.string() });

export function parseMessageReceivedEvent(value: unknown) {
  const event = parseFactoryEvent(value);
  if (!event || event.type !== 'message.received') return undefined;
  const parsed = messageReceivedDataSchema.safeParse(event.data);
  return parsed.success ? { event, data: parsed.data } : undefined;
}
