@id("factory-forbid-untrusted-evidence")
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
when {
  context has evidence &&
  (
    context.evidence.complete != true ||
    context.evidence.candidateSha != context.candidateSha ||
    ![
      "factory.prepare_work",
      "factory.prepare_review",
      "factory.verify_work",
      "factory.verify_review",
      "factory.review_gate",
      "factory.merge-policy"
    ].contains(context.evidence.source)
  )
};
