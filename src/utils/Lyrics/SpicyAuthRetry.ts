import type { ProviderAcquisitionOutcome } from "./ProviderAcquisition.ts";

export type SpicyAuthRejectionStatus = 401 | 403;

export type SpicyQueryAttempt<Outcome extends ProviderAcquisitionOutcome<unknown>> =
  | { kind: "auth-rejected"; status: SpicyAuthRejectionStatus }
  | { kind: "settled"; outcome: Outcome };

export type SpicyAuthRetryDeps<Outcome extends ProviderAcquisitionOutcome<unknown>> = {
  signal: AbortSignal;
  resolveToken: () => Promise<string>;
  invalidateToken: () => void;
  runAttempt: (token: string, signal: AbortSignal) => Promise<SpicyQueryAttempt<Outcome>>;
};

export function isSpicyAuthRejectionStatus(status: number): status is SpicyAuthRejectionStatus {
  return status === 401 || status === 403;
}

/**
 * Runs a Spicy query with one bounded token-invalidation retry after an auth rejection (401/403),
 * either on the outer HTTP status or inside the outer HTTP 200 envelope's `result.httpStatus`.
 * Never loops: a rejection on the retry attempt resolves as a normal upstream error.
 * The token text itself is never captured, logged, or embedded in any outcome.
 */
export async function acquireSpicyOutcomeWithBoundedAuthRetry<Outcome extends ProviderAcquisitionOutcome<unknown>>(deps: SpicyAuthRetryDeps<Outcome>): Promise<Outcome> {
  let token = await deps.resolveToken();
  if (deps.signal.aborted) return { kind: "aborted" } as Outcome;
  let attempt = await deps.runAttempt(token, deps.signal);
  if (attempt.kind === "auth-rejected") {
    if (deps.signal.aborted) return { kind: "aborted" } as Outcome;
    deps.invalidateToken();
    token = await deps.resolveToken();
    if (deps.signal.aborted) return { kind: "aborted" } as Outcome;
    attempt = await deps.runAttempt(token, deps.signal);
    if (attempt.kind === "auth-rejected") return { kind: "upstream-error", status: attempt.status } as Outcome;
  }
  return attempt.outcome;
}
