@id("factory-reviewer-runs-checks")
permit (
  principal,
  action == Factory::Action::"run_check",
  resource is Factory::Repository
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "reviewer" &&
  context.lane == "reviewer" &&
  context has evidence &&
  context.evidence.complete == true &&
  context.evidence.source == "factory.prepare_review"
};
