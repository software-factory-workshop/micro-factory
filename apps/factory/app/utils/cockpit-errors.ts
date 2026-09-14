export type CockpitFailureKind = "conflict" | "unavailable" | "unknown";

interface FetchLikeError {
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown };
  data?: { error?: { code?: unknown } };
}

function asFetchLikeError(value: unknown): FetchLikeError {
  return typeof value === "object" && value !== null ? value as FetchLikeError : {};
}

export function cockpitStatus(value: unknown): number | undefined {
  const error = asFetchLikeError(value);
  const candidates = [error.statusCode, error.status, error.response?.status];
  const status = candidates.find((candidate): candidate is number => typeof candidate === "number");
  return status;
}

export function cockpitFailureKind(value: unknown): CockpitFailureKind {
  const error = asFetchLikeError(value);
  if (cockpitStatus(value) === 409 || error.data?.error?.code === "conflict") return "conflict";
  if ((cockpitStatus(value) ?? 0) >= 500 || error.data?.error?.code === "unavailable") return "unavailable";
  return "unknown";
}

export function cockpitFailureMessage(value: unknown, subject: string): string {
  switch (cockpitFailureKind(value)) {
    case "conflict":
      return `${subject} changed elsewhere. Refresh the latest shared version before retrying; your text is retained.`;
    case "unavailable":
      return `${subject} is temporarily unavailable. Keep your work and retry when storage recovers.`;
    default:
      return `Could not update ${subject.toLowerCase()}. Your work is retained; retry when ready.`;
  }
}
