@id("factory-forbid-unbound-service-mutation")
forbid (
  principal is Factory::ServicePrincipal,
  action in [
    Factory::Action::"record_verification",
    Factory::Action::"record_review",
    Factory::Action::"publish_change",
    Factory::Action::"merge_change"
  ],
  resource
)
when {
  !(
    principal.hasTag("role") &&
    ["worker", "reviewer", "merge-coordinator"].contains(principal.getTag("role"))
  )
};
