import { ServiceUnavailableError } from "../API/CircuitBreaker.ts";
import type { ProviderAcquisitionOutcome } from "./ProviderAcquisition.ts";

export type SpicyAuthRejectionStatus = 401;

export type SpicyQueryAttempt<Outcome extends ProviderAcquisitionOutcome<unknown>> =
  | { kind: "auth-rejected"; status: SpicyAuthRejectionStatus }
  | { kind: "settled"; outcome: Outcome };

export type SpicyAuthRetryDeps<Outcome extends ProviderAcquisitionOutcome<unknown>> = {
  signal: AbortSignal;
  resolveToken: () => Promise<string>;
  invalidateToken: (rejectedToken: string) => void;
  runAttempt: (token: string, signal: AbortSignal) => Promise<SpicyQueryAttempt<Outcome>>;
};

export function isSpicyAuthRejectionStatus(status: number): status is SpicyAuthRejectionStatus {
  return status === 401;
}

/**
 * Runs a Spicy query with one bounded token-invalidation retry after the
 * response envelope's 401 (`result.httpStatus`). This matches official clients:
 * only the envelope 401 retires a token — a transport-level 401 is a plain
 * error and a 403 is not an auth rejection at all. Never loops: a rejection on
 * the retry attempt resolves as a normal upstream error. If the circuit breaker
 * holds the retry back, the original 401 is kept rather than overwritten by the
 * breaker's own, less accurate, reason. The token text itself is never
 * captured, logged, or embedded in any outcome.
 */
export async function acquireSpicyOutcomeWithBoundedAuthRetry<Outcome extends ProviderAcquisitionOutcome<unknown>>(deps: SpicyAuthRetryDeps<Outcome>): Promise<Outcome> {
  let token = await deps.resolveToken();
  if (deps.signal.aborted) return { kind: "aborted" } as Outcome;
  let attempt = await deps.runAttempt(token, deps.signal);
  if (attempt.kind === "auth-rejected") {
    if (deps.signal.aborted) return { kind: "aborted" } as Outcome;
    const rejectedToken = token;
    const rejectedStatus = attempt.status;
    const rejection = { kind: "upstream-error", status: rejectedStatus } as Outcome;
    deps.invalidateToken(rejectedToken);
    try {
      token = await deps.resolveToken();
    } catch {
      return deps.signal.aborted ? { kind: "aborted" } as Outcome : rejection;
    }
    if (deps.signal.aborted) return { kind: "aborted" } as Outcome;
    if (!token || token === rejectedToken) return rejection;
    try {
      attempt = await deps.runAttempt(token, deps.signal);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) return rejection;
      throw error;
    }
    if (attempt.kind === "auth-rejected") return { kind: "upstream-error", status: attempt.status } as Outcome;
  }
  return attempt.outcome;
}
