import { isMeaningfullyDifferent } from "../TextCompare.ts";
import { cloneSnapshotDocument, enumerateRefinementLines } from "./document.ts";
import { refinementRecordKey, sumBudgetConsumed } from "./cache.ts";
import { buildConfigId, buildDocumentDigest, planChunks } from "./protocol.ts";
import { executeChunk } from "./runtime.ts";
import { AI_CHUNK_PLAN_VERSION, AI_PROMPT_VERSION, AI_REFINEMENT_SCHEMA, type CancellationReason, type CanonicalOriginalSnapshot, type ModelDescriptor, type ProviderCredential, type RefinementCache, type RefinementFailureReason, type RefinementProvider, type RefinementRecord } from "./types.ts";
import { captureProviderBaseline } from "./DebugCapture.ts";

export type CoordinatorConfig = { providerId?: string; providerVersion: string; endpoint?: string; model: ModelDescriptor; targetLang: string; credential: ProviderCredential | null };
export type RefinementState = {
  status: "idle" | "requested" | "refining" | "refined" | "unchanged" | "failed" | "cancelled";
  done?: number;
  total?: number;
  reason?: RefinementFailureReason | CancellationReason;
  cacheWarning?: "write_failed";
  persistenceWarning?: "denied";
  tokens?: { refine: { input: number; output: number }; session: { input: number; output: number } };
  origin?: "baseline" | "overlay";
  runId?: number;
};
type BaselineSession = { document: any; snapshot: CanonicalOriginalSnapshot; stage: "intermediate" | "final"; revision: number; docDigest?: string; rows?: ReturnType<typeof enumerateRefinementLines>; configId?: string };
type ActiveRun = { trackUri: string; baselineRevision: number; configId: string; configRevision: number; credentialRevision: number; runId: number; controller: AbortController };

export class AIRefinementCoordinator {
  private readonly deps: {
    cache: RefinementCache;
    provider?: RefinementProvider;
    getProvider?: (providerId: string) => RefinementProvider | null;
    getTrackLabel?: (trackUri: string) => string | undefined;
    getConfig: () => Promise<CoordinatorConfig | null>;
    publish: (trackUri: string, document: any, origin: "baseline" | "overlay") => void;
    ensurePersistence?: () => Promise<boolean>;
  };
  private baselines = new Map<string, BaselineSession>();
  private overlays = new Map<string, Record<string, string>>();
  private states = new Map<string, RefinementState>();
  private listeners = new Set<(trackUri: string, state: RefinementState) => void>();
  private suppressed = new Set<string>();
  private active: ActiveRun | null = null;
  private currentTrackUri: string | null = null;
  private revision = 0;
  private runId = 0;
  private credentialRevision = 0;
  private configRevision = 0;
  private enabled = false;
  private unpersistedBudget = new Map<string, number>();
  private sessionTokens = { input: 0, output: 0 };

  constructor(deps: {
    cache: RefinementCache;
    provider?: RefinementProvider;
    getProvider?: (providerId: string) => RefinementProvider | null;
    getTrackLabel?: (trackUri: string) => string | undefined;
    getConfig: () => Promise<CoordinatorConfig | null>;
    publish: (trackUri: string, document: any, origin: "baseline" | "overlay") => void;
    ensurePersistence?: () => Promise<boolean>;
  }) { this.deps = deps; }

  acceptBaseline(trackUri: string, document: any, stage: "intermediate" | "final", originalSnapshot: CanonicalOriginalSnapshot): void {
    const revision = ++this.revision;
    if (this.active?.trackUri === trackUri) this.cancel(trackUri, "baseline_superseded");
    const session = { document: structuredClone(document), snapshot: originalSnapshot, stage, revision };
    this.baselines.set(trackUri, session);
    this.overlays.delete(trackUri);
    this.publishBaseline(trackUri);
    if (stage === "final") void this.prepareFinalBaseline(trackUri, revision);
  }

