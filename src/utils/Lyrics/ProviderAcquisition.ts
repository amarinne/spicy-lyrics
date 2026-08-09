export type ProviderAcquisitionOutcome<Result> =
  | { kind: "lyrics"; result: Result }
  | { kind: "queued" }
  | { kind: "no-match" }
  | { kind: "timeout" }
  | { kind: "aborted" }
  | { kind: "rate-limited"; retryAfterMs?: number }
  | { kind: "upstream-error"; status: number }
  | { kind: "error"; error: unknown };

export class ProviderResponseError extends Error {
  readonly outcome: Extract<ProviderAcquisitionOutcome<never>, { kind: "timeout" | "aborted" | "rate-limited" | "upstream-error" }>;

  constructor(outcome: Extract<ProviderAcquisitionOutcome<never>, { kind: "timeout" | "aborted" | "rate-limited" | "upstream-error" }>) {
    super(outcome.kind);
    this.name = "ProviderResponseError";
    this.outcome = outcome;
  }
}

export type ProviderAcquisitionRecord<Provider, Result> = {
  provider: Provider;
  orderIndex: number;
  outcome: ProviderAcquisitionOutcome<Result>;
};

export async function runProviderAcquisition<Result>(
  task: (signal: AbortSignal) => Promise<ProviderAcquisitionOutcome<Result>>,
  parentSignal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<ProviderAcquisitionOutcome<Result>> {
  if (parentSignal?.aborted) return { kind: "aborted" };
  const controller = new AbortController();
  const abortFromParent = () => controller.abort("parent");
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (error instanceof ProviderResponseError) return error.outcome;
    if (controller.signal.aborted) {
      return controller.signal.reason === "timeout" ? { kind: "timeout" } : { kind: "aborted" };
    }
    return { kind: "error", error };
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export async function acquireProviderOutcomes<Provider, Result>(
  order: readonly Provider[],
  mode: "sequential" | "concurrent",
  acquire: (provider: Provider, orderIndex: number) => Promise<ProviderAcquisitionOutcome<Result>>,
): Promise<Array<ProviderAcquisitionRecord<Provider, Result>>> {
  if (mode === "concurrent") {
    return Promise.all(order.map(async (provider, orderIndex) => ({ provider, orderIndex, outcome: await acquire(provider, orderIndex) })));
  }
  const records: Array<ProviderAcquisitionRecord<Provider, Result>> = [];
  for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
    const provider = order[orderIndex];
    const outcome = await acquire(provider, orderIndex);
    records.push({ provider, orderIndex, outcome });
    if (outcome.kind === "lyrics") break;
  }
  return records;
}
