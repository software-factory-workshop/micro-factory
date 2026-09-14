@id("factory-worker-records-verification")
permit (
  principal,
  action == Factory::Action::"record_verification",
  resource is Factory::Change
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "worker" &&
  context.lane == "worker" &&
  context has evidence &&
  context.evidence.complete == true &&
  context.evidence.source == "factory.verify_work" &&
  context.input.outcome == "passed" &&
  context.input.evidenceId == context.evidence.id
};
