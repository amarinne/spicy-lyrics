import { captureProviderExchange } from "./DebugCapture.ts";
import { getJson, postJson } from "./ProviderTransport.ts";
import { buildSystemPrompt, validateProviderItems } from "./protocol.ts";
import { AI_MAX_RESPONSE_BYTES, type ModelDescriptor, type ModelListResult, type ProviderConfig, type ProviderCredential, type ProviderFailure, type ProviderResult, type RefinementProvider } from "./types.ts";

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
  if (status === 404) return { kind: "model_unavailable" } as const;
  if (status >= 500) return { kind: "delivery_unknown", cause: "server", status } as const;
  return { kind: "request_rejected", status } as const;
}

function retryAfterMs(headers?: Headers): number | undefined {
  const value = headers?.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - Date.now())) : undefined;
}

function responseText(payload: any): string | null {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((part) => typeof part?.text === "string" ? part.text : "").join("");
  return text || null;
}

function finishReason(value: unknown): "stop" | "length" | "safety" | "other" {
  if (value === "STOP") return "stop";
  if (value === "MAX_TOKENS") return "length";
  if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(String(value))) return "safety";
  return "other";
}

function parseItems(text: string): Array<{ id: string; t: string }> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const payload = JSON.parse(fenced ? fenced[1] : trimmed);
  if (!Array.isArray(payload?.items)) throw new TypeError("items_not_array");
  return payload.items;
}

export type GeminiModelProbeResult = { ok: true; usage: { input?: number; output?: number } } | { ok: false; failure: ProviderFailure };

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

  async probeModel(model: ModelDescriptor, credential: Readonly<ProviderCredential>, signal: AbortSignal): Promise<GeminiModelProbeResult> {
    const request = { target: "en", items: [{ id: "P0", c: "ordinary" as const, s: "hola" }] };
    const result = await this.translateChunkInternal(request, {
      providerVersion: "v1beta",
      model,
      targetLang: "en",
      promptVersion: 1,
      temperature: 0,
      contextMode: "document_or_v1_chunks",
      credential,
      repair: false,
      maxOutputTokens: 32,
    }, signal, false);
    if (!result.ok) return result;
    try { validateProviderItems(result.items, request.items); }
    catch { return { ok: false, failure: { kind: "protocol", detail: "probe_contract_invalid" } }; }
    return { ok: true, usage: result.usage };
  }

  async translateChunk(request: { target: string; items: ReadonlyArray<{ id: string; c: "ordinary" | "adlib"; s: string }> }, config: Readonly<ProviderConfig>, signal: AbortSignal): Promise<ProviderResult> {
    return this.translateChunkInternal(request, config, signal, true);
  }

  private async translateChunkInternal(request: { target: string; items: ReadonlyArray<{ id: string; c: "ordinary" | "adlib"; s: string }> }, config: Readonly<ProviderConfig>, signal: AbortSignal, captureEnabled: boolean): Promise<ProviderResult> {
    const endpoint = `${MODELS_ENDPOINT.replace(/\/models$/, "")}/${config.model.name}:generateContent`;
    const providerRequest = {
      systemInstruction: { parts: [{ text: buildSystemPrompt(config.layer ?? "meaning", config.targetLang, config.instructions, config.repair) }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify({ target: request.target, items: request.items }) }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: config.maxOutputTokens,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { items: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, t: { type: "STRING" } }, required: ["id", "t"] } } },
          required: ["items"],
        },
      },
    };
    let response: Awaited<ReturnType<typeof postJson>>;
    try {
      response = await postJson(new URL(endpoint), { "x-goog-api-key": config.credential.secret }, providerRequest, signal, AI_MAX_RESPONSE_BYTES, this.request === fetch ? undefined : this.request);
      if (captureEnabled) captureProviderExchange(config.captureId ?? null, { schema: 1, capturedAt: new Date().toISOString(), providerId: this.id, endpoint, model: config.model.name, repair: config.repair, status: response.status, request: providerRequest, response: response.body ?? null });
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof RangeError && error.message.startsWith("response_oversized:")) return { ok: false, failure: { kind: "oversized", bytes: Number(error.message.split(":")[1]) || AI_MAX_RESPONSE_BYTES + 1 } };
      console.warn("[SpicyLyrics:AI] Provider request failed", { provider: this.id, model: config.model.name, errorType: error instanceof Error ? error.name : typeof error });
      return { ok: false, failure: { kind: "delivery_unknown", cause: "network" } };
    }
    if (response.status < 200 || response.status >= 300) {
      const failure = mapHttpFailure(response.status);
      return failure.kind === "rate_limited" ? { ok: false, failure: { ...failure, retryAfterMs: retryAfterMs(response.headers) } } : { ok: false, failure };
    }
    const text = responseText(response.body);
    if (!text) return { ok: false, failure: { kind: "protocol", detail: "content_missing" } };
    let items: Array<{ id: string; t: string }>;
    try { items = parseItems(text); }
    catch (error) { return { ok: false, failure: { kind: "protocol", detail: error instanceof Error ? error.message : "invalid_json" } }; }
    return {
      ok: true,
      items,
      usage: {
        input: Number.isFinite((response.body as any)?.usageMetadata?.promptTokenCount) ? (response.body as any).usageMetadata.promptTokenCount : undefined,
        output: Number.isFinite((response.body as any)?.usageMetadata?.candidatesTokenCount) ? (response.body as any).usageMetadata.candidatesTokenCount : undefined,
      },
      finish: finishReason((response.body as any)?.candidates?.[0]?.finishReason),
      raw: { bytes: response.bytes ?? 0 },
    };
  }
}
