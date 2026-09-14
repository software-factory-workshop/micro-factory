@id("factory-forbid-missing-evidence")
forbid (
  principal,
  action in [
    Factory::Action::"record_verification",
    Factory::Action::"record_review",
    Factory::Action::"publish_change",
    Factory::Action::"merge_change"
  ],
  resource
)
when { !(context has evidence) };
