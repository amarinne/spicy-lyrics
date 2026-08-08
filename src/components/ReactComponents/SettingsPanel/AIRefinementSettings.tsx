import { useStore } from "@nanostores/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AI_CONSENT_VERSION, deleteProviderCredential, loadProviderCredential, saveProviderCredential } from "../../../utils/Lyrics/AIRefinement/Credentials.ts";
import { normalizeOpenAIBaseUrl } from "../../../utils/Lyrics/AIRefinement/OpenAIProvider.ts";
import { deleteProviderCapture, downloadProviderCapture, getProviderCaptureMetadata, getProviderCaptureState, getProviderComparisonRows, loadLatestProviderCapture, startProviderCapture, stopProviderCapture, subscribeProviderCapture } from "../../../utils/Lyrics/AIRefinement/DebugCapture.ts";
import { listRefinementCacheInventory, type RefinementCacheInventoryItem } from "../../../utils/Lyrics/AIRefinement/IndexedDBCache.ts";
import { aiRefinementCoordinator, geminiRefinementProvider, openAIRefinementProvider } from "../../../utils/Lyrics/AIRefinement/singleton.ts";
import type { ModelDescriptor, ProviderFailure, ProviderId } from "../../../utils/Lyrics/AIRefinement/types.ts";
import { $aiConsentVersion, $aiDiscoveredModelsByProvider, $aiOpenAIBaseUrl, $aiSelectedModelDescriptorsByProvider, $aiSelectedModelsByProvider, $aiSelectedProvider } from "../../../utils/stores.ts";
import { Row, Select, Toggle } from "./components.tsx";

const encoder = new TextEncoder();

function maskKey(secret: string): string {
  if (secret.length <= 8) return `${secret.slice(0, 2)}••••${secret.slice(-2)}`;
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}

function failureText(failure: ProviderFailure, providerName: string): string {
  switch (failure.kind) {
    case "auth": return "Key rejected";
    case "rate_limited": return "Rate limited. Try again.";
    case "delivery_unknown": return "Connection failed";
    case "request_rejected": return `Request rejected (${failure.status})`;
    case "protocol": return `${providerName} returned an invalid model list`;
    default: return "Connection failed";
  }
}

function stringMap(value: string): Record<ProviderId, string> {
  try {
    const parsed = JSON.parse(value);
    return { gemini: typeof parsed?.gemini === "string" ? parsed.gemini : "", openai: typeof parsed?.openai === "string" ? parsed.openai : "" };
  } catch { return { gemini: "", openai: "" }; }
}

function providerModels(value: string, providerId: ProviderId): ModelDescriptor[] {
  const encoded = stringMap(value)[providerId];
  try { const parsed = JSON.parse(encoded); return Array.isArray(parsed) ? parsed.filter((model) => model?.name) : []; } catch { return []; }
}

