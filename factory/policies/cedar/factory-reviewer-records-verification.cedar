@id("factory-reviewer-records-verification")
permit (
  principal,
  action == Factory::Action::"record_verification",
  resource is Factory::Change
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "reviewer" &&
  context.lane == "reviewer" &&
  context has evidence &&
  context.evidence.complete == true &&
  context.evidence.source == "factory.verify_review" &&
  context.input.outcome == "passed" &&
  context.input.evidenceId == context.evidence.id
};
