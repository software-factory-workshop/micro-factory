// Host-owned factory configuration. Keep these values in source control so a
// deployment cannot silently fall back to an uncapped Eve session or an
// unknown repository.
// Reference run 7b0988cf (14 Sep 2026): the migrator hit the 500K input-token
// guardrail at step 18, before writing the UI, because every step re-sends the
// whole transcript and the prototype had been read file by file. The migrator
// gets a larger input budget; the cost cap stays the hard limit. Gates keep the
// smaller budget: a review that needs more than 500K input tokens is a smell.
export const factoryModelLimits = {
  maxInputTokensPerSession: 500_000,
  maxOutputTokensPerSession: 100_000,
  maxTokenCostUsdPerSession: 25,
} as const;
export const migratorModelLimits = {
  maxInputTokensPerSession: 2_000_000,
  maxOutputTokensPerSession: 200_000,
  maxTokenCostUsdPerSession: 25,
} as const;

// The migrated Nuxt application lives here; every draft PR targets this repository.
export const factoryRepository = "software-factory-workshop/adeo-todo-nuxt";
export const factoryRepositoryUrl = `https://github.com/${factoryRepository}`;
// The v0 prototype is read-only input. It is exported into the sandbox as a snapshot.
export const prototypeRepository = "software-factory-workshop/adeo-todo-proto";
export const prototypeRepositoryUrl = `https://github.com/${prototypeRepository}`;

export const vercelTeamName = "demo-software-factory";
export const vercelTeamId = "team_Ljrc7ENgQWsCySwCwijvA0zy";
export const vercelProjectNames = {
  cockpit: "adeo-micro-factory",
  target: "adeo-todo-nuxt",
} as const;
export const vercelProjects = {
  // demo-software-factory/adeo-micro-factory. Passport auth applies only when VERCEL_PROJECT_ID matches.
  cockpit: "prj_khvTAUUbqRnUKbMNaYanurEroc5v",
} as const;
export const passportProjectId = vercelProjects.cockpit;

// One GitHub App connector reads the prototype and publishes to the target. The
// existing software-factory-workshop installation (connector github/jira-clone)
// is attached to the cockpit project; its repository coverage must include
// adeo-todo-proto and adeo-todo-nuxt, which a person confirms in GitHub.
export const githubConnectorName = "github/jira-clone";

export const factoryModelIds = {
  migrator: "meta/muse-spark-1.3-contributor",
  qualityGate: "meta/muse-spark-1.3-contributor",
  securityGate: "meta/muse-spark-1.3-contributor",
} as const;

export const factoryPorts = {
  cockpit: 3000,
  migrator: 4281,
  qualityGate: 4282,
  securityGate: 4283,
} as const;

// Required checks on the target Nuxt application. Their names are fixed here,
// not chosen by a model; the scripts live in the target repository manifest.
export const verificationCommands = ["pnpm typecheck", "pnpm test", "pnpm test:e2e", "pnpm build"] as const;
export const unitTestCommand = "pnpm test";
export const e2eTestCommand = "pnpm test:e2e";
export const dependencyAuditCommand = "pnpm audit --audit-level=high --json";

export const factoryNodeVersion = "24.21.0";
export const factoryPnpmVersion = "10.33.4";

export const factoryBlobPaths = {
  cockpit: "micro-factory/cockpit-v1.json",
  stationRegistry: "micro-factory/station-registry-v1.json",
  deliveryPrefix: "micro-factory/delivery/",
} as const;

export const requiredCheckName = "check";

// Named in the cockpit as missing on purpose. None of these exist in v1.
export const missingCapabilities = [
  "Auto-merge of any class: every PR is merged by a person.",
  "Scheduled runs: nothing starts without an operator request.",
  "Webhook triggers: GitHub events do not start or advance work.",
  "Trace viewer: only receipts, findings and command evidence are shown.",
  "A different model vendor per station: all stations use the same model.",
  "Self-modification: the factory does not change its own instructions, tools or policies.",
] as const;