  onTrackChanged(trackUri: string | null): void {
    if (this.currentTrackUri && this.currentTrackUri !== trackUri) {
      this.cancel(this.currentTrackUri, "track_change");
      this.overlays.delete(this.currentTrackUri);
      for (const key of this.suppressed) if (key.startsWith(`${this.currentTrackUri}|`)) this.suppressed.delete(key);
    }
    this.currentTrackUri = trackUri;
  }

  refine(trackUri: string): void {
    if (this.active?.trackUri === trackUri) return;
    const session = this.baselines.get(trackUri);
    const identity: ActiveRun = { trackUri, baselineRevision: session?.revision ?? -1, configId: "", configRevision: this.configRevision, credentialRevision: this.credentialRevision, runId: ++this.runId, controller: new AbortController() };
    this.active = identity;
    this.setState(trackUri, { status: "requested", runId: identity.runId });
    void this.runRefinement(identity).catch(() => {
      if (this.active?.runId === identity.runId) this.failActive(identity, "delivery_unknown");
    });
  }

  cancel(trackUri: string, reason: CancellationReason): void {
    if (this.active?.trackUri !== trackUri) return;
    this.active.controller.abort(reason);
    this.active = null;
    this.setState(trackUri, { status: "cancelled", reason });
  }

  restoreBaseline(trackUri: string): void {
    const session = this.baselines.get(trackUri);
    if (!session?.configId || !session.docDigest) return;
    this.cancel(trackUri, "user");
    this.overlays.delete(trackUri);
    this.suppressed.add(this.suppressionKey(trackUri, session.configId, session.docDigest));
    this.publishBaseline(trackUri);
    this.setState(trackUri, { status: "idle", origin: "baseline" });
  }

