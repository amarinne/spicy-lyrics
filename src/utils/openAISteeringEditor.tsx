import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import {
  allAIRefinementPresets,
  DEFAULT_AI_REFINEMENT_PRESET_ID,
  DEFAULT_AI_SOUND_PRESET_ID,
  deleteCustomAIRefinementPreset,
  resolveAIRefinementPreset,
  saveCustomAIRefinementPreset,
} from "./AIRefinementPresets.ts";
import {
  $aiDefaultRefinementPreset,
  $aiDefaultSoundRefinementPreset,
  $aiDiscoveredModelsByProvider,
  $aiRefinementPresets,
  $aiSoundRefinementPresets,
  $aiSelectedModelDescriptorsByProvider,
  $aiSelectedModelsByProvider,
  $aiSelectedProvider,
} from "./stores.ts";
import type { ModelDescriptor, ProviderId } from "./Lyrics/AIRefinement/types.ts";

export type AIRefinementComposerRequest = {
  instructions: string;
  model: ModelDescriptor;
};

type ComposerOptions = {
  initialLayer: "meaning" | "sound";
  available: boolean;
  meaningRefined: boolean;
  soundRefined: boolean;
  currentModelName?: string;
  onSubmit: (request: AIRefinementComposerRequest) => void;
  onRestoreMeaning: () => void;
  onRestoreSound: () => void;
};

function providerMap(value: string): Record<ProviderId, string> {
  try {
    const parsed = JSON.parse(value);
    return { gemini: typeof parsed?.gemini === "string" ? parsed.gemini : "", openai: typeof parsed?.openai === "string" ? parsed.openai : "" };
  } catch { return { gemini: "", openai: "" }; }
}

function availableModels(): { models: ModelDescriptor[]; selected: string } {
  const provider: ProviderId = $aiSelectedProvider.get() === "openai" ? "openai" : "gemini";
  let models: ModelDescriptor[] = [];
  try {
    const parsed = JSON.parse(providerMap($aiDiscoveredModelsByProvider.get())[provider]);
    if (Array.isArray(parsed)) models = parsed.filter((model) => typeof model?.name === "string");
  } catch {}
  const selected = providerMap($aiSelectedModelsByProvider.get())[provider];
  if (selected && !models.some((model) => model.name === selected)) {
    try {
      const descriptor = JSON.parse(providerMap($aiSelectedModelDescriptorsByProvider.get())[provider]);
      if (descriptor?.name === selected) models.push(descriptor);
    } catch {}
  }
  return { models, selected };
}

export function getDefaultAIRefinementRequest(layer: "meaning" | "sound" = "meaning"): Pick<AIRefinementComposerRequest, "instructions" | "model"> | null {
  const available = availableModels();
  const model = available.models.find((item) => item.name === available.selected) ?? available.models[0];
  if (!model) return null;
  const customJson = layer === "sound" ? $aiSoundRefinementPresets.get() : $aiRefinementPresets.get();
  const defaultId = layer === "sound" ? $aiDefaultSoundRefinementPreset.get() : $aiDefaultRefinementPreset.get();
  const preset = resolveAIRefinementPreset(customJson, defaultId, layer);
  return { instructions: preset.instructions, model };
}

