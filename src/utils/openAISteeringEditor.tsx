import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import {
  allAIRefinementPresets,
  DEFAULT_AI_REFINEMENT_PRESET_ID,
  deleteCustomAIRefinementPreset,
  resolveAIRefinementPreset,
  saveCustomAIRefinementPreset,
} from "./AIRefinementPresets.ts";
import {
  $aiDefaultRefinementPreset,
  $aiDiscoveredModelsByProvider,
  $aiRefinementPresets,
  $aiSelectedModelDescriptorsByProvider,
  $aiSelectedModelsByProvider,
  $aiSelectedProvider,
} from "./stores.ts";
import type { ModelDescriptor, ProviderId } from "./Lyrics/AIRefinement/types.ts";

export type AIRefinementComposerRequest = {
  instructions: string;
  model: ModelDescriptor;
  meaning: boolean;
  sound: boolean;
};

type ComposerOptions = {
  initialLayer: "meaning" | "sound";
  meaningAvailable: boolean;
  soundAvailable: boolean;
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

export function getDefaultAIRefinementRequest(): Pick<AIRefinementComposerRequest, "instructions" | "model"> | null {
  const available = availableModels();
  const model = available.models.find((item) => item.name === available.selected) ?? available.models[0];
  if (!model) return null;
  const preset = resolveAIRefinementPreset($aiRefinementPresets.get(), $aiDefaultRefinementPreset.get());
  return { instructions: preset.instructions, model };
}

function Composer(options: ComposerOptions) {
  const available = useMemo(availableModels, []);
  const customJson = $aiRefinementPresets.get();
  const presets = useMemo(() => allAIRefinementPresets(customJson), [customJson]);
  const defaultPreset = resolveAIRefinementPreset(customJson, $aiDefaultRefinementPreset.get());
  const [defaultPresetId, setDefaultPresetId] = useState(defaultPreset.id);
  const [selectedPresetId, setSelectedPresetId] = useState(defaultPreset.id);
  const [draft, setDraft] = useState(defaultPreset.instructions);
  const [presetName, setPresetName] = useState(defaultPreset.builtIn ? "" : defaultPreset.name);
  const initialModel = available.models.some((model) => model.name === options.currentModelName)
    ? options.currentModelName!
    : available.selected || available.models[0]?.name || "";
  const [modelName, setModelName] = useState(initialModel);
  const [meaning, setMeaning] = useState(options.initialLayer === "meaning" && options.meaningAvailable);
  const [sound, setSound] = useState(options.initialLayer === "sound" && options.soundAvailable);
  const model = available.models.find((item) => item.name === modelName);
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const selectedIsCurrent = selectedPreset?.instructions === draft.trim();

  const selectPreset = (id: string) => {
    const preset = resolveAIRefinementPreset($aiRefinementPresets.get(), id);
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
    const saved = saveCustomAIRefinementPreset($aiRefinementPresets.get(), { id, name, instructions });
    $aiRefinementPresets.set(saved.json);
    setSelectedPresetId(saved.preset.id);
    setPresetName(saved.preset.name);
  };

  const deletePreset = () => {
    if (!selectedPreset || selectedPreset.builtIn) return;
    $aiRefinementPresets.set(deleteCustomAIRefinementPreset($aiRefinementPresets.get(), selectedPreset.id));
    if (defaultPresetId === selectedPreset.id) {
      $aiDefaultRefinementPreset.set(DEFAULT_AI_REFINEMENT_PRESET_ID);
      setDefaultPresetId(DEFAULT_AI_REFINEMENT_PRESET_ID);
    }
    selectPreset(DEFAULT_AI_REFINEMENT_PRESET_ID);
  };

  return <div className="sl-ai-steering-editor sl-ai-request-composer">
    <label>Preset<select value={selectedPresetId} onChange={(event) => selectPreset(event.currentTarget.value)}>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
    <label>Steering<textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder="Describe what the model should preserve, fix, or emphasize." autoFocus /></label>
    <p className="sl-ai-disclosure">Best-effort and text-only. The model receives lyrics, metadata, and steering—not audio—so pronunciation, phrasing, homophones, delivery, and outside artist context may be missed.</p>
    <div className="sl-ai-preset-editor">
      <input value={presetName} onChange={(event) => setPresetName(event.currentTarget.value)} placeholder="Preset name" />
      <button type="button" className="sl-sp-btn" disabled={!presetName.trim() || !draft.trim()} onClick={savePreset}>Save preset</button>
      <button type="button" className="sl-sp-btn" disabled={!selectedPreset || selectedPreset.builtIn} onClick={deletePreset}>Delete preset</button>
      <button type="button" className="sl-sp-btn" disabled={!selectedPreset || !selectedIsCurrent || defaultPresetId === selectedPreset.id} onClick={() => { if (selectedPreset) { $aiDefaultRefinementPreset.set(selectedPreset.id); setDefaultPresetId(selectedPreset.id); } }}>Use for single click</button>
    </div>
    <fieldset>
      <legend>Output</legend>
      <label><input type="checkbox" checked={meaning} disabled={!options.meaningAvailable} onChange={(event) => setMeaning(event.currentTarget.checked)} />Translation</label>
      <label><input type="checkbox" checked={sound} disabled={!options.soundAvailable} onChange={(event) => setSound(event.currentTarget.checked)} />Pronunciation / transliteration</label>
    </fieldset>
    <label>Model<select value={modelName} onChange={(event) => setModelName(event.currentTarget.value)}>{available.models.map((item) => <option value={item.name} key={item.name}>{item.name.replace(/^models\//, "")}</option>)}</select></label>
    <div className="sl-ai-restore-actions">
      {options.meaningRefined && <button type="button" className="sl-sp-btn" onClick={() => { options.onRestoreMeaning(); PopupModal.hide(); }}>Restore translation</button>}
      {options.soundRefined && <button type="button" className="sl-sp-btn" onClick={() => { options.onRestoreSound(); PopupModal.hide(); }}>Restore pronunciation</button>}
    </div>
    <div className="sl-ai-composer-actions">
      <button type="button" className="sl-sp-btn" onClick={() => PopupModal.hide()}>Cancel</button>
      <button type="button" className="sl-sp-btn" disabled={!draft.trim() || !model || (!meaning && !sound)} onClick={() => { if (model) options.onSubmit({ instructions: draft.trim(), model, meaning, sound }); PopupModal.hide(); }}>Refine</button>
    </div>
  </div>;
}

export function openAIRefinementComposer(options: ComposerOptions): void {
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(<Composer {...options} />));
  PopupModal.display({ title: "AI Refinement", content: container, isLarge: true, modalId: "ai-refinement", onClose: () => root.unmount() });
}
