import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import type { ProviderComparisonRow } from "./Lyrics/AIRefinement/DebugCapture.ts";

type ReviewPanelOptions = {
  trackUri: string;
  layer: "meaning" | "sound";
  authority: "baseline" | "ai";
  status: "idle" | "covered" | "requested" | "refining" | "refined" | "unchanged" | "failed" | "cancelled";
  presetName: string;
  modelName?: string;
  comparison: { captures: number; rows: ProviderComparisonRow[] };
  onRefine: () => void;
  onRestore: () => void;
};

function ReviewPanel(options: ReviewPanelOptions) {
  const busy = options.status === "requested" || options.status === "refining";
  const hasOutput = options.comparison.rows.some((row) => row.attempts.length > 0);
  const baselineLabel = options.layer === "sound" ? "Built-in / Google" : "Google";
  return <div className="sl-ai-output-review">
    <div className="sl-ai-output-review-summary">
      <div><small>Preset</small><strong>{options.presetName}</strong></div>
      <div><small>Model</small><strong>{options.modelName?.replace(/^models\//, "") ?? "Unknown"}</strong></div>
    </div>
    {!options.comparison.rows.length && <p className="sl-ai-output-review-empty">{options.status === "covered" ? "Built-in processing already covers this pronunciation lane. You can still process its output with AI manually." : "No AI output yet. Run the lane with the selected preset and model."}</p>}
    <div className="sl-ai-comparison sl-ai-output-review-document">
      {options.comparison.rows.map((row) => <article className="sl-ai-comparison-row" key={row.id}>
        <header>{row.id}</header>
        <div className="sl-ai-comparison-version"><small>Original</small><span>{row.original || "—"}</span></div>
        <div className="sl-ai-comparison-version"><small>{baselineLabel}</small><span>{row.baseline || "—"}</span></div>
        {row.attempts.map((attempt) => <div className={`sl-ai-comparison-version sl-ai-comparison-attempt${attempt.accepted ? " accepted" : ""}`} key={`${row.id}-${attempt.number}`}>
          <small>AI output {attempt.number}{attempt.repair ? " · repair" : ""} · {attempt.model.replace(/^models\//, "")}</small>
          <span>{attempt.text || "—"}</span>
        </div>)}
      </article>)}
    </div>
    <div className="sl-ai-output-review-actions">
      <button className="sl-sp-btn" type="button" disabled={busy} onClick={options.onRefine}>{options.status === "covered" ? "Process with AI…" : hasOutput ? "Refine again…" : options.status === "failed" ? "Retry…" : "Run AI…"}</button>
      {options.authority === "ai" && <button className="sl-sp-btn" type="button" onClick={() => { options.onRestore(); PopupModal.hide(); }}>Restore {baselineLabel}</button>}
      <button className="sl-sp-btn" type="button" onClick={() => PopupModal.hide()}>Close</button>
    </div>
  </div>;
}

export function openAIOutputReviewPanel(options: ReviewPanelOptions): void {
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(<ReviewPanel {...options} />));
  PopupModal.display({ title: options.layer === "sound" ? "AI Pronunciation" : "AI Translation", content: container, isLarge: true, modalId: "ai-output-review", onClose: () => root.unmount() });
}
