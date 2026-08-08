import type { ModelListResult, ProviderConfig, ProviderCredential, ProviderResult, RefinementProvider, ReplayEntry } from "./types.ts";

export function exportReplay(entries: ReadonlyArray<ReplayEntry>): string {
  return JSON.stringify({ schema: 1, entries }, null, 2);
}

export function importReplay(serialized: string): ReplayEntry[] {
  const parsed = JSON.parse(serialized);
  if (parsed?.schema !== 1 || !Array.isArray(parsed.entries)) throw new TypeError("invalid replay");
  return parsed.entries;
}

export class ReplayProvider implements RefinementProvider {
  readonly id = "replay";
  private cursor = 0;
  private readonly entries: ReadonlyArray<ReplayEntry>;
  constructor(entries: ReadonlyArray<ReplayEntry>) { this.entries = entries; }
  async listModels(_credential: Readonly<ProviderCredential>, signal: AbortSignal): Promise<ModelListResult> {
    if (signal.aborted) throw signal.reason;
    const models = Array.from(new Map(this.entries.map((entry) => [entry.model.name, entry.model])).values());
    return { ok: true, models };
  }
  async translateChunk(request: { target: string; items: ReadonlyArray<{ id: string; c: "ordinary" | "adlib"; s: string }> }, _config: Readonly<ProviderConfig>, signal: AbortSignal): Promise<ProviderResult> {
    if (signal.aborted) throw signal.reason;
    const entry = this.entries[this.cursor++];
    if (!entry || JSON.stringify(entry.request) !== JSON.stringify(request)) return { ok: false, failure: { kind: "protocol", detail: "replay request mismatch" } };
    return structuredClone(entry.response);
  }
}
