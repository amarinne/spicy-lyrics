import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import { $aiInstructions } from "./stores.ts";
import { notifyAIRefinementConfigChanged } from "./Lyrics/AIRefinement/singleton.ts";

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
