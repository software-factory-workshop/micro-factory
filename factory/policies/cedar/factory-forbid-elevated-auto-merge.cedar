@id("factory-forbid-elevated-auto-merge")
forbid (
  principal,
  action == Factory::Action::"merge_change",
  resource is Factory::Change
)
when { context.riskClass != "low" };
