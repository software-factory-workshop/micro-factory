import { defineTool } from "eve/tools";
import { z } from "zod";
import { updateDelivery } from "../../../lib/delivery-store";
import { askOwnerQuestion } from "../../../lib/delivery-state";
import { currentRevision, requireStation, stationDeliveryId, stationRequest, migratorRequest } from "../../../lib/station-access";

const inputSchema = z.object({
  question: z.string().trim().min(1).max(4000).describe("The single decision the owner must make before the worker can continue."),
  options: z.array(z.string().trim().min(1).max(500)).max(10).optional().describe("Optional concise answer choices for the owner."),
}).strict();

export default defineTool({
  description: "Ask the authenticated delivery owner one blocking question. The question is durably recorded and this worker turn ends; wait for the owner to resume you before continuing.",
  inputSchema,
  async execute(input, ctx) {
    requireStation(ctx, "migrator");
    const deliveryId = stationDeliveryId(ctx);
    if (!deliveryId) throw new Error("Owner questions require a delivery-owned worker session.");
    const request = migratorRequest.parse(stationRequest(ctx));
    const operationId = currentRevision(ctx)?.operationId || request.operationId;
    const question = await updateDelivery(deliveryId, state => {
      if (!state) throw new Error("Delivery not found.");
      if (state.sessionId !== ctx.session.id && state.childSessionId !== ctx.session.id) {
        throw new Error("This worker session does not own the delivery operation.");
      }
      const entry = askOwnerQuestion(state, {
        question: input.question,
        options: input.options,
        operationId,
        sessionId: ctx.session.id,
      });
      return { state, result: entry };
    });
    return { phase: "awaiting_input" as const, question: question.question, options: question.options || [] };
  },
  toModelOutput(output) {
    return {
      type: "text",
      value: `${JSON.stringify(output)} The owner question is recorded. End this turn now and wait for the authenticated owner answer; do not call another tool or publish work.`,
    };
  },
});
