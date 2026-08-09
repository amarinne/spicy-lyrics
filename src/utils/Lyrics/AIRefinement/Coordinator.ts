import { isMeaningfullyDifferent } from "../TextCompare.ts";
import { cloneSnapshotDocument, enumerateRefinementLines, enumerateSoundLines } from "./document.ts";
import { refinementRecordKey, sumBudgetConsumed } from "./cache.ts";
import { buildConfigId, buildDocumentDigest, normalizeLyricContext, normalizeSteeringInstructions, planChunks } from "./protocol.ts";
import { sha256Hex } from "./identity.ts";
import { executeChunk } from "./runtime.ts";
import { AI_CHUNK_PLAN_VERSION, AI_ITERATION_PROMPT_VERSION, AI_PROMPT_VERSION, AI_REFINEMENT_SCHEMA, AI_SOUND_REFINEMENT_SCHEMA, type CancellationReason, type CanonicalOriginalSnapshot, type DerivedLayer, type LyricContext, type ModelDescriptor, type ProviderCredential, type RefinementCache, type RefinementFailureReason, type RefinementProvider, type RefinementRecord, type RefinementSchema } from "./types.ts";
import { captureProviderAcceptedItems, captureProviderBaseline, finishProviderCapture } from "./DebugCapture.ts";
import { resolveLyricsSourceLabel } from "../LyricsSourcePreferences.ts";

export type CoordinatorConfig = { providerId?: string; providerVersion: string; endpoint?: string; model: ModelDescriptor; targetLang: string; instructions?: string; credential?: ProviderCredential | null };
export type RefinementRequestOptions = { instructions?: string; model?: ModelDescriptor };
export type RefinementRevisionOptions = { instructions: string; model: ModelDescriptor };
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
  revisionNumber?: number;
  modelName?: string;
};
type BaselineSession = { document: any; snapshot: CanonicalOriginalSnapshot; context: LyricContext; stage: "intermediate" | "final"; revision: number; publicationRevision: number; targetLang?: string; docDigest?: string; rows?: ReturnType<typeof enumerateRefinementLines>; configId?: string };
type ActiveRun = { trackUri: string; baselineRevision: number; configId: string; configRevision: number; credentialRevision: number; runId: number; controller: AbortController; request?: RefinementRequestOptions; revision?: { instructions: string; model: ModelDescriptor; parent: RefinementRecord } };

export class AIRefinementCoordinator {
  private readonly layer: DerivedLayer;
  private readonly deps: {
    cache: RefinementCache;
    provider?: RefinementProvider;
    getProvider?: (providerId: string) => RefinementProvider | null;
    getTrackLabel?: (trackUri: string) => string | undefined;
    getContext?: (trackUri: string) => Partial<LyricContext> | null | undefined;
    getConfig: () => Promise<CoordinatorConfig | null>;
    getCredential?: (providerId?: string) => Promise<ProviderCredential | null>;
    publish: (trackUri: string, document: any, origin: "baseline" | "overlay", publicationRevision: number) => void;
    ensurePersistence?: () => Promise<boolean>;
  };
  private baselines = new Map<string, BaselineSession>();
  private overlays = new Map<string, Record<string, string>>();
  private appliedRecords = new Map<string, RefinementRecord>();
  private states = new Map<string, RefinementState>();
  private listeners = new Set<(trackUri: string, state: RefinementState) => void>();
  private suppressed = new Set<string>();
  private active: ActiveRun | null = null;
  private currentTrackUri: string | null = null;
  private mode: "auto" | "on_demand" = "on_demand";
  private revision = 0;
  private runId = 0;
  private credentialRevision = 0;
  private configRevision = 0;
  private enabled = false;
  private unpersistedBudget = new Map<string, number>();
  private sessionTokens = { input: 0, output: 0 };
  private discardedRuns = new Set<number>();

