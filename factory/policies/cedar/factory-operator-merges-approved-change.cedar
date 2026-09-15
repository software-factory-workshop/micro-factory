@id("factory-operator-merges-approved-change")
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
  context has approval &&
  context.approval.human == true &&
  context has evidence &&
  ["factory.merge-policy", "factory.human-approval"].contains(context.evidence.source) &&
  context has reviewedSha &&
  context.reviewedSha == resource.candidateSha &&
  context.input.pullRequest == resource.changeId &&
  context.input.targetBranch == context.branch
};
