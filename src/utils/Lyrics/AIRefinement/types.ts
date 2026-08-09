export const AI_REFINEMENT_SCHEMA = 1;
export const AI_SOUND_REFINEMENT_SCHEMA = 2;
export const AI_ORIGINAL_SNAPSHOT_SCHEMA = 1;
export const AI_PROMPT_VERSION = 3;
export const AI_ITERATION_PROMPT_VERSION = 2;
export const AI_CHUNK_PLAN_VERSION = 3;
export const AI_TOKEN_BUDGET = 12_000;
export const AI_MAX_DOCUMENT_ROWS = 512;
export const AI_MAX_DOCUMENT_SOURCE_BYTES = 64 * 1024;
export const AI_MAX_SOURCE_ITEM_BYTES = 2 * 1024;
export const AI_MAX_REQUEST_BYTES = 32 * 1024;
export const AI_MAX_RESPONSE_BYTES = 128 * 1024;
export const AI_MAX_TRANSLATED_ITEM_BYTES = 4 * 1024;
export const AI_MAX_CONFIGURED_OUTPUT_TOKENS = 8_192;
export const AI_MAX_ATTEMPTS = 2;
export type DerivedLayer = "meaning" | "sound";
export type SoundOrthography = "Latin" | "Kana" | "Hangul" | "Cyrillic";
export type RefinementSchema = typeof AI_REFINEMENT_SCHEMA | typeof AI_SOUND_REFINEMENT_SCHEMA;
export type VoiceHint = "primary" | "alternate" | "background";
export type LyricContext = { title: string | null; artists: string[]; album: string | null };
export type ProviderRequestItem = { id: string; c: "ordinary" | "adlib"; v: VoiceHint | null; s: string; p?: string };
export type ProviderRequest = { context: LyricContext; target: string; items: ReadonlyArray<ProviderRequestItem> };

export type RefinementLineClass = "ordinary" | "adlib" | "structural";
export type SendDisposition = "sent" | "structural" | "skipped";

export type EnumeratedLine = {
  id: string;
  class: RefinementLineClass;
  sendDisposition: SendDisposition;
  sourceText: string;
  voice: VoiceHint | null;
  allowUnchanged: boolean;
  baselineTranslatedText?: string;
  target: Record<string, unknown> | null;
  targetField: "TranslatedText" | "RomanizedText" | null;
};

export type CanonicalOriginalSnapshot = {
  schema: typeof AI_ORIGINAL_SNAPSHOT_SCHEMA;
  targetLang: string | null;
  document: Record<string, unknown>;
};

export type ModelLimits = { inputTokenLimit: number; outputTokenLimit: number };
export type ProviderId = "gemini" | "openai";
export type ModelDescriptor = ModelLimits & {
  name: string;
  version: string;
  supportedGenerationMethods: ReadonlyArray<string>;
};
export type ProviderCredential = { secret: string };
export type ProviderConfig = {
  endpoint?: string;
  providerVersion: string;
  model: ModelDescriptor;
  targetLang: string;
  layer?: DerivedLayer;
  instructions?: string;
  context: LyricContext;
  promptVersion: number;
  temperature: 0;
  contextMode: "document_or_v1_chunks";
  credential: Readonly<ProviderCredential>;
  repair: boolean;
  iteration?: boolean;
  maxOutputTokens: number;
  captureId?: string | null;
};

export type ProviderFailure =
  | { kind: "auth" }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "quota" }
  | { kind: "request_rejected"; status: number }
  | { kind: "delivery_unknown"; cause: "network" | "timeout" | "server"; status?: number }
  | { kind: "oversized"; bytes: number }
  | { kind: "model_unavailable" }
  | { kind: "protocol"; detail: string };

export type ModelListResult =
  | { ok: true; models: ReadonlyArray<ModelDescriptor> }
  | { ok: false; failure: ProviderFailure };
export type ProviderResult =
  | { ok: true; items: Array<{ id: string; t: string }>; usage: { input?: number; output?: number }; finish: "stop" | "length" | "safety" | "other"; raw: { bytes: number } }
  | { ok: false; failure: ProviderFailure };

export interface RefinementProvider {
  readonly id: string;
  listModels(credential: Readonly<ProviderCredential>, signal: AbortSignal): Promise<ModelListResult>;
  translateChunk(
    req: ProviderRequest,
    config: Readonly<ProviderConfig>,
    signal: AbortSignal,
  ): Promise<ProviderResult>;
}

export type PlannedChunk = {
  id: string;
  context: LyricContext;
  items: ReadonlyArray<ProviderRequestItem>;
  allowUnchangedIds: ReadonlyArray<string>;
  requestJson: string;
  sourceUtf8Bytes: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
};
export type ChunkPlan = { version: typeof AI_CHUNK_PLAN_VERSION; chunks: ReadonlyArray<PlannedChunk>; enumerableRows: number; canonicalSourceUtf8Bytes: number };

export type RefinementFailureReason = "no_credential" | "baseline_unavailable" | "alignment_required" | "model_unavailable" | "auth_rejected" | "quota_exhausted" | "rate_limited" | "delivery_unknown" | "protocol_invalid" | "request_rejected" | "provider_refused" | "truncated" | "oversized" | "budget_exceeded";
export type CancellationReason = "track_change" | "user" | "config_changed" | "credential_changed" | "baseline_superseded" | "experiment_disabled";
export type ChunkFailure = { reason: RefinementFailureReason; status?: number; detail?: string };
export type RefinementChunkRecord = { ids: string[]; requestJson: string; status: "pending" | "complete" | "failed"; attempts: number; repairs: number; tokens: { input: number; output: number }; usageEstimated: boolean; failure?: ChunkFailure };
export type RefinementRecord = {
  key: string;
  trackUri: string;
  trackLabel?: string;
  schema: RefinementSchema;
  configId: string;
  docDigest: string;
  chunkPlanVersion: typeof AI_CHUNK_PLAN_VERSION;
  providerId: string;
  providerVersion: string;
  modelName: string;
  targetLang: string;
  sourceLanguage?: string;
  layer?: DerivedLayer;
  parentRecordKey?: string;
  rootRecordKey?: string;
  parentOutputDigest?: string;
  revisionInstructions?: string;
  revisionNumber?: number;
  createdAt: number;
  lastAccessedAt: number;
  bytes: number;
  status: "partial" | "complete" | "failed";
  tokens: { input: number; output: number };
  usageEstimated: boolean;
  budgetConsumed: number;
  items: Record<string, { translatedText: string; provenance: "ai" }>;
  chunks: Record<string, RefinementChunkRecord>;
};

export interface RefinementCache {
  get(key: string): Promise<RefinementRecord | undefined>;
  put(record: RefinementRecord): Promise<void>;
  delete(key: string): Promise<void>;
  deleteTrack(trackUri: string): Promise<void>;
  clear(): Promise<void>;
  listByTrackConfig(trackUri: string, configId: string): Promise<RefinementRecord[]>;
  listByTrack(trackUri: string): Promise<RefinementRecord[]>;
  pin(key: string): void;
  unpin(key: string): void;
}

export type ReplayEntry = { schema: 1; request: ProviderRequest; response: Extract<ProviderResult, { ok: true }>; model: ModelDescriptor };