  constructor(deps: {
    layer?: DerivedLayer;
    cache: RefinementCache;
    provider?: RefinementProvider;
    getProvider?: (providerId: string) => RefinementProvider | null;
    getTrackLabel?: (trackUri: string) => string | undefined;
    getContext?: (trackUri: string) => Partial<LyricContext> | null | undefined;
    getConfig: () => Promise<CoordinatorConfig | null>;
    getCredential?: (providerId?: string) => Promise<ProviderCredential | null>;
    publish: (trackUri: string, document: any, origin: "baseline" | "overlay", publicationRevision: number) => void;
    ensurePersistence?: () => Promise<boolean>;
  }) { this.layer = deps.layer ?? "meaning"; this.deps = deps; }

  acceptBaseline(trackUri: string, document: any, stage: "intermediate" | "final", originalSnapshot: CanonicalOriginalSnapshot, publicationRevision?: number): void {
    const revision = ++this.revision;
    if (this.active?.trackUri === trackUri) this.cancel(trackUri, "baseline_superseded");
    const session = { document: structuredClone(document), snapshot: originalSnapshot, context: normalizeLyricContext(this.deps.getContext?.(trackUri)), stage, revision, publicationRevision: publicationRevision ?? revision };
    this.baselines.set(trackUri, session);
    this.overlays.delete(trackUri);
    this.appliedRecords.delete(trackUri);
    this.publishBaseline(trackUri);
    if (stage === "final") void this.prepareFinalBaseline(trackUri, revision);
  }

  onTrackChanged(trackUri: string | null): void {
    if (this.currentTrackUri && this.currentTrackUri !== trackUri) {
      this.cancel(this.currentTrackUri, "track_change");
      this.overlays.delete(this.currentTrackUri);
      this.appliedRecords.delete(this.currentTrackUri);
      for (const key of this.suppressed) if (key.startsWith(`${this.currentTrackUri}|`)) this.suppressed.delete(key);
    }
    this.currentTrackUri = trackUri;
  }

  refine(trackUri: string, options: RefinementRequestOptions = {}): void {
    if (this.active?.trackUri === trackUri) return;
    const session = this.baselines.get(trackUri);
    const instructions = normalizeSteeringInstructions(options.instructions);
    const identity: ActiveRun = { trackUri, baselineRevision: session?.revision ?? -1, configId: "", configRevision: this.configRevision, credentialRevision: this.credentialRevision, runId: ++this.runId, controller: new AbortController(), request: instructions || options.model ? { instructions, model: options.model ? structuredClone(options.model) : undefined } : undefined };
    this.active = identity;
    this.setState(trackUri, { status: "requested", runId: identity.runId });
    void this.runRefinement(identity).catch(() => {
      if (this.active?.runId === identity.runId) this.failActive(identity, "delivery_unknown");
    });
  }

  refineOutput(trackUri: string, options: RefinementRevisionOptions): void {
    if (this.active?.trackUri === trackUri) return;
    const session = this.baselines.get(trackUri);
    const parent = this.appliedRecords.get(trackUri);
    const instructions = normalizeSteeringInstructions(options.instructions);
    if (!session || !parent || !instructions) return;
    const identity: ActiveRun = { trackUri, baselineRevision: session.revision, configId: "", configRevision: this.configRevision, credentialRevision: this.credentialRevision, runId: ++this.runId, controller: new AbortController(), revision: { instructions, model: structuredClone(options.model), parent: structuredClone(parent) } };
    this.active = identity;
    this.setState(trackUri, { status: "requested", runId: identity.runId, revisionNumber: (parent.revisionNumber ?? 0) + 1, modelName: options.model.name });
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
    const appliedConfigId = this.appliedRecords.get(trackUri)?.configId ?? session.configId;
    this.cancel(trackUri, "user");
    this.overlays.delete(trackUri);
    this.appliedRecords.delete(trackUri);
    this.suppressed.add(this.suppressionKey(trackUri, appliedConfigId, session.docDigest));
    this.publishBaseline(trackUri);
    this.setState(trackUri, { status: "idle", origin: "baseline" });
  }

