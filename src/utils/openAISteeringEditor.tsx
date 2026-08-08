import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import { $aiSteeringInstructions, $soundSteeringInstructions } from "./stores.ts";
import { aiRefinementCoordinator, aiSoundCoordinator } from "./Lyrics/AIRefinement/singleton.ts";
import { AI_MAX_STEERING_BYTES } from "./Lyrics/AIRefinement/types.ts";

function Editor({ layer }: { layer: "meaning" | "sound" }) {
  const store = layer === "sound" ? $soundSteeringInstructions : $aiSteeringInstructions;
  const coordinator = layer === "sound" ? aiSoundCoordinator : aiRefinementCoordinator;
  const [draft, setDraft] = useState(store.get());
  const bytes = new TextEncoder().encode(draft).byteLength;
  return <div className="sl-ai-steering-editor">
    <textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder={layer === "sound" ? "Example: Use Egyptian Arabic pronunciation; keep English names unchanged." : "Example: Preserve Vietnamese honorifics; translate the Korean verse informally."} autoFocus />
    <small>{bytes}/{AI_MAX_STEERING_BYTES} UTF-8 bytes</small>
    <div>
      <button type="button" className="sl-sp-btn" onClick={() => PopupModal.hide()}>Cancel</button>
      <button type="button" className="sl-sp-btn" disabled={bytes > AI_MAX_STEERING_BYTES} onClick={() => { store.set(draft); coordinator.notifyConfigChanged(); PopupModal.hide(); }}>Save instructions</button>
    </div>
  </div>;
}

export function openAISteeringEditor(layer: "meaning" | "sound"): void {
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(<Editor layer={layer} />));
  PopupModal.display({ title: layer === "sound" ? "Sound instructions" : "Meaning instructions", content: container, onClose: () => root.unmount() });
}
