import type { ModelDescriptor, ModelListResult, ProviderConfig, ProviderCredential, ProviderResult, RefinementProvider } from "./types.ts";
import { getJson } from "./ProviderTransport.ts";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_MODEL_PAGES = 10;
const MAX_RAW_MODELS = 500;
const EXCLUDED_MODEL = /(?:embedding|imagen|image|veo|tts|robotics|aqa|computer[-_ ]?use)/i;

function isUsableModel(value: any): value is ModelDescriptor {
  return typeof value?.name === "string"
    && /(?:^|\/)gemini-/i.test(value.name)
    && !EXCLUDED_MODEL.test(value.name)
    && Number.isFinite(value.inputTokenLimit)
    && value.inputTokenLimit > 0
    && Number.isFinite(value.outputTokenLimit)
    && value.outputTokenLimit > 0
    && Array.isArray(value.supportedGenerationMethods)
    && value.supportedGenerationMethods.includes("generateContent");
}

function mapHttpFailure(status: number) {
  if (status === 401 || status === 403) return { kind: "auth" } as const;
  if (status === 429) return { kind: "rate_limited" } as const;
  if (status >= 500) return { kind: "delivery_unknown", cause: "server", status } as const;
  return { kind: "request_rejected", status } as const;
}

export class GeminiRefinementProvider implements RefinementProvider {
  readonly id = "gemini";
  private readonly request: FetchLike;

  constructor(request: FetchLike = fetch) { this.request = request; }

  async listModels(credential: Readonly<ProviderCredential>, signal: AbortSignal): Promise<ModelListResult> {
    const models: ModelDescriptor[] = [];
    let pageToken: string | null = null;
    let rawCount = 0;
    for (let page = 0; page < MAX_MODEL_PAGES; page++) {
        const url = new URL(MODELS_ENDPOINT);
        url.searchParams.set("pageSize", "50");
        url.searchParams.set("fields", "nextPageToken,models(name,version,inputTokenLimit,outputTokenLimit,supportedGenerationMethods)");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        let response: Awaited<ReturnType<typeof getJson>>;
        try {
          response = await getJson(url, { "x-goog-api-key": credential.secret }, signal, this.request === fetch ? undefined : this.request);
        } catch (error) {
          if (signal.aborted) throw error;
          console.warn("[SpicyLyrics:AI] Model discovery request failed", { errorType: error instanceof Error ? error.name : typeof error });
          return { ok: false, failure: { kind: "delivery_unknown", cause: "network" } };
        }
        if (response.status < 200 || response.status >= 300) return { ok: false, failure: mapHttpFailure(response.status) };
        const payload: any = response.body;
        if (!Array.isArray(payload?.models)) return { ok: false, failure: { kind: "protocol", detail: "models_not_array" } };
        rawCount += payload.models.length;
        if (rawCount > MAX_RAW_MODELS) return { ok: false, failure: { kind: "protocol", detail: "model_cap_exceeded" } };
        for (const raw of payload.models) {
          const descriptor = {
            name: raw?.name,
            version: typeof raw?.version === "string" ? raw.version : "unknown",
            inputTokenLimit: Number(raw?.inputTokenLimit),
            outputTokenLimit: Number(raw?.outputTokenLimit),
            supportedGenerationMethods: Array.isArray(raw?.supportedGenerationMethods) ? raw.supportedGenerationMethods.filter((method: unknown): method is string => typeof method === "string") : [],
          };
          if (isUsableModel(descriptor)) models.push(descriptor);
        }
        pageToken = typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : null;
        if (!pageToken) {
          return { ok: true, models: models.sort((left, right) => {
            const preferred = (model: ModelDescriptor) => model.name.endsWith("gemini-3.1-flash-lite") ? 0 : 1;
            return preferred(left) - preferred(right) || left.name.localeCompare(right.name);
          }) };
        }
    }
    return { ok: false, failure: { kind: "protocol", detail: "model_page_cap_exceeded" } };
  }

  async translateChunk(_request: any, _config: Readonly<ProviderConfig>, _signal: AbortSignal): Promise<ProviderResult> {
    return { ok: false, failure: { kind: "model_unavailable" } };
  }
}
