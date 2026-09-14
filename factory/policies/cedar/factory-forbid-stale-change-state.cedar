@id("factory-forbid-stale-change-state")
forbid (
  principal,
  action in [
    Factory::Action::"record_verification",
    Factory::Action::"record_review",
    Factory::Action::"publish_change",
    Factory::Action::"merge_change"
  ],
  resource is Factory::Change
)
when {
  context.candidateSha != resource.candidateSha ||
  context.baseSha != resource.baseSha ||
  context.verifiedSha != resource.candidateSha ||
  context.expectedRevision != resource.expectedRevision
};
