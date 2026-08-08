import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import { $aiSteeringInstructions } from "./stores.ts";
import { aiRefinementCoordinator } from "./Lyrics/AIRefinement/singleton.ts";
import { AI_MAX_STEERING_BYTES } from "./Lyrics/AIRefinement/types.ts";

function Editor() {
  const [draft, setDraft] = useState($aiSteeringInstructions.get());
  const bytes = new TextEncoder().encode(draft).byteLength;
  return <div className="sl-ai-steering-editor">
    <p>Optional guidance for mixed languages, dialect, tone, names, slang, or cultural nuance.</p>
    <textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} placeholder="Example: Preserve Vietnamese honorifics; translate the Korean verse informally." autoFocus />
    <small>{bytes}/{AI_MAX_STEERING_BYTES} UTF-8 bytes</small>
    <div>
      <button type="button" className="sl-sp-btn" onClick={() => PopupModal.hide()}>Cancel</button>
      <button type="button" className="sl-sp-btn" disabled={bytes > AI_MAX_STEERING_BYTES} onClick={() => { $aiSteeringInstructions.set(draft); aiRefinementCoordinator.notifyConfigChanged(); PopupModal.hide(); }}>Save instructions</button>
    </div>
  </div>;
}

export function openAISteeringEditor(): void {
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(<Editor />));
  PopupModal.display({ title: "AI instructions", content: container, onClose: () => root.unmount() });
}