function Composer(options: ComposerOptions) {
  const available = useMemo(availableModels, []);
  const customJson = options.initialLayer === "sound" ? $aiSoundRefinementPresets.get() : $aiRefinementPresets.get();
  const configuredDefaultId = options.initialLayer === "sound" ? $aiDefaultSoundRefinementPreset.get() : $aiDefaultRefinementPreset.get();
  const presets = useMemo(() => allAIRefinementPresets(customJson, options.initialLayer), [customJson, options.initialLayer]);
  const defaultPreset = resolveAIRefinementPreset(customJson, configuredDefaultId, options.initialLayer);
  const [defaultPresetId, setDefaultPresetId] = useState(defaultPreset.id);
  const [selectedPresetId, setSelectedPresetId] = useState(defaultPreset.id);
  const [draft, setDraft] = useState(defaultPreset.instructions);
  const [presetName, setPresetName] = useState(defaultPreset.builtIn ? "" : defaultPreset.name);
  const initialModel = available.models.some((model) => model.name === options.currentModelName)
    ? options.currentModelName!
    : available.selected || available.models[0]?.name || "";
  const [modelName, setModelName] = useState(initialModel);
  const model = available.models.find((item) => item.name === modelName);
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const selectedIsCurrent = selectedPreset?.instructions === draft.trim();

  const selectPreset = (id: string) => {
    const json = options.initialLayer === "sound" ? $aiSoundRefinementPresets.get() : $aiRefinementPresets.get();
    const preset = resolveAIRefinementPreset(json, id, options.initialLayer);
    setSelectedPresetId(preset.id);
    setDraft(preset.instructions);
    setPresetName(preset.builtIn ? "" : preset.name);
  };

  const savePreset = () => {
    const name = presetName.trim();
    const instructions = draft.trim();
    if (!name || !instructions) return;
    const existing = selectedPreset && !selectedPreset.builtIn ? selectedPreset.id : undefined;
    const id = existing ?? `custom-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const store = options.initialLayer === "sound" ? $aiSoundRefinementPresets : $aiRefinementPresets;
    const saved = saveCustomAIRefinementPreset(store.get(), { id, name, instructions }, options.initialLayer);
    store.set(saved.json);
    setSelectedPresetId(saved.preset.id);
    setPresetName(saved.preset.name);
  };

  const deletePreset = () => {
    if (!selectedPreset || selectedPreset.builtIn) return;
    const store = options.initialLayer === "sound" ? $aiSoundRefinementPresets : $aiRefinementPresets;
    const defaultStore = options.initialLayer === "sound" ? $aiDefaultSoundRefinementPreset : $aiDefaultRefinementPreset;
    const fallbackId = options.initialLayer === "sound" ? DEFAULT_AI_SOUND_PRESET_ID : DEFAULT_AI_REFINEMENT_PRESET_ID;
    store.set(deleteCustomAIRefinementPreset(store.get(), selectedPreset.id, options.initialLayer));
    if (defaultPresetId === selectedPreset.id) {
      defaultStore.set(fallbackId);
      setDefaultPresetId(fallbackId);
    }
    selectPreset(fallbackId);
  };

  return <div className="sl-ai-steering-editor sl-ai-request-composer">
    <label>Preset<select value={selectedPresetId} onChange={(event) => selectPreset(event.currentTarget.value)}>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
    <label>{options.initialLayer === "sound" ? "Pronunciation steering" : "Steering"}<textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder={options.initialLayer === "sound" ? "Add language-specific pronunciation guidance." : "Describe what the model should preserve, fix, or emphasize."} autoFocus /></label>
    <div className="sl-ai-preset-editor">
        <input value={presetName} onChange={(event) => setPresetName(event.currentTarget.value)} placeholder="Preset name" />
        <button type="button" className="sl-sp-btn" disabled={!presetName.trim() || !draft.trim()} onClick={savePreset}>Save preset</button>
        <button type="button" className="sl-sp-btn" disabled={!selectedPreset || selectedPreset.builtIn} onClick={deletePreset}>Delete preset</button>
        <button type="button" className="sl-sp-btn" disabled={!selectedPreset || !selectedIsCurrent || defaultPresetId === selectedPreset.id} onClick={() => { if (selectedPreset) { (options.initialLayer === "sound" ? $aiDefaultSoundRefinementPreset : $aiDefaultRefinementPreset).set(selectedPreset.id); setDefaultPresetId(selectedPreset.id); } }}>Use for single click</button>
    </div>
    <p className="sl-ai-disclosure">Best-effort and text-only. The model receives lyrics, metadata, and steering—not audio—so pronunciation, phrasing, homophones, delivery, and outside artist context may be missed.</p>
    <label>Model<select value={modelName} onChange={(event) => setModelName(event.currentTarget.value)}>{available.models.map((item) => <option value={item.name} key={item.name}>{item.name.replace(/^models\//, "")}</option>)}</select></label>
    <div className="sl-ai-restore-actions">
      {options.initialLayer === "meaning" && options.meaningRefined && <button type="button" className="sl-sp-btn" onClick={() => { options.onRestoreMeaning(); PopupModal.hide(); }}>Restore translation</button>}
      {options.initialLayer === "sound" && options.soundRefined && <button type="button" className="sl-sp-btn" onClick={() => { options.onRestoreSound(); PopupModal.hide(); }}>Restore pronunciation</button>}
    </div>
    <div className="sl-ai-composer-actions">
      <button type="button" className="sl-sp-btn" onClick={() => PopupModal.hide()}>Cancel</button>
      <button type="button" className="sl-sp-btn" disabled={!options.available || !draft.trim() || !model} onClick={() => { if (model && options.available) options.onSubmit({ instructions: draft.trim(), model }); PopupModal.hide(); }}>Refine</button>
    </div>
  </div>;
}

export function openAIRefinementComposer(options: ComposerOptions, transition = false): void {
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(<Composer {...options} />));
  const modal = { title: options.initialLayer === "meaning" ? "AI Translation" : "AI Pronunciation", content: container, modalId: "ai-refinement", onClose: () => root.unmount() };
  if (transition && PopupModal.isConnected) PopupModal.transition(modal);
  else PopupModal.display({ ...modal, isLarge: true });
}
