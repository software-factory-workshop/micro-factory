@id("factory-forbid-unadmitted-start")
forbid (
  principal,
  action == Factory::Action::"start_task",
  resource
)
unless {
  context has admission &&
  context.admission.kind == "work_order"
};