export default function AIRefinementSettings() {
  const consentVersion = useStore($aiConsentVersion);
  const selectedProviderValue = useStore($aiSelectedProvider);
  const selectedModelsJson = useStore($aiSelectedModelsByProvider);
  const selectedDescriptorsJson = useStore($aiSelectedModelDescriptorsByProvider);
  const discoveredModelsJson = useStore($aiDiscoveredModelsByProvider);
  const openAIBaseUrl = useStore($aiOpenAIBaseUrl);
  const providerId: ProviderId = selectedProviderValue === "openai" ? "openai" : "gemini";
  const providerName = providerId === "gemini" ? "Gemini" : "OpenAI-compatible";
  const selectedModels = useMemo(() => stringMap(selectedModelsJson), [selectedModelsJson]);
  const selectedDescriptors = useMemo(() => stringMap(selectedDescriptorsJson), [selectedDescriptorsJson]);
  const discoveredModels = useMemo(() => providerModels(discoveredModelsJson, providerId), [discoveredModelsJson, providerId]);
  const selectedModelName = selectedModels[providerId];
  const [draft, setDraft] = useState("");
  const [savedMask, setSavedMask] = useState("");
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeFailures, setProbeFailures] = useState<string[]>([]);
  const [captureState, setCaptureState] = useState(getProviderCaptureState);
  const [showComparison, setShowComparison] = useState(false);
  const [cacheInventory, setCacheInventory] = useState<RefinementCacheInventoryItem[]>([]);
  const [status, setStatus] = useState("");
  const probeControllerRef = useRef<AbortController | null>(null);
  const probeGenerationRef = useRef(0);
  const consented = consentVersion === AI_CONSENT_VERSION;
  const byteCount = encoder.encode(draft).byteLength;
  const cancelModelProbe = useCallback((updateState = true) => {
    probeGenerationRef.current++;
    probeControllerRef.current?.abort("configuration_changed");
    probeControllerRef.current = null;
    if (updateState) setProbing(false);
  }, []);

  useEffect(() => {
    let current = true;
    setDraft(""); setEditing(false); setStatus(""); setSavedMask(""); setProbeFailures([]);
    void loadProviderCredential(providerId).then((secret) => { if (current && secret) setSavedMask(maskKey(secret)); });
    return () => { current = false; };
  }, [providerId]);
  useEffect(() => subscribeProviderCapture(setCaptureState), []);
  useEffect(() => { void loadLatestProviderCapture(); void listRefinementCacheInventory().then(setCacheInventory); }, []);
  useEffect(() => { cancelModelProbe(); }, [providerId, openAIBaseUrl, consentVersion, cancelModelProbe]);
  useEffect(() => () => cancelModelProbe(false), [cancelModelProbe]);

  const save = async () => {
    cancelModelProbe();
    if (!consented) { setStatus("Allow AI requests first"); return; }
    if (!draft || byteCount > 512) { setStatus("Key must be 1–512 UTF-8 bytes"); return; }
    await saveProviderCredential(providerId, draft);
    aiRefinementCoordinator.notifyCredentialChanged();
    setSavedMask(maskKey(draft)); setDraft(""); setEditing(false); setStatus("Key saved");
  };

  const edit = async () => {
    const secret = await loadProviderCredential(providerId);
    setDraft(secret ?? ""); setEditing(true); setStatus("");
  };

  const remove = async () => {
    cancelModelProbe();
    await deleteProviderCredential(providerId);
    aiRefinementCoordinator.notifyCredentialChanged();
    setSavedMask(""); setDraft(""); setEditing(false); setStatus("Key deleted");
  };

  const testConnection = async () => {
    if (!consented) { setStatus("Allow AI requests first"); return; }
    const secret = await loadProviderCredential(providerId);
    if (!secret) { setStatus("Save a key first"); return; }
    if (providerId === "openai") {
      try { openAIRefinementProvider.setBaseUrl(normalizeOpenAIBaseUrl(openAIBaseUrl)); }
      catch { setStatus("Invalid API base URL"); return; }
    }
    const provider = providerId === "gemini" ? geminiRefinementProvider : openAIRefinementProvider;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort("timeout"), 30_000);
    setTesting(true); setStatus("Checking key…");
    try {
      const result = await provider.listModels({ secret }, controller.signal);
      if (!result.ok) { setStatus(failureText(result.failure, providerName)); return; }
      const models = [...result.models];
      const discoveredByProvider = stringMap($aiDiscoveredModelsByProvider.get());
      discoveredByProvider[providerId] = JSON.stringify(models);
      $aiDiscoveredModelsByProvider.set(JSON.stringify(discoveredByProvider));
      const selected = models.find((model) => model.name === selectedModelName);
      if (selected) {
        const descriptors = stringMap($aiSelectedModelDescriptorsByProvider.get());
        descriptors[providerId] = JSON.stringify(selected);
        $aiSelectedModelDescriptorsByProvider.set(JSON.stringify(descriptors));
      }
      setStatus(`Connected · ${models.length} models${selectedModelName && !selected ? " · selected model unavailable" : ""}`);
    } catch { setStatus("Connection cancelled"); }
    finally { window.clearTimeout(timeout); setTesting(false); }
  };

  const testModels = async () => {
    if (providerId !== "openai" || !discoveredModels.length) return;
    const secret = await loadProviderCredential(providerId);
    if (!secret) { setStatus("Save a key first"); return; }
    try { openAIRefinementProvider.setBaseUrl(normalizeOpenAIBaseUrl(openAIBaseUrl)); }
    catch { setStatus("Invalid API base URL"); return; }
    cancelModelProbe(false);
    const controller = new AbortController();
    probeControllerRef.current = controller;
    const generation = ++probeGenerationRef.current;
    setProbing(true); setProbeFailures([]);
    const passed: ModelDescriptor[] = [];
    const failures: string[] = [];
    let budgetTokens = 0;
    const models = discoveredModels.slice(0, 50);
    for (let index = 0; index < models.length; index++) {
      if (controller.signal.aborted || probeGenerationRef.current !== generation) return;
      if (budgetTokens + 100 > 5_000) { failures.push("Probe budget reached"); break; }
      const model = models[index];
      setStatus(`Testing models ${index + 1}/${models.length}…`);
      const callController = new AbortController();
      const abortCall = () => callController.abort(controller.signal.reason);
      controller.signal.addEventListener("abort", abortCall, { once: true });
      const timeout = window.setTimeout(() => callController.abort("timeout"), 30_000);
      try {
        const result = await openAIRefinementProvider.probeModel(model, { secret }, callController.signal);
        if (controller.signal.aborted || probeGenerationRef.current !== generation) return;
        if (result.ok) {
          passed.push(model);
          budgetTokens += Math.max(1, (result.usage.input ?? 68) + (result.usage.output ?? 32));
        } else {
          failures.push(`${model.name}: ${result.failure.kind}`);
          budgetTokens += 100;
        }
      } catch { if (!controller.signal.aborted) { failures.push(`${model.name}: timeout`); budgetTokens += 100; } }
      finally { window.clearTimeout(timeout); controller.signal.removeEventListener("abort", abortCall); }
    }
    if (controller.signal.aborted || probeGenerationRef.current !== generation) return;
    const discoveredByProvider = stringMap($aiDiscoveredModelsByProvider.get());
    discoveredByProvider.openai = JSON.stringify(passed);
    $aiDiscoveredModelsByProvider.set(JSON.stringify(discoveredByProvider));
    setProbeFailures(failures);
    setStatus(`Models tested · ${passed.length}/${models.length} available`);
    setProbing(false);
    probeControllerRef.current = null;
  };

  let selectedCached: ModelDescriptor | null = null;
  try { selectedCached = JSON.parse(selectedDescriptors[providerId]); } catch {}
  const modelOptions = ["", ...discoveredModels.map((model) => model.name)];
  const modelLabels = ["Select a model", ...discoveredModels.map((model) => model.name.replace(/^models\//, ""))];
  if (selectedModelName && !modelOptions.includes(selectedModelName)) {
    modelOptions.push(selectedModelName);
    modelLabels.push(`${selectedCached?.name?.replace(/^models\//, "") ?? selectedModelName} (unavailable)`);
  }
  const captureMetadata = getProviderCaptureMetadata();

  return (
    <div className="sl-ai-settings">
      <Row label="Allow AI requests" description="Sends lyrics to the selected provider and may incur charges.">
        <Toggle checked={consented} onChange={(enabled) => { cancelModelProbe(); $aiConsentVersion.set(enabled ? AI_CONSENT_VERSION : 0); aiRefinementCoordinator.notifyCredentialChanged(); }} />
      </Row>
      <Row label="Provider">
        <Select value={providerId} options={["gemini", "openai"]} labels={["Gemini", "OpenAI-compatible"]} onChange={(value) => {
          cancelModelProbe(); $aiSelectedProvider.set(value); aiRefinementCoordinator.notifyConfigChanged();
        }} />
      </Row>
      {providerId === "openai" && (
        <Row label="API base URL" description="HTTPS required. Plain HTTP is allowed only for localhost development." stacked>
          <input className="sl-sp-text-input" type="text" value={openAIBaseUrl} onChange={(event) => { cancelModelProbe(); $aiOpenAIBaseUrl.set(event.currentTarget.value); }} onBlur={() => aiRefinementCoordinator.notifyConfigChanged()} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder="https://api.openai.com/v1" />
        </Row>
      )}
      <Row label="API key" description="Use a dedicated key with a spend cap." stacked>
        <div className="sl-ai-secret-controls">
          {savedMask && !editing ? (
            <div className="sl-ai-saved-key"><code>{savedMask}</code><span>Saved</span></div>
          ) : (
            <div className="sl-ai-secret-input-wrap">
              <input className="sl-sp-text-input" type="text" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder={`Paste ${providerName} API key`} />
              <span>{byteCount}/512</span>
            </div>
          )}
          <div className="sl-ai-actions">
            {savedMask && !editing ? <button className="sl-sp-btn" type="button" onClick={edit}>Edit</button> : <button className="sl-sp-btn" type="button" onClick={save} disabled={!draft || byteCount > 512}>Save</button>}
            <button className="sl-sp-btn" type="button" onClick={testConnection} disabled={!savedMask || testing || probing || !consented}>{testing ? "Testing…" : "Test connection"}</button>
            {providerId === "openai" && <button className="sl-sp-btn" type="button" onClick={testModels} disabled={!savedMask || !discoveredModels.length || testing || probing || !consented}>{probing ? "Testing models…" : "Test models"}</button>}
            <button className="sl-sp-btn" type="button" onClick={remove} disabled={!savedMask}>Delete</button>
          </div>
          {status && <span className="sl-ai-status">{status}</span>}
          {!!probeFailures.length && <details className="sl-ai-probe-failures"><summary>{probeFailures.length} failed</summary>{probeFailures.map((failure) => <span key={failure}>{failure}</span>)}</details>}
          <span className="sl-ai-note">Desktop extensions can read stored keys.</span>
        </div>
      </Row>
      <Row label="Model" description={discoveredModels.length ? undefined : "Test the connection to load models."}>
        <Select value={selectedModelName} options={modelOptions} labels={modelLabels} onChange={(value) => {
          cancelModelProbe(); const names = stringMap($aiSelectedModelsByProvider.get()); names[providerId] = value; $aiSelectedModelsByProvider.set(JSON.stringify(names));
          const descriptors = stringMap($aiSelectedModelDescriptorsByProvider.get());
          const descriptor = discoveredModels.find((model) => model.name === value); descriptors[providerId] = descriptor ? JSON.stringify(descriptor) : ""; $aiSelectedModelDescriptorsByProvider.set(JSON.stringify(descriptors));
          aiRefinementCoordinator.notifyConfigChanged();
        }} disabled={!discoveredModels.length} />
      </Row>
      {providerId === "openai" && <Row label="Request capture" description="Contains lyric text. Saved locally until explicitly deleted." stacked>
        <div className="sl-ai-actions">
          <button className="sl-sp-btn" type="button" onClick={captureState.enabled ? stopProviderCapture : startProviderCapture}>{captureState.enabled ? "Stop capture" : "Start capture"}</button>
          <button className="sl-sp-btn" type="button" onClick={() => { const filename = downloadProviderCapture(); if (filename) setStatus(`Sent ${filename} to browser Downloads`); }} disabled={!captureState.exchanges.length}>Download capture ({captureState.exchanges.length})</button>
          <button className="sl-sp-btn" type="button" onClick={() => setShowComparison((shown) => !shown)} disabled={!captureState.exchanges.length}>{showComparison ? "Hide comparison" : "View comparison"}</button>
          <button className="sl-sp-btn" type="button" onClick={() => { if (window.confirm("Delete this saved request/response capture?")) { void deleteProviderCapture(); setShowComparison(false); } }} disabled={!captureState.durable}>Delete capture</button>
        </div>
        {showComparison && <div className="sl-ai-comparison">
          {captureMetadata && <div className="sl-ai-capture-meta">
            <span>{captureMetadata.model}</span><span>{captureMetadata.providerId}</span><span>{captureMetadata.attempts} attempt{captureMetadata.attempts === 1 ? "" : "s"}</span>
            <span>{captureMetadata.trackLabel ?? captureMetadata.trackUri ?? "Unknown track"}</span>
          </div>}
          {captureMetadata?.systemPrompt && <details className="sl-ai-system-prompt"><summary>System prompt</summary><pre>{captureMetadata.systemPrompt}</pre></details>}
          <div className="sl-ai-comparison-head"><span>Google baseline</span><span>AI candidate</span></div>
          {getProviderComparisonRows().map((row) => <div className="sl-ai-comparison-row" key={row.id}><span><small>{row.id}</small>{row.baseline || "—"}</span><span>{row.ai || "—"}</span></div>)}
        </div>}
      </Row>}
      <Row label="Saved AI results" description="IndexedDB cache entries for paid refinement work." stacked>
        <div className="sl-ai-cache-inventory">
          <button className="sl-sp-btn" type="button" onClick={() => void listRefinementCacheInventory().then(setCacheInventory)}>Refresh</button>
          {cacheInventory.length ? cacheInventory.map((item) => <div className="sl-ai-cache-item" key={item.key}>
            <span>{item.trackLabel ?? item.trackUri}</span>
            <small>{item.modelName} · {item.status} · {item.tokens.input + item.tokens.output} tokens · {new Date(item.lastAccessedAt).toLocaleString()}</small>
          </div>) : <span className="sl-ai-note">No saved AI results.</span>}
        </div>
      </Row>
    </div>
  );
}