  subscribe(cb: (trackUri: string, state: RefinementState) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  getState(trackUri: string): RefinementState { return this.states.get(trackUri) ?? { status: "idle" }; }
  getBaselineDocument(trackUri: string): any | undefined { const document = this.baselines.get(trackUri)?.document; return document ? structuredClone(document) : undefined; }
  invalidateBaseline(trackUri: string): void { this.cancel(trackUri, "user"); this.overlays.delete(trackUri); this.appliedRecords.delete(trackUri); this.baselines.delete(trackUri); }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      if (this.active) this.cancel(this.active.trackUri, "experiment_disabled");
      for (const trackUri of this.overlays.keys()) { this.overlays.delete(trackUri); this.appliedRecords.delete(trackUri); this.publishBaseline(trackUri); }
    } else if (this.currentTrackUri) {
      const session = this.baselines.get(this.currentTrackUri);
      if (session?.stage === "final") void this.prepareFinalBaseline(this.currentTrackUri, session.revision);
    }
  }

  setMode(mode: "auto" | "on_demand"): void { this.mode = mode; }

  notifyConfigChanged(): void {
    this.configRevision++;
    if (this.active) this.cancel(this.active.trackUri, "config_changed");
    const affected = [...this.overlays.keys()];
    this.overlays.clear();
    this.appliedRecords.clear();
    this.suppressed.clear();
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

  async clearTrack(trackUri: string): Promise<void> { if (this.active?.trackUri === trackUri) this.discardedRuns.add(this.active.runId); this.cancel(trackUri, "user"); this.overlays.delete(trackUri); this.appliedRecords.delete(trackUri); await this.deps.cache.deleteTrack(trackUri); this.publishBaseline(trackUri); }
  async clearAll(): Promise<void> {
    if (this.active) { this.discardedRuns.add(this.active.runId); this.cancel(this.active.trackUri, "user"); }
    const affected = [...this.overlays.keys()];
    this.overlays.clear();
    this.appliedRecords.clear();
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
    let sourceRows: ReturnType<typeof enumerateRefinementLines>;
    let baselineRows: ReturnType<typeof enumerateRefinementLines>;
    try {
      sourceRows = this.layer === "sound" ? enumerateSoundLines(cloneSnapshotDocument(session.snapshot)) : enumerateRefinementLines(cloneSnapshotDocument(session.snapshot), config.targetLang);
      baselineRows = this.layer === "sound" ? enumerateSoundLines(session.document) : enumerateRefinementLines(session.document, config.targetLang);
    } catch (error) {
      if (this.layer === "sound" && error instanceof TypeError && error.message === "sound_alignment_required") this.setState(trackUri, { status: "failed", reason: "alignment_required" });
      return;
    }
    const byId = new Map(baselineRows.map((row) => [row.id, row]));
    const rows = sourceRows.map((row) => ({ ...row, baselineTranslatedText: byId.get(row.id)?.baselineTranslatedText }));
    const docDigest = await buildDocumentDigest(rows, session.context);
    if (this.baselines.get(trackUri) !== session || session.revision !== revision || this.configRevision !== configRevision) return;
    const configId = await this.configId(config, provider, session);
    if (this.baselines.get(trackUri) !== session || session.revision !== revision || this.configRevision !== configRevision) return;
    session.rows = rows; session.targetLang = config.targetLang; session.docDigest = docDigest; session.configId = configId;
    if (!this.enabled || !this.baselineEligible(trackUri, session) || this.suppressed.has(this.suppressionKey(trackUri, configId, docDigest))) return;
    if (this.layer === "sound" && this.mode === "auto" && trackUri !== this.currentTrackUri) return;
    const baseKey = refinementRecordKey(trackUri, configId, docDigest, this.schema());
    const cached = await this.deps.cache.get(baseKey);
    if (this.baselines.get(trackUri) !== session || session.revision !== revision || this.configRevision !== configRevision || session.configId !== configId || session.docDigest !== docDigest) return;
    const lineage = (await this.deps.cache.listByTrack(trackUri)).filter((record) => record.status === "complete" && record.docDigest === docDigest && (record.key === baseKey || record.rootRecordKey === baseKey));
    if (this.baselines.get(trackUri) !== session || session.revision !== revision || this.configRevision !== configRevision || session.configId !== configId || session.docDigest !== docDigest) return;
    const latest = lineage.sort((left, right) => (right.revisionNumber ?? 0) - (left.revisionNumber ?? 0) || right.createdAt - left.createdAt)[0];
    if (latest) this.applyRecord(trackUri, session, latest);
    else if (this.mode === "auto" && trackUri === this.currentTrackUri && !this.active && cached?.status !== "failed") this.refine(trackUri);
  }

  private async runRefinement(identity: ActiveRun): Promise<void> {
    const trackUri = identity.trackUri;
    let session = this.baselines.get(trackUri);
    if (!this.enabled || !session || session.revision !== identity.baselineRevision) { this.failActive(identity, "baseline_unavailable"); return; }
    let config = await this.deps.getConfig();
    if (!this.identityCurrent(identity)) return;
    if (!config) { this.failActive(identity, "model_unavailable"); return; }
    if (identity.request) config = {
      ...config,
      model: identity.request.model ?? config.model,
      instructions: [config.instructions, identity.request.instructions].map((value) => normalizeSteeringInstructions(value)).filter(Boolean).join("\n"),
    };
    if (identity.revision) config = { ...config, model: identity.revision.model };
    const provider = this.providerFor(config);
    if (!provider) { this.failActive(identity, "model_unavailable"); return; }
    if (this.layer === "sound" && session.document?.Type === "Syllable") { this.failActive(identity, "alignment_required"); return; }
    if (!session.rows || !session.docDigest || !session.configId) await this.prepareFinalBaseline(trackUri, session.revision, identity.configRevision);
    if (!this.identityCurrent(identity)) return;
    session = this.baselines.get(trackUri);
    if (!session || !this.baselineEligible(trackUri, session)) { this.failActive(identity, "baseline_unavailable"); return; }
    identity.configId = session.configId!;
    const revisionInstructions = identity.revision?.instructions;
    const effectiveInstructions = [config.instructions, revisionInstructions].map((value) => normalizeSteeringInstructions(value)).filter(Boolean).join("\n");
    const previousById = identity.revision ? Object.fromEntries(Object.entries(identity.revision.parent.items).map(([id, item]) => [id, item.translatedText])) : null;
    const parentOutputDigest = identity.revision ? await sha256Hex(previousById) : null;
    const runConfigId = identity.revision ? await buildConfigId({
      layer: this.layer, provider: provider.id, providerVersion: config.providerVersion, endpoint: config.endpoint ?? null,
      modelName: config.model.name, targetLang: config.targetLang,
      sourceLanguage: this.layer === "sound" ? String(session.snapshot.document?.Language ?? "und").normalize("NFC").toLowerCase() : null,
      soundMode: this.layer === "sound" ? "whole_line_v1" : null, instructions: config.instructions,
      promptVersion: AI_PROMPT_VERSION, iterationPromptVersion: AI_ITERATION_PROMPT_VERSION,
      parentRecordKey: identity.revision.parent.key, parentOutputDigest, revisionInstructions,
      temperature: 0, contextMode: "document_or_v1_chunks",
    }) : identity.request ? await this.configId(config, provider, session) : session.configId!;
    this.suppressed.delete(this.suppressionKey(trackUri, runConfigId, session.docDigest));
    const key = refinementRecordKey(trackUri, runConfigId, session.docDigest, this.schema());
    let cached = await this.deps.cache.get(key);
    if (!this.identityCurrent(identity)) return;
    if (cached?.status === "failed") cached = this.resetFailedChunks(cached);
    if (cached?.status === "complete") {
      this.applyRecord(trackUri, session, cached);
      if (this.active?.runId === identity.runId) this.active = null;
      return;
    }
    const credential = config.credential !== undefined ? config.credential : await this.deps.getCredential?.(config.providerId);
    if (!this.identityCurrent(identity)) return;
    if (!credential) { this.failActive(identity, "no_credential"); return; }
    let plan;
    try { plan = planChunks(session.rows!, config.targetLang, config.model, effectiveInstructions, this.layer, session.context, previousById); } catch { this.failActive(identity, "oversized"); return; }
    this.deps.cache.pin(key);
    let record = cached ?? this.newRecord(key, trackUri, session, config, provider, plan.chunks, runConfigId, identity.revision ? {
      parentRecordKey: identity.revision.parent.key,
      rootRecordKey: identity.revision.parent.rootRecordKey ?? identity.revision.parent.key,
      parentOutputDigest: parentOutputDigest!,
      revisionInstructions: identity.revision.instructions,
      revisionNumber: (identity.revision.parent.revisionNumber ?? 0) + 1,
    } : undefined);
    const needsProviderRequest = plan.chunks.some((chunk) => record.chunks[chunk.id]?.status !== "complete");
    const captureRows = identity.revision ? session.rows!.map((row) => ({ ...row, baselineTranslatedText: previousById?.[row.id] ?? row.baselineTranslatedText })) : session.rows!;
    const providerCaptureId = needsProviderRequest ? captureProviderBaseline(
      trackUri,
      this.deps.getTrackLabel?.(trackUri) ?? null,
      captureRows,
      this.layer,
      {
        provider: session.document?.fetchProvider ?? session.document?.source ?? null,
        label: resolveLyricsSourceLabel(session.document?.source, session.document?.sourceDisplayName, session.document?.fetchProvider),
        format: ["Syllable", "Line", "Static"].includes(session.document?.Type) ? session.document.Type : null,
      },
    ) : null;
    let cacheWarning: "write_failed" | undefined;
    let persistenceWarning: "denied" | undefined;
    const ledgerKey = `${trackUri}|${runConfigId}`;
    const runTokens = { input: 0, output: 0 };
    if (needsProviderRequest && this.deps.ensurePersistence) {
      if (!await this.deps.ensurePersistence()) persistenceWarning = "denied";
    }
    if (!this.identityCurrent(identity)) { finishProviderCapture(providerCaptureId); this.deps.cache.unpin(key); return; }
    try {
      for (const chunk of plan.chunks) {
        if (!this.identityCurrent(identity)) return;
        const existing = record.chunks[chunk.id];
        if (existing?.status === "complete") continue;
        this.setState(trackUri, { status: "refining", done: Object.keys(record.items).length, total: session.rows.filter((row) => row.sendDisposition === "sent").length, runId: identity.runId, revisionNumber: record.revisionNumber, modelName: record.modelName, cacheWarning, persistenceWarning, tokens: { refine: { ...runTokens }, session: { ...this.sessionTokens } } });
        const records = await this.deps.cache.listByTrackConfig(trackUri, runConfigId);
        if (!this.identityCurrent(identity)) return;
        const execution = await executeChunk({ provider, chunk, config: { layer: this.layer, endpoint: config.endpoint, providerVersion: config.providerVersion, model: config.model, targetLang: config.targetLang, instructions: effectiveInstructions, context: session.context, promptVersion: AI_PROMPT_VERSION, temperature: 0, contextMode: "document_or_v1_chunks", credential, repair: false, iteration: !!identity.revision, maxOutputTokens: 0, captureId: providerCaptureId }, signal: identity.controller.signal, budgetAlreadyConsumed: sumBudgetConsumed(records) + (this.unpersistedBudget.get(ledgerKey) ?? 0), previous: existing });
        record.chunks[chunk.id] = execution.record;
        record.budgetConsumed += execution.budgetConsumed;
        record.tokens.input += execution.record.tokens.input - (existing?.tokens.input ?? 0);
        record.tokens.output += execution.record.tokens.output - (existing?.tokens.output ?? 0);
        record.usageEstimated ||= execution.record.usageEstimated;
        const inputDelta = execution.record.tokens.input - (existing?.tokens.input ?? 0);
        const outputDelta = execution.record.tokens.output - (existing?.tokens.output ?? 0);
        runTokens.input += inputDelta; runTokens.output += outputDelta;
        this.sessionTokens.input += inputDelta; this.sessionTokens.output += outputDelta;
        if (execution.ok) {
          for (const item of execution.items) record.items[item.id] = { translatedText: item.t, provenance: "ai" };
          captureProviderAcceptedItems(providerCaptureId, execution.items);
        }
        if (!this.identityCurrent(identity)) {
          const cancellation = String(identity.controller.signal.reason ?? "");
          if (!this.discardedRuns.has(identity.runId) && ["track_change", "user", "config_changed", "credential_changed", "baseline_superseded", "experiment_disabled"].includes(cancellation)) {
            record.status = execution.ok ? "partial" : "failed";
            try { await this.deps.cache.put(record); this.unpersistedBudget.delete(ledgerKey); }
            catch { this.unpersistedBudget.set(ledgerKey, (this.unpersistedBudget.get(ledgerKey) ?? 0) + execution.budgetConsumed); }
          }
          return;
        }
        if (!execution.ok) { record.status = "failed"; try { await this.deps.cache.put(record); this.unpersistedBudget.delete(ledgerKey); } catch { cacheWarning = "write_failed"; this.unpersistedBudget.set(ledgerKey, (this.unpersistedBudget.get(ledgerKey) ?? 0) + execution.budgetConsumed); } this.setState(trackUri, { status: "failed", reason: execution.failure.reason, revisionNumber: record.revisionNumber, modelName: record.modelName, cacheWarning, persistenceWarning, tokens: { refine: { ...runTokens }, session: { ...this.sessionTokens } } }); return; }
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
      finishProviderCapture(providerCaptureId);
      this.discardedRuns.delete(identity.runId);
      if (this.active?.runId === identity.runId) this.active = null;
      this.deps.cache.unpin(key);
    }
  }

  private applyRecord(trackUri: string, session: BaselineSession, record: RefinementRecord, cacheWarning?: "write_failed", persistenceWarning?: "denied", runTokens = { input: 0, output: 0 }): void {
    const sent = session.rows?.filter((row) => row.sendDisposition === "sent") ?? [];
    const changed = sent.some((row) => isMeaningfullyDifferent(record.items[row.id]?.translatedText, row.baselineTranslatedText ?? row.sourceText));
    if (!changed) { this.overlays.delete(trackUri); this.appliedRecords.delete(trackUri); this.setState(trackUri, { status: "unchanged", cacheWarning, persistenceWarning, origin: "baseline", revisionNumber: record.revisionNumber, modelName: record.modelName, tokens: { refine: { ...runTokens }, session: { ...this.sessionTokens } } }); return; }
    this.overlays.set(trackUri, Object.fromEntries(Object.entries(record.items).map(([id, item]) => [id, item.translatedText])));
    this.appliedRecords.set(trackUri, structuredClone(record));
    this.publishComposed(trackUri);
    this.setState(trackUri, { status: "refined", cacheWarning, persistenceWarning, origin: "overlay", revisionNumber: record.revisionNumber ?? 0, modelName: record.modelName, tokens: { refine: { ...runTokens }, session: { ...this.sessionTokens } } });
  }

  private publishBaseline(trackUri: string): void { const session = this.baselines.get(trackUri); if (session) this.deps.publish(trackUri, this.renderable(session.document), "baseline", session.publicationRevision); }
  private publishComposed(trackUri: string): void {
    const session = this.baselines.get(trackUri); const overlay = this.overlays.get(trackUri); if (!session || !overlay) return;
    const composed = this.renderable(session.document);
    const rows = this.layer === "sound" ? enumerateSoundLines(composed) : enumerateRefinementLines(composed, session.targetLang ?? "en");
    for (const row of rows) if (row.target && overlay[row.id]) {
      if (this.layer === "sound") { (row.target as any).RomanizedText = overlay[row.id]; (row.target as any).TransliteratedText = overlay[row.id]; }
      else (row.target as any).TranslatedText = overlay[row.id];
    }
    if (this.layer === "sound") { composed.HasTransliterations = true; composed.IncludesRomanization = true; }
    else composed.IncludesTranslation = true;
    this.deps.publish(trackUri, composed, "overlay", session.publicationRevision);
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
  private baselineEligible(trackUri: string, session: BaselineSession): boolean {
    return !trackUri.startsWith("spotify:local:")
      && session.stage === "final"
      && !session.document?.ProcessingPending
      && !session.document?.RomanizationPending
      && !!session.rows?.some((row) => row.sendDisposition === "sent");
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
  private configId(config: CoordinatorConfig, provider: RefinementProvider, session: BaselineSession): Promise<string> {
    return buildConfigId({ layer: this.layer, provider: provider.id, providerVersion: config.providerVersion, endpoint: config.endpoint ?? null, modelName: config.model.name, targetLang: config.targetLang, sourceLanguage: this.layer === "sound" ? String(session?.snapshot.document?.Language ?? "und").normalize("NFC").toLowerCase() : null, soundMode: this.layer === "sound" ? "whole_line_v1" : null, instructions: config.instructions, promptVersion: AI_PROMPT_VERSION, temperature: 0, contextMode: "document_or_v1_chunks" });
  }
  private schema(): RefinementSchema { return this.layer === "sound" ? AI_SOUND_REFINEMENT_SCHEMA : AI_REFINEMENT_SCHEMA; }
  private resetFailedChunks(record: RefinementRecord): RefinementRecord {
    const copy = structuredClone(record);
    copy.status = "partial";
    for (const chunk of Object.values(copy.chunks)) if (chunk.status === "failed") {
      chunk.status = "pending"; chunk.attempts = 0; chunk.repairs = 0; delete chunk.failure;
    }
    return copy;
  }
  private newRecord(key: string, trackUri: string, session: BaselineSession, config: CoordinatorConfig, provider: RefinementProvider, chunks: ReadonlyArray<{ id: string; items: ReadonlyArray<{ id: string }>; requestJson: string }>, configId = session.configId!, revision?: Pick<RefinementRecord, "parentRecordKey" | "rootRecordKey" | "parentOutputDigest" | "revisionInstructions" | "revisionNumber">): RefinementRecord {
    const now = Date.now();
    return { key, trackUri, trackLabel: this.deps.getTrackLabel?.(trackUri), schema: this.schema(), layer: this.layer, configId, docDigest: session.docDigest!, chunkPlanVersion: AI_CHUNK_PLAN_VERSION, providerId: provider.id, providerVersion: config.providerVersion, modelName: config.model.name, targetLang: config.targetLang, ...revision, createdAt: now, lastAccessedAt: now, bytes: 0, status: "partial", tokens: { input: 0, output: 0 }, usageEstimated: false, budgetConsumed: 0, items: {}, chunks: Object.fromEntries(chunks.map((chunk) => [chunk.id, { ids: chunk.items.map((item) => item.id), requestJson: chunk.requestJson, status: "pending", attempts: 0, repairs: 0, tokens: { input: 0, output: 0 }, usageEstimated: false }])) };
  }
}
