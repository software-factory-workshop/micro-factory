export interface ReconcilePublication {
  number: number;
  url: string;
  headSha: string;
  targetHeadSha: string;
  targetBranch: string;
  ownerSessionId: string;
  branch: string;
}

export interface ReconcileReview {
  headSha: string;
  baseSha: string;
  targetBranch: string;
  verdict: string;
  findings: Array<{ severity: string }>;
  limitations: string[];
  verification?: {
    prepared: boolean;
    repositoryChecksPassed: boolean;
    candidateUnchanged: boolean;
  };
}

export interface SavedDeliveryForReconcile {
  phase: string;
  publication?: ReconcilePublication | null;
  review?: ReconcileReview | null;
  mergeReview?: ReconcileReview | null;
  reviewerSessionId?: string;
}

export interface GithubMergeEvidence {
  repository: string;
  number: number;
  merged: boolean;
  state: string;
  headSha: string;
  targetHeadSha: string;
  targetBranch: string;
  mergeCommitSha?: string;
}

export interface ReconcileResult {
  eligible: boolean;
  reason: string;
  commitSha?: string;
}

const shaPattern = /^[a-f0-9]{40}$/;
const reconcilablePhases = new Set(["human_review", "ready", "blocked"]);

function unchanged(reason: string): ReconcileResult {
  return { eligible: false, reason: `${reason} Saved delivery remains unchanged.` };
}

function exactPublicationUrl(url: string, expectedRepository: string, number: number): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname === "github.com"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.pathname === `/${expectedRepository}/pull/${number}`;
  } catch {
    return false;
  }
}

function isBound(review: ReconcileReview, publication: ReconcilePublication): boolean {
  return review.headSha === publication.headSha
    && review.baseSha === publication.targetHeadSha
    && review.targetBranch === publication.targetBranch;
}

function hasTrustedReview(review: ReconcileReview): boolean {
  if (!review.verification?.prepared || !review.verification.repositoryChecksPassed || !review.verification.candidateUnchanged) return false;
  if (!Array.isArray(review.findings) || review.findings.some(finding => finding?.severity === "blocking")) return false;
  if (!Array.isArray(review.limitations)) return false;
  if (!(["approve", "incomplete"] as string[]).includes(review.verdict)) return false;
  return review.verdict !== "incomplete" || review.limitations.length > 0;
}

export function reconcileManuallyMergedDelivery(
  saved: SavedDeliveryForReconcile | null | undefined,
  evidence: GithubMergeEvidence | null | undefined,
  expectedRepository: string,
): ReconcileResult {
  try {
    if (!saved || typeof saved !== "object") return unchanged("Saved delivery is unavailable.");
    if (saved.phase === "merged") return { eligible: true, reason: "Delivery is already marked merged; no state was changed." };
    if (!reconcilablePhases.has(saved.phase)) {
      return unchanged(`Only a stopped delivery awaiting review can be reconciled (phase ${saved.phase}).`);
    }
    if (typeof expectedRepository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(expectedRepository)) {
      return unchanged("The configured repository binding is invalid.");
    }

    const publication = saved.publication;
    if (
      !publication
      || !Number.isInteger(publication.number)
      || publication.number <= 0
      || !exactPublicationUrl(publication.url, expectedRepository, publication.number)
      || !shaPattern.test(publication.headSha)
      || !shaPattern.test(publication.targetHeadSha)
      || !publication.targetBranch.trim()
      || !publication.ownerSessionId.trim()
      || !publication.branch.trim()
    ) return unchanged("The saved publication is incomplete or is not bound to the configured repository.");

    const review = saved.review;
    const mergeReview = saved.mergeReview;
    if (!review || !mergeReview) return unchanged("Trusted review and merge-review evidence are required.");
    if (!isBound(review, publication) || !isBound(mergeReview, publication)) {
      return unchanged("Recorded review evidence is not bound to the published head and target.");
    }
    if (!hasTrustedReview(review) || !hasTrustedReview(mergeReview)) {
      return unchanged("Trusted review verification is missing, incomplete, or contains blocking findings.");
    }
    if (!saved.reviewerSessionId?.trim() || saved.reviewerSessionId === publication.ownerSessionId) {
      return unchanged("An independent reviewer is required.");
    }

    if (!evidence || typeof evidence !== "object") return unchanged("GitHub merge evidence is unavailable.");
    if (evidence.repository !== expectedRepository || evidence.number !== publication.number) {
      return unchanged("GitHub evidence does not match the configured repository or recorded PR number.");
    }
    if (evidence.merged !== true || evidence.state !== "closed") {
      return unchanged(`PR #${publication.number} is not confirmed merged on GitHub.`);
    }
    if (
      !shaPattern.test(evidence.headSha)
      || evidence.headSha !== publication.headSha
      || !shaPattern.test(evidence.targetHeadSha)
      || evidence.targetHeadSha !== publication.targetHeadSha
      || evidence.targetBranch !== publication.targetBranch
    ) return unchanged("GitHub evidence does not match the recorded candidate head or target.");
    if (evidence.mergeCommitSha !== undefined && !shaPattern.test(evidence.mergeCommitSha)) {
      return unchanged("GitHub merge evidence contains an invalid merge commit SHA.");
    }

    return {
      eligible: true,
      reason: `PR #${publication.number} is confirmed merged into ${publication.targetBranch}; review evidence is preserved. Read-only check; saved delivery remains unchanged.`,
      ...(evidence.mergeCommitSha ? { commitSha: evidence.mergeCommitSha } : {}),
    };
  } catch {
    return unchanged("Reconciliation could not be verified.");
  }
}
