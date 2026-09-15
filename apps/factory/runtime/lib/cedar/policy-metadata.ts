export interface FactoryPolicyMetadata {
  readonly id: string;
  readonly kind: "permit" | "forbid";
  readonly title: string;
  readonly summary: string;
  readonly enforcedAt: readonly string[];
}

/** Human-readable inventory kept next to the evaluator; source remains `.cedar`. */
export const FACTORY_POLICY_METADATA: readonly FactoryPolicyMetadata[] = [
  {
    id: "factory-forbid-missing-evidence",
    kind: "forbid",
    title: "Mutations require evidence",
    summary: "Blocks consequential factory actions when the host did not attach evidence.",
    enforcedAt: ["record_verification", "record_review", "publish_change", "merge_change"],
  },
  {
    id: "factory-forbid-untrusted-evidence",
    kind: "forbid",
    title: "Evidence must be host-shaped and candidate-bound",
    summary: "Rejects incomplete evidence, unknown evidence sources, and evidence for another candidate.",
    enforcedAt: ["record_verification", "record_review", "publish_change", "merge_change"],
  },
  {
    id: "factory-forbid-stale-change-state",
    kind: "forbid",
    title: "Reject stale change state",
    summary: "Binds the decision to the candidate, base, verified revision, and expected revision supplied by the host.",
    enforcedAt: ["record_verification", "record_review", "publish_change", "merge_change"],
  },
  {
    id: "factory-forbid-default-branch-publication",
    kind: "forbid",
    title: "Do not publish directly to the default branch",
    summary: "Rejects publication when the host-selected branch is the repository default branch.",
    enforcedAt: ["publish_change"],
  },
  {
    id: "factory-forbid-unbound-service-mutation",
    kind: "forbid",
    title: "Unbound services cannot mutate",
    summary: "A service principal may mutate only when the trusted host has assigned a known station or delivery-driver role.",
    enforcedAt: ["record_verification", "record_review", "publish_change", "merge_change"],
  },
  {
    id: "factory-forbid-elevated-auto-merge",
    kind: "forbid",
    title: "Elevated-risk changes remain manual",
    summary: "Cedar cannot turn an elevated-risk change into an automatic merge.",
    enforcedAt: ["merge_change"],
  },
  {
    id: "factory-workflow-starts-admitted-work-order",
    kind: "permit",
    title: "Workflow starts an admitted work order",
    summary: "Allows only the host workflow to start the migrator, and only when the admission attached by the host is a work order.",
    enforcedAt: ["start_task"],
  },
  {
    id: "factory-forbid-unadmitted-start",
    kind: "forbid",
    title: "No start without a work-order admission",
    summary: "A clarification, an unsupported result or a missing admission cannot start the migrator.",
    enforcedAt: ["start_task"],
  },
  {
    id: "factory-worker-runs-checks",
    kind: "permit",
    title: "Worker may run fixed checks",
    summary: "Allows the worker station to run host-selected bounded checks against the pinned repository.",
    enforcedAt: ["run_check"],
  },
  {
    id: "factory-reviewer-runs-checks",
    kind: "permit",
    title: "Reviewer may run fixed checks",
    summary: "Allows the reviewer station to run host-selected bounded checks against the pinned repository.",
    enforcedAt: ["run_check"],
  },
  {
    id: "factory-worker-records-verification",
    kind: "permit",
    title: "Worker records verification",
    summary: "Allows a worker station to bind complete passed verification evidence to its candidate digest.",
    enforcedAt: ["record_verification"],
  },
  {
    id: "factory-reviewer-records-verification",
    kind: "permit",
    title: "Reviewer records verification",
    summary: "Allows a reviewer station to bind complete passed verification evidence to the exact PR head.",
    enforcedAt: ["record_verification"],
  },
  {
    id: "factory-reviewer-records-review",
    kind: "permit",
    title: "Reviewer records an exact review",
    summary: "Allows a reviewer station to record a verdict only for the exact candidate it independently verified.",
    enforcedAt: ["record_review"],
  },
  {
    id: "factory-worker-publishes-verified-change",
    kind: "permit",
    title: "Worker publishes a verified draft",
    summary: "Allows the worker to call the existing GitHub publication operation only after host verification and branch binding.",
    enforcedAt: ["publish_change"],
  },
  {
    id: "factory-delivery-driver-merges-low-risk-change",
    kind: "permit",
    title: "Delivery driver merges low-risk change",
    summary: "Allows only the host-owned delivery driver to merge an exact independently reviewed low-risk candidate.",
    enforcedAt: ["merge_change"],
  },
  {
    id: "factory-operator-merges-approved-change",
    kind: "permit",
    title: "A person approves the merge",
    summary: "Allows the host-owned delivery driver to merge a published head once a human approval with a reason is attached, including over open gate findings (evidence source factory.human-approval).",
    enforcedAt: ["merge_change"],
  },
] as const;
