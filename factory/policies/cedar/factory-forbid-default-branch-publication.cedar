@id("factory-forbid-default-branch-publication")
forbid (
  principal,
  action == Factory::Action::"publish_change",
  resource is Factory::Change
)
when {
  context.branch == resource.defaultBranch ||
  context.input.branch == resource.defaultBranch
};
