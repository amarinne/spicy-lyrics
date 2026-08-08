import { getJson, postJson } from "./ProviderTransport.ts";
import { buildSystemPrompt, validateProviderItems } from "./protocol.ts";
import { AI_MAX_RESPONSE_BYTES, type ModelDescriptor, type ModelListResult, type ProviderConfig, type ProviderCredential, type ProviderFailure, type ProviderResult, type RefinementProvider } from "./types.ts";
import { captureProviderExchange, getActiveProviderCaptureId } from "./DebugCapture.ts";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const EXCLUDED_MODEL = /(?:embedding|moderation|image|dall-e|audio|transcribe|tts|whisper|realtime|search|computer|codex)/i;

export function normalizeOpenAIBaseUrl(value: string): string {
  const url = new URL((value || DEFAULT_BASE_URL).trim());
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new TypeError("invalid_endpoint");
  if (url.username || url.password || url.search || url.hash) throw new TypeError("invalid_endpoint");
  return url.toString().replace(/\/$/, "");
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
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
    return text || null;
  }
  return null;
}

function finishReason(value: unknown): "stop" | "length" | "safety" | "other" {
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  if (value === "content_filter") return "safety";
  return "other";
}

function parseItems(text: string): Array<{ id: string; t: string }> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const payload = JSON.parse(fenced ? fenced[1] : trimmed);
  if (!Array.isArray(payload?.items)) throw new TypeError("items_not_array");
  return payload.items;
}

export type ModelProbeResult = { ok: true; usage: { input?: number; output?: number } } | { ok: false; failure: ProviderFailure };

function descriptor(raw: any): ModelDescriptor | null {
  const name = typeof raw?.id === "string" ? raw.id.trim() : "";
  if (!name || EXCLUDED_MODEL.test(name)) return null;
  return {
    name,
    version: typeof raw?.created === "number" ? String(raw.created) : typeof raw?.owned_by === "string" ? raw.owned_by : "unknown",
    inputTokenLimit: 32_768,
    outputTokenLimit: 8_192,
    supportedGenerationMethods: ["chat.completions"],
  };
}

export class OpenAIRefinementProvider implements RefinementProvider {
  readonly id = "openai";
  private readonly request?: FetchLike;
  private baseUrl: string;

  constructor(baseUrl = DEFAULT_BASE_URL, request?: FetchLike) {
    this.baseUrl = normalizeOpenAIBaseUrl(baseUrl);
    this.request = request;
  }

  setBaseUrl(baseUrl: string): void { this.baseUrl = normalizeOpenAIBaseUrl(baseUrl); }
  getBaseUrl(): string { return this.baseUrl; }

  async listModels(credential: Readonly<ProviderCredential>, signal: AbortSignal): Promise<ModelListResult> {
    let response: Awaited<ReturnType<typeof getJson>>;
    try {
      response = await getJson(new URL(`${this.baseUrl}/models`), {
        Accept: "application/json",
        Authorization: `Bearer ${credential.secret}`,
      }, signal, this.request);
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn("[SpicyLyrics:AI] Model discovery request failed", { provider: this.id, errorType: error instanceof Error ? error.name : typeof error });
      return { ok: false, failure: { kind: "delivery_unknown", cause: "network" } };
    }
    if (response.status < 200 || response.status >= 300) return { ok: false, failure: mapHttpFailure(response.status) };
    const rawModels = (response.body as any)?.data;
    if (!Array.isArray(rawModels)) return { ok: false, failure: { kind: "protocol", detail: "models_not_array" } };
    const models = rawModels.map(descriptor).filter((model): model is ModelDescriptor => model !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
    return { ok: true, models };
  }

  async probeModel(model: ModelDescriptor, credential: Readonly<ProviderCredential>, signal: AbortSignal): Promise<ModelProbeResult> {
    const request = { target: "en", items: [{ id: "P0", c: "ordinary" as const, s: "hola" }] };
    const result = await this.translateChunkInternal(request, {
      providerVersion: "openai-compatible-v1",
      endpoint: this.baseUrl,
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
    const captureId = captureEnabled ? getActiveProviderCaptureId() : null;
    let response: Awaited<ReturnType<typeof postJson>>;
    try {
      const providerRequest = {
        model: config.model.name,
        messages: [
          { role: "system", content: buildSystemPrompt(config.instructions, config.repair) },
          { role: "user", content: JSON.stringify({ target: request.target, items: request.items }) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: config.maxOutputTokens,
        stream: false,
      };
      response = await postJson(new URL(`${this.baseUrl}/chat/completions`), {
        Accept: "application/json",
        Authorization: `Bearer ${config.credential.secret}`,
      }, providerRequest, signal, AI_MAX_RESPONSE_BYTES, this.request);
      captureProviderExchange(captureId, { schema: 1, capturedAt: new Date().toISOString(), providerId: this.id, endpoint: this.baseUrl, model: config.model.name, repair: config.repair, status: response.status, request: providerRequest, response: response.body ?? null });
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof RangeError && error.message.startsWith("response_oversized:")) {
        return { ok: false, failure: { kind: "oversized", bytes: Number(error.message.split(":")[1]) || AI_MAX_RESPONSE_BYTES + 1 } };
      }
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
      usage: { input: Number.isFinite(response.body?.usage?.prompt_tokens) ? response.body.usage.prompt_tokens : undefined, output: Number.isFinite(response.body?.usage?.completion_tokens) ? response.body.usage.completion_tokens : undefined },
      finish: finishReason(response.body?.choices?.[0]?.finish_reason),
      raw: { bytes: response.bytes ?? 0 },
    };
  }
}
