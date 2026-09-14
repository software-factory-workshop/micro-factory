interface ReviewFile {
  filename: string;
  previous_filename?: string;
}

export interface HostEvidence {
  /** The end-to-end suite ran on the exact candidate head and exited 0. */
  e2eRanOnHead: boolean;
  /** Unit test totals parsed from the base and head runs; undefined when unparseable. */
  baseTestCount?: number;
  candidateTestCount?: number;
  /** Host secret scan over the changed files; null when the scan did not run. */
  secretScanClean: boolean | null;
}

interface ApprovalState {
  prepared: boolean;
  repositoryChecksPassed: boolean;
  hasBlockingFinding: boolean;
  contextGaps: string[];
  modelLimitations: string[];
  files: ReviewFile[];
  evidence?: HostEvidence;
}

const sourceRoots = ["app/", "server/", "shared/", "tests/", "e2e/"];

// Required evidence is derived by the host from the changed-file inventory and
// host-observed check results. A reviewer once obtained approval by moving its
// missing checks from limitations to "optional" (Jira factory PR #2 review,
// 12 Sep 2026); the list is host-owned so model wording cannot remove a requirement.
export function hostReviewLimitations(files: ReviewFile[], evidence?: HostEvidence): string[] {
  const touchesSource = files.some(({ filename, previous_filename }) =>
    [filename, previous_filename].some((path) => path && sourceRoots.some((root) => path.startsWith(root))),
  );
  if (!touchesSource) return [];
  const limitations: string[] = [];
  if (!evidence?.e2eRanOnHead) limitations.push("Required host evidence missing: the end-to-end suite did not pass on the candidate head.");
  if (evidence?.baseTestCount === undefined || evidence.candidateTestCount === undefined) limitations.push("Required host evidence missing: unit test totals for base and head could not be compared.");
  else if (evidence.candidateTestCount < evidence.baseTestCount) limitations.push(`Required host evidence failed: unit test count on head (${evidence.candidateTestCount}) is below base (${evidence.baseTestCount}).`);
  if (evidence?.secretScanClean !== true) limitations.push(evidence?.secretScanClean === false ? "Required host evidence failed: a secret pattern was found in the diff." : "Required host evidence missing: the diff was not scanned for secret patterns.");
  return limitations;
}

export function approvalBlockers(state: ApprovalState): string[] {
  return [
    ...(state.prepared ? [] : ["The independent review workspace was not prepared."]),
    ...(state.repositoryChecksPassed ? [] : ["Mandatory repository typecheck, unit, e2e and build checks have not passed."]),
    ...(state.hasBlockingFinding ? ["Blocking findings remain."] : []),
    ...state.contextGaps,
    ...hostReviewLimitations(state.files, state.evidence),
    ...state.modelLimitations,
  ];
}

// Patterns the host scans in added lines. A match is a blocking finding with
// path:line evidence; a model cannot downgrade it.
export const secretPatterns: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { id: "vercel-oidc-or-bearer", pattern: /\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/ },
  { id: "postgres-url-with-password", pattern: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@/i },
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "generic-secret-assignment", pattern: /\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{16,}["']/i },
];

export interface SecretFinding { severity: "blocking"; path: string; line: number; message: string; evidence: string }

export function scanChangesForSecrets(changes: Array<{ path: string; content: string | null }>): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const change of changes) {
    if (change.content === null) continue;
    change.content.split(/\r?\n/).forEach((text, index) => {
      for (const { id, pattern } of secretPatterns) {
        if (!pattern.test(text)) continue;
        findings.push({ severity: "blocking", path: change.path, line: index + 1, message: `Secret pattern ${id} in source.`, evidence: `${change.path}:${index + 1}: ${text.trim().slice(0, 120).replace(/[A-Za-z0-9_\-/+=]{12,}/g, m => m.slice(0, 4) + "…")}` });
        break;
      }
    });
  }
  return findings;
}

export interface GateFinding { severity: "blocking" | "nonblocking"; path: string; line?: number; message: string; evidence: string }
// Host rule: a blocking finding must cite a path (with a line when it points at
// source) and evidence. Anything else is recorded as nonblocking with a note.
export function enforceFindingEvidence<T extends GateFinding>(findings: T[]): T[] {
  return findings.map(finding => {
    if (finding.severity !== "blocking") return finding;
    const hasPath = finding.path.trim().length > 0;
    const hasLine = finding.line !== undefined || !/\.[a-z]+$/i.test(finding.path.trim());
    const hasEvidence = finding.evidence.trim().length >= 8;
    if (hasPath && hasLine && hasEvidence) return finding;
    return { ...finding, severity: "nonblocking" as const, message: `${finding.message} [host: downgraded to nonblocking; a blocking finding needs path:line and evidence]` };
  });
}
