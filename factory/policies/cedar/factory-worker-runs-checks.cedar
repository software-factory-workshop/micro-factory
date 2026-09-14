@id("factory-worker-runs-checks")
permit (
  principal,
  action == Factory::Action::"run_check",
  resource is Factory::Repository
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "worker" &&
  context.lane == "worker" &&
  context has evidence &&
  context.evidence.complete == true &&
  context.evidence.source == "factory.prepare_work"
};
