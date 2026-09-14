@id("factory-workflow-starts-admitted-work-order")
permit (
  principal == Factory::ServicePrincipal::"factory-workflow",
  action == Factory::Action::"start_task",
  resource is Factory::Repository
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "workflow" &&
  context.lane == "audit" &&
  context has admission &&
  context.admission.kind == "work_order" &&
  context.input.deliveryId == context.admission.id
};