  subscribe(cb: (trackUri: string, state: RefinementState) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  getState(trackUri: string): RefinementState { return this.states.get(trackUri) ?? { status: "idle" }; }
  getBaselineDocument(trackUri: string): any | undefined { const document = this.baselines.get(trackUri)?.document; return document ? structuredClone(document) : undefined; }
  invalidateBaseline(trackUri: string): void { this.cancel(trackUri, "user"); this.overlays.delete(trackUri); this.baselines.delete(trackUri); }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      if (this.active) this.cancel(this.active.trackUri, "experiment_disabled");
      for (const trackUri of this.overlays.keys()) { this.overlays.delete(trackUri); this.publishBaseline(trackUri); }
    } else if (this.currentTrackUri) {
      const session = this.baselines.get(this.currentTrackUri);
      if (session?.stage === "final") void this.prepareFinalBaseline(this.currentTrackUri, session.revision);
    }
  }

  notifyConfigChanged(): void {
    this.configRevision++;
    if (this.active) this.cancel(this.active.trackUri, "config_changed");
    const affected = [...this.overlays.keys()];
    this.overlays.clear();
    for (const [trackUri, session] of this.baselines) {
      session.rows = undefined; session.docDigest = undefined; session.configId = undefined;
      if (affected.includes(trackUri)) { this.publishBaseline(trackUri); this.setState(trackUri, { status: "idle", origin: "baseline" }); }
      if (this.enabled && session.stage === "final") void this.prepareFinalBaseline(trackUri, session.revision, this.configRevision);
    }
  }
  notifyCredentialChanged(): void {
    this.credentialRevision++;
    if (this.active) this.cancel(this.active.trackUri, "credential_changed");
  }

  async clearTrack(trackUri: string): Promise<void> { this.cancel(trackUri, "user"); this.overlays.delete(trackUri); await this.deps.cache.deleteTrack(trackUri); this.publishBaseline(trackUri); }
  async clearAll(): Promise<void> {
    if (this.active) this.cancel(this.active.trackUri, "user");
    const affected = [...this.overlays.keys()];
    this.overlays.clear();
    await this.deps.cache.clear();
    for (const trackUri of affected) { this.publishBaseline(trackUri); this.setState(trackUri, { status: "idle", origin: "baseline" }); }
  }

  private async prepareFinalBaseline(trackUri: string, revision: number, configRevision = this.configRevision): Promise<void> {
    const session = this.baselines.get(trackUri);
    if (!session || session.revision !== revision || session.stage !== "final") return;
    const config = await this.deps.getConfig();
    if (!config) return;
    const provider = this.providerFor(config);
    if (!provider) return;
    if (this.baselines.get(trackUri) !== session || session.revision !== revision || this.configRevision !== configRevision) return;
    const sourceRows = enumerateRefinementLines(cloneSnapshotDocument(session.snapshot), config.targetLang);
    const baselineRows = enumerateRefinementLines(session.document, config.targetLang);
    const byId = new Map(baselineRows.map((row) => [row.id, row]));
    const rows = sourceRows.map((row) => ({ ...row, baselineTranslatedText: byId.get(row.id)?.baselineTranslatedText }));
    const docDigest = await buildDocumentDigest(rows);
    if (this.baselines.get(trackUri) !== session || session.revision !== revision || this.configRevision !== configRevision) return;
    const configId = await this.configId(config, provider);
    if (this.baselines.get(trackUri) !== session || session.revision !== revision || this.configRevision !== configRevision) return;
    session.rows = rows; session.docDigest = docDigest; session.configId = configId;
    if (!this.enabled || !this.baselineEligible(trackUri, session, config) || this.suppressed.has(this.suppressionKey(trackUri, configId, docDigest))) return;
    const cached = await this.deps.cache.get(refinementRecordKey(trackUri, configId, docDigest));
    if (this.baselines.get(trackUri) !== session || session.revision !== revision || this.configRevision !== configRevision || session.configId !== configId || session.docDigest !== docDigest) return;
    if (cached?.status === "complete") this.applyRecord(trackUri, session, cached);
  }

  private async runRefinement(identity: ActiveRun): Promise<void> {
    const trackUri = identity.trackUri;
    let session = this.baselines.get(trackUri);
    if (!this.enabled || !session || session.revision !== identity.baselineRevision) { this.failActive(identity, "baseline_unavailable"); return; }
    const config = await this.deps.getConfig();
    if (!this.identityCurrent(identity)) return;
    if (!config?.credential) { this.failActive(identity, "no_credential"); return; }
    const provider = this.providerFor(config);
    if (!provider) { this.failActive(identity, "model_unavailable"); return; }
    if (!session.rows || !session.docDigest || !session.configId) await this.prepareFinalBaseline(trackUri, session.revision, identity.configRevision);
    if (!this.identityCurrent(identity)) return;
    session = this.baselines.get(trackUri);
    if (!session || !this.baselineEligible(trackUri, session, config)) { this.failActive(identity, "baseline_unavailable"); return; }
    identity.configId = session.configId!;
    this.suppressed.delete(this.suppressionKey(trackUri, session.configId, session.docDigest));
    let plan;
    try { plan = planChunks(session.rows!, config.targetLang, config.model); } catch { this.failActive(identity, "oversized"); return; }
    const key = refinementRecordKey(trackUri, session.configId, session.docDigest);
    this.deps.cache.pin(key);
    let record = await this.deps.cache.get(key) ?? this.newRecord(key, trackUri, session, config, provider, plan.chunks);
    captureProviderBaseline(trackUri, this.deps.getTrackLabel?.(trackUri) ?? null, session.rows!);
    let cacheWarning: "write_failed" | undefined;
    let persistenceWarning: "denied" | undefined;
    const ledgerKey = `${trackUri}|${session.configId}`;
    const runTokens = { input: 0, output: 0 };
    if (plan.chunks.some((chunk) => record.chunks[chunk.id]?.status !== "complete") && this.deps.ensurePersistence) {
      if (!await this.deps.ensurePersistence()) persistenceWarning = "denied";
    }
    if (!this.identityCurrent(identity)) { this.deps.cache.unpin(key); return; }
    try {
      for (const chunk of plan.chunks) {
        if (!this.identityCurrent(identity)) return;
        const existing = record.chunks[chunk.id];
        if (existing?.status === "complete") continue;
        this.setState(trackUri, { status: "refining", done: Object.keys(record.items).length, total: session.rows.filter((row) => row.sendDisposition === "sent").length, runId: identity.runId, cacheWarning, persistenceWarning, tokens: { refine: { ...runTokens }, session: { ...this.sessionTokens } } });
        const records = await this.deps.cache.listByTrackConfig(trackUri, session.configId);
        if (!this.identityCurrent(identity)) return;
        const execution = await executeChunk({ provider, chunk, config: { endpoint: config.endpoint, providerVersion: config.providerVersion, model: config.model, targetLang: config.targetLang, promptVersion: AI_PROMPT_VERSION, temperature: 0, contextMode: "document_or_v1_chunks", credential: config.credential, repair: false, maxOutputTokens: 0 }, signal: identity.controller.signal, budgetAlreadyConsumed: sumBudgetConsumed(records) + (this.unpersistedBudget.get(ledgerKey) ?? 0), previous: existing });
        if (!this.identityCurrent(identity)) return;
        record.chunks[chunk.id] = execution.record;
        record.budgetConsumed += execution.budgetConsumed;
        record.tokens.input += execution.record.tokens.input - (existing?.tokens.input ?? 0);
        record.tokens.output += execution.record.tokens.output - (existing?.tokens.output ?? 0);
        record.usageEstimated ||= execution.record.usageEstimated;
        const inputDelta = execution.record.tokens.input - (existing?.tokens.input ?? 0);
        const outputDelta = execution.record.tokens.output - (existing?.tokens.output ?? 0);
        runTokens.input += inputDelta; runTokens.output += outputDelta;
        this.sessionTokens.input += inputDelta; this.sessionTokens.output += outputDelta;
        if (execution.ok) for (const item of execution.items) record.items[item.id] = { translatedText: item.t, provenance: "ai" };
        else { record.status = "failed"; try { await this.deps.cache.put(record); this.unpersistedBudget.delete(ledgerKey); } catch { cacheWarning = "write_failed"; this.unpersistedBudget.set(ledgerKey, (this.unpersistedBudget.get(ledgerKey) ?? 0) + execution.budgetConsumed); } this.setState(trackUri, { status: "failed", reason: execution.failure.reason, cacheWarning, persistenceWarning, tokens: { refine: { ...runTokens }, session: { ...this.sessionTokens } } }); return; }
        record.status = "partial";
        try { await this.deps.cache.put(record); this.unpersistedBudget.delete(ledgerKey); } catch { cacheWarning = "write_failed"; this.unpersistedBudget.set(ledgerKey, (this.unpersistedBudget.get(ledgerKey) ?? 0) + execution.budgetConsumed); }
      }
      if (!this.identityCurrent(identity)) return;
      record.status = "complete";
      try { await this.deps.cache.put(record); this.unpersistedBudget.delete(ledgerKey); } catch { cacheWarning = "write_failed"; }
      this.applyRecord(trackUri, session, record, cacheWarning, persistenceWarning, runTokens);
    } catch {
      if (!identity.controller.signal.aborted) this.setState(trackUri, { status: "failed", reason: "delivery_unknown", cacheWarning });
    } finally {
      if (this.active?.runId === identity.runId) this.active = null;
      this.deps.cache.unpin(key);
    }
  }

  private applyRecord(trackUri: string, session: BaselineSession, record: RefinementRecord, cacheWarning?: "write_failed", persistenceWarning?: "denied", runTokens = { input: 0, output: 0 }): void {
    const sent = session.rows?.filter((row) => row.sendDisposition === "sent") ?? [];
    const changed = sent.some((row) => isMeaningfullyDifferent(record.items[row.id]?.translatedText, row.baselineTranslatedText));
    if (!changed) { this.overlays.delete(trackUri); this.setState(trackUri, { status: "unchanged", cacheWarning, persistenceWarning, origin: "baseline", tokens: { refine: { ...runTokens }, session: { ...this.sessionTokens } } }); return; }
    this.overlays.set(trackUri, Object.fromEntries(Object.entries(record.items).map(([id, item]) => [id, item.translatedText])));
    this.publishComposed(trackUri);
    this.setState(trackUri, { status: "refined", cacheWarning, persistenceWarning, origin: "overlay", tokens: { refine: { ...runTokens }, session: { ...this.sessionTokens } } });
  }

  private publishBaseline(trackUri: string): void { const session = this.baselines.get(trackUri); if (session) this.deps.publish(trackUri, this.renderable(session.document), "baseline"); }
  private publishComposed(trackUri: string): void {
    const session = this.baselines.get(trackUri); const overlay = this.overlays.get(trackUri); if (!session || !overlay) return;
    const composed = this.renderable(session.document);
    for (const row of enumerateRefinementLines(composed, session.snapshot.targetLang ?? "en")) if (row.target && overlay[row.id]) (row.target as any).TranslatedText = overlay[row.id];
    this.deps.publish(trackUri, composed, "overlay");
  }
  private renderable(document: any): any { const copy = structuredClone(document); delete copy.AIOriginalSnapshot; return copy; }
  private setState(trackUri: string, state: RefinementState): void { this.states.set(trackUri, state); for (const listener of this.listeners) listener(trackUri, state); }
  private suppressionKey(trackUri: string, configId: string, docDigest: string): string { return `${trackUri}|${configId}|${docDigest}`; }
  private identityCurrent(identity: ActiveRun): boolean {
    const session = this.baselines.get(identity.trackUri);
    return this.active?.runId === identity.runId
      && session?.revision === identity.baselineRevision
      && this.credentialRevision === identity.credentialRevision
      && this.configRevision === identity.configRevision
      && (!identity.configId || session?.configId === identity.configId);
  }
  private baselineEligible(trackUri: string, session: BaselineSession, config: CoordinatorConfig): boolean {
    return !trackUri.startsWith("spotify:local:")
      && session.stage === "final"
      && !session.document?.ProcessingPending
      && !session.document?.RomanizationPending
      && !session.document?.TranslationPending
      && session.snapshot.targetLang === config.targetLang
      && !!session.rows?.some((row) => row.sendDisposition === "sent" && row.baselineTranslatedText);
  }
  private failActive(identity: ActiveRun, reason: RefinementFailureReason): void {
    if (this.active?.runId === identity.runId) this.active = null;
    this.setState(identity.trackUri, { status: "failed", reason });
  }
  private providerFor(config: CoordinatorConfig): RefinementProvider | null {
    if (this.deps.getProvider) return this.deps.getProvider(config.providerId ?? "");
    if (!this.deps.provider || (config.providerId && config.providerId !== this.deps.provider.id)) return null;
    return this.deps.provider;
  }
  private configId(config: CoordinatorConfig, provider: RefinementProvider): Promise<string> { return buildConfigId({ provider: provider.id, providerVersion: config.providerVersion, endpoint: config.endpoint ?? null, modelName: config.model.name, targetLang: config.targetLang, promptVersion: AI_PROMPT_VERSION, temperature: 0, contextMode: "document_or_v1_chunks" }); }
  private newRecord(key: string, trackUri: string, session: BaselineSession, config: CoordinatorConfig, provider: RefinementProvider, chunks: ReadonlyArray<{ id: string; items: ReadonlyArray<{ id: string }>; requestJson: string }>): RefinementRecord {
    const now = Date.now();
    return { key, trackUri, trackLabel: this.deps.getTrackLabel?.(trackUri), schema: AI_REFINEMENT_SCHEMA, configId: session.configId!, docDigest: session.docDigest!, chunkPlanVersion: AI_CHUNK_PLAN_VERSION, providerId: provider.id, providerVersion: config.providerVersion, modelName: config.model.name, targetLang: config.targetLang, createdAt: now, lastAccessedAt: now, bytes: 0, status: "partial", tokens: { input: 0, output: 0 }, usageEstimated: false, budgetConsumed: 0, items: {}, chunks: Object.fromEntries(chunks.map((chunk) => [chunk.id, { ids: chunk.items.map((item) => item.id), requestJson: chunk.requestJson, status: "pending", attempts: 0, repairs: 0, tokens: { input: 0, output: 0 }, usageEstimated: false }])) };
  }
}
