import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import { $aiDiscoveredModelsByProvider, $aiInstructions, $aiSelectedModelDescriptorsByProvider, $aiSelectedModelsByProvider, $aiSelectedProvider } from "./stores.ts";
import { notifyAIRefinementConfigChanged } from "./Lyrics/AIRefinement/singleton.ts";
import type { ModelDescriptor, ProviderId } from "./Lyrics/AIRefinement/types.ts";

function Editor() {
  const [draft, setDraft] = useState($aiInstructions.get());
  return <div className="sl-ai-steering-editor">
    <textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder="Preserve honorifics, explain cultural nuance naturally, or guide mixed-language phrasing." autoFocus />
    <div>
      <button type="button" className="sl-sp-btn" onClick={() => PopupModal.hide()}>Cancel</button>
      <button type="button" className="sl-sp-btn" onClick={() => { $aiInstructions.set(draft); notifyAIRefinementConfigChanged(); PopupModal.hide(); }}>Save</button>
    </div>
  </div>;
}

export function openAISteeringEditor(): void {
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(<Editor />));
  PopupModal.display({ title: "AI Instructions", content: container, onClose: () => root.unmount() });
}

function providerMap(value: string): Record<ProviderId, string> {
  try {
    const parsed = JSON.parse(value);
    return { gemini: typeof parsed?.gemini === "string" ? parsed.gemini : "", openai: typeof parsed?.openai === "string" ? parsed.openai : "" };
  } catch { return { gemini: "", openai: "" }; }
}

function revisionModels(): { models: ModelDescriptor[]; selected: string } {
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

function RevisionEditor({ currentModelName, onSubmit, onRestore }: { currentModelName?: string; onSubmit: (instructions: string, model: ModelDescriptor) => void; onRestore: () => void }) {
  const available = revisionModels();
  const initialModel = available.models.some((model) => model.name === currentModelName) ? currentModelName! : available.selected || available.models[0]?.name || "";
  const [draft, setDraft] = useState("");
  const [modelName, setModelName] = useState(initialModel);
  const model = available.models.find((item) => item.name === modelName);
  return <div className="sl-ai-steering-editor sl-ai-revision-editor">
    <label>What should change?<textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder="Keep the cultural reference, make the chorus less literal, or fix the mixed-language phrase." autoFocus /></label>
    <label>Model<select value={modelName} onChange={(event) => setModelName(event.currentTarget.value)}>{available.models.map((item) => <option value={item.name} key={item.name}>{item.name.replace(/^models\//, "")}</option>)}</select></label>
    <div>
      <button type="button" className="sl-sp-btn" onClick={() => { onRestore(); PopupModal.hide(); }}>Restore baseline</button>
      <button type="button" className="sl-sp-btn" onClick={() => PopupModal.hide()}>Cancel</button>
      <button type="button" className="sl-sp-btn" disabled={!draft.trim() || !model} onClick={() => { if (model) onSubmit(draft, model); PopupModal.hide(); }}>Refine again</button>
    </div>
  </div>;
}

export function openAIRevisionEditor(options: { currentModelName?: string; onSubmit: (instructions: string, model: ModelDescriptor) => void; onRestore: () => void }): void {
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(<RevisionEditor {...options} />));
  PopupModal.display({ title: "Refine AI Output", content: container, onClose: () => root.unmount() });
}
