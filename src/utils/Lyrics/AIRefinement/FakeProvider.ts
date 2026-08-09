import type { ModelDescriptor, ModelListResult, ProviderConfig, ProviderCredential, ProviderRequest, ProviderResult, RefinementProvider } from "./types.ts";

export type FakeProviderStep = ProviderResult | ((request: ProviderRequest, config: Readonly<ProviderConfig>, signal: AbortSignal) => ProviderResult | Promise<ProviderResult>);

export class FakeRefinementProvider implements RefinementProvider {
  readonly id = "fake";
  readonly calls: Array<{ request: unknown; config: ProviderConfig }> = [];
  readonly models: ModelDescriptor[];
  private steps: FakeProviderStep[];

  constructor(steps: FakeProviderStep[] = [], models: ModelDescriptor[] = [{ name: "fake-model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["generateContent"] }]) {
    this.steps = [...steps];
    this.models = models;
  }

  async listModels(_credential: Readonly<ProviderCredential>, signal: AbortSignal): Promise<ModelListResult> {
    if (signal.aborted) throw signal.reason;
    return { ok: true, models: this.models };
  }

  async translateChunk(request: ProviderRequest, config: Readonly<ProviderConfig>, signal: AbortSignal): Promise<ProviderResult> {
    if (signal.aborted) throw signal.reason;
    this.calls.push({ request: structuredClone(request), config: structuredClone(config) });
    const step = this.steps.shift();
    if (typeof step === "function") return step(request, config, signal);
    if (step) return step;
    return {
      ok: true,
      items: request.items.map((item) => ({ id: item.id, t: item.c === "adlib" ? item.s : `AI ${item.s}` })),
      usage: { input: 10, output: 10 },
      finish: "stop",
      raw: { bytes: 64 },
    };
  }
}
