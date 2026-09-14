@id("factory-reviewer-records-review")
permit (
  principal,
  action == Factory::Action::"record_review",
  resource is Factory::Change
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "reviewer" &&
  context.lane == "reviewer" &&
  context has evidence &&
  context.evidence.complete == true &&
  context.evidence.source == "factory.review_gate" &&
  context has reviewedSha &&
  context.input.reviewedSha == context.reviewedSha &&
  context.input.reviewedSha == resource.candidateSha
};
