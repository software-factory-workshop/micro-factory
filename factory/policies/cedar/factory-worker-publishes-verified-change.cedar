@id("factory-worker-publishes-verified-change")
permit (
  principal,
  action == Factory::Action::"publish_change",
  resource is Factory::Change
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "worker" &&
  context.lane == "worker" &&
  context.branch like "factory/*" &&
  context.branch != resource.defaultBranch &&
  context has evidence &&
  context.evidence.complete == true &&
  context.evidence.source == "factory.verify_work" &&
  context.verifiedSha == resource.candidateSha &&
  context.input.candidateSha == resource.candidateSha &&
  context.input.baseSha == resource.baseSha &&
  context.input.branch == context.branch &&
  context.input.draft == true
};
