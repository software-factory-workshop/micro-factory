@id("factory-delivery-driver-merges-low-risk-change")
permit (
  principal == Factory::ServicePrincipal::"factory-delivery-driver",
  action == Factory::Action::"merge_change",
  resource is Factory::Change
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "merge-coordinator" &&
  context.lane == "merge" &&
  context.riskClass == "low" &&
  context.branch == resource.defaultBranch &&
  context has evidence &&
  context.evidence.complete == true &&
  context.evidence.source == "factory.merge-policy" &&
  context has reviewedSha &&
  context.reviewedSha == resource.candidateSha &&
  context.input.pullRequest == resource.changeId &&
  context.input.targetBranch == context.branch
};
