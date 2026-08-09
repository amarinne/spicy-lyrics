import { validateProviderItems } from "./protocol.ts";
import { AI_MAX_ATTEMPTS, AI_MAX_CONFIGURED_OUTPUT_TOKENS, AI_TOKEN_BUDGET, type ChunkFailure, type PlannedChunk, type ProviderConfig, type ProviderFailure, type RefinementChunkRecord, type RefinementProvider } from "./types.ts";

export type ChunkExecution = { ok: true; items: Array<{ id: string; t: string }>; record: RefinementChunkRecord; budgetConsumed: number } | { ok: false; failure: ChunkFailure; record: RefinementChunkRecord; budgetConsumed: number };

function mapFailure(failure: ProviderFailure): ChunkFailure {
  switch (failure.kind) {
    case "auth": return { reason: "auth_rejected" };
    case "quota": return { reason: "quota_exhausted" };
    case "rate_limited": return { reason: "rate_limited" };
    case "delivery_unknown": return { reason: "delivery_unknown", status: failure.status };
    case "request_rejected": return { reason: "request_rejected", status: failure.status };
    case "oversized": return { reason: "oversized" };
    case "model_unavailable": return { reason: "model_unavailable" };
    case "protocol": return { reason: "protocol_invalid", detail: failure.detail };
  }
}

function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

export async function executeChunk(args: {
  provider: RefinementProvider;
  chunk: PlannedChunk;
  config: ProviderConfig;
  signal: AbortSignal;
  budgetAlreadyConsumed: number;
  previous?: RefinementChunkRecord;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<ChunkExecution> {
  const wait = args.wait ?? abortableWait;
  const previous = args.previous;
  if (previous?.status === "complete") throw new TypeError("completed chunk must not be resent");
  const record: RefinementChunkRecord = previous ? structuredClone(previous) : { ids: args.chunk.items.map((item) => item.id), requestJson: args.chunk.requestJson, status: "pending", attempts: 0, repairs: 0, tokens: { input: 0, output: 0 }, usageEstimated: false };
  let totalBudget = args.budgetAlreadyConsumed;
  while (record.attempts < AI_MAX_ATTEMPTS) {
    const remainingOutputBudget = AI_TOKEN_BUDGET - totalBudget - args.chunk.estimatedInputTokens;
    const maxOutputTokens = Math.min(args.config.model.outputTokenLimit, AI_MAX_CONFIGURED_OUTPUT_TOKENS, remainingOutputBudget);
    if (maxOutputTokens < args.chunk.estimatedOutputTokens) {
      const failure = { reason: "budget_exceeded" } as const;
      record.status = "failed"; record.failure = failure;
      return { ok: false, failure, record, budgetConsumed: totalBudget - args.budgetAlreadyConsumed };
    }
    const reservation = args.chunk.estimatedInputTokens + maxOutputTokens;
    record.attempts++;
    const result = await args.provider.translateChunk({ context: args.chunk.context, target: args.config.targetLang, items: args.chunk.items }, { ...args.config, repair: record.repairs > 0, maxOutputTokens }, args.signal);
    if (!result.ok) {
      if (result.failure.kind === "rate_limited" && record.attempts < AI_MAX_ATTEMPTS) {
        totalBudget += reservation; record.usageEstimated = true; record.tokens.input += args.chunk.estimatedInputTokens; record.tokens.output += maxOutputTokens;
        await wait(Math.min(result.failure.retryAfterMs ?? 1000, 30_000), args.signal);
        continue;
      }
      totalBudget += reservation; record.usageEstimated = true; record.tokens.input += args.chunk.estimatedInputTokens; record.tokens.output += maxOutputTokens;
      const failure = mapFailure(result.failure); record.status = "failed"; record.failure = failure;
      return { ok: false, failure, record, budgetConsumed: totalBudget - args.budgetAlreadyConsumed };
    }
    const input = result.usage.input ?? args.chunk.estimatedInputTokens;
    const output = result.usage.output ?? maxOutputTokens;
    const estimated = result.usage.input === undefined || result.usage.output === undefined;
    totalBudget += input + output; record.tokens.input += input; record.tokens.output += output; record.usageEstimated ||= estimated;
    if (result.finish === "length") {
      const failure = { reason: "truncated" } as const; record.status = "failed"; record.failure = failure;
      return { ok: false, failure, record, budgetConsumed: totalBudget - args.budgetAlreadyConsumed };
    }
    if (result.finish !== "stop") {
      const failure = { reason: "provider_refused" } as const; record.status = "failed"; record.failure = failure;
      return { ok: false, failure, record, budgetConsumed: totalBudget - args.budgetAlreadyConsumed };
    }
    try {
      const items = validateProviderItems(result.items, args.chunk.items, args.config.layer ?? "meaning", args.config.targetLang, new Set(args.chunk.allowUnchangedIds));
      record.status = "complete"; delete record.failure;
      return { ok: true, items, record, budgetConsumed: totalBudget - args.budgetAlreadyConsumed };
    } catch (error) {
      if (record.attempts < AI_MAX_ATTEMPTS) { record.repairs++; continue; }
      const failure = { reason: "protocol_invalid", detail: error instanceof Error ? error.message : "invalid" } as const;
      record.status = "failed"; record.failure = failure;
      return { ok: false, failure, record, budgetConsumed: totalBudget - args.budgetAlreadyConsumed };
    }
  }
  throw new Error("unreachable attempt state");
}
