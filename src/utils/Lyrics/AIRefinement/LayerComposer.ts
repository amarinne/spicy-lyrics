import type { DerivedLayer } from "./types.ts";

type LayerItems = Record<string, string>;
type LayerSession = {
  revision: number;
  baseline: any;
  overlays: Partial<Record<DerivedLayer, LayerItems>>;
  deferred: boolean;
};

function targetRows(document: any): Map<string, any> {
  const rows = new Map<string, any>();
  if (document?.Type === "Static") {
    for (let i = 0; i < (document.Lines ?? []).length; i++) rows.set(`S${i}`, document.Lines[i]);
  } else if (document?.Type === "Line") {
    for (let i = 0; i < (document.Content ?? []).length; i++) rows.set(`G${i}`, document.Content[i]);
  } else if (document?.Type === "Syllable") {
    for (let i = 0; i < (document.Content ?? []).length; i++) {
      const group = document.Content[i];
      if (group?.Type !== undefined && group.Type !== "Vocal") { rows.set(`G${i}`, null); continue; }
      rows.set(`L${i}`, group?.Lead);
      for (let j = 0; j < (group?.Background ?? []).length; j++) rows.set(`B${i}.${j}`, group.Background[j]);
    }
  }
  return rows;
}

function applyMeaning(composed: any, items: LayerItems): void {
  const targets = targetRows(composed);
  for (const [id, text] of Object.entries(items)) {
    const target = targets.get(id);
    if (target) target.TranslatedText = text;
  }
  composed.IncludesTranslation = true;
}

function applySound(composed: any, items: LayerItems): void {
  const targets = targetRows(composed);
  for (const [id, text] of Object.entries(items)) {
    const target = targets.get(id);
    if (!target) continue;
    const existing = typeof target?.ReadingRenderPlan?.joinedDisplayText === "string"
      ? target.ReadingRenderPlan.joinedDisplayText
      : typeof target?.RomanizedText === "string" ? target.RomanizedText
        : typeof target?.TransliteratedText === "string" ? target.TransliteratedText
          : typeof target?.JapaneseReading?.romaji === "string" ? target.JapaneseReading.romaji : undefined;
    if (existing === text) continue;
    target.RomanizedText = text;
    target.TransliteratedText = text;
    target.RomanizationSource = "ai";
  }
  composed.HasTransliterations = true;
  composed.IncludesRomanization = true;
}

export class AIDerivedLayerComposer {
  private sessions = new Map<string, LayerSession>();
  private readonly publish: (trackUri: string, document: any, origin: "baseline" | "overlay", revision: number) => void;

  constructor(publish: (trackUri: string, document: any, origin: "baseline" | "overlay", revision: number) => void) { this.publish = publish; }

  acceptBaseline(trackUri: string, revision: number, document: any, deferred = false): void {
    this.sessions.set(trackUri, { revision, baseline: structuredClone(document), overlays: {}, deferred });
    if (!deferred) this.publish(trackUri, this.renderable(document), "baseline", revision);
  }

  acceptLayerPublication(trackUri: string, layer: DerivedLayer, revision: number, items: LayerItems, origin: "baseline" | "overlay"): boolean {
    const session = this.sessions.get(trackUri);
    if (!session || session.revision !== revision) return false;
    if (origin === "baseline") {
      if (!session.overlays[layer]) return true;
      delete session.overlays[layer];
    } else {
      session.overlays[layer] = { ...items };
    }
    if (!session.deferred) this.publishComposed(trackUri, session);
    return true;
  }

  publishDeferred(trackUri: string, revision: number): boolean {
    const session = this.sessions.get(trackUri);
    if (!session || session.revision !== revision) return false;
    session.deferred = false;
    this.publishComposed(trackUri, session);
    return true;
  }

  getBaseline(trackUri: string): any | undefined {
    const baseline = this.sessions.get(trackUri)?.baseline;
    return baseline ? structuredClone(baseline) : undefined;
  }

  invalidate(trackUri: string): void { this.sessions.delete(trackUri); }

  private publishComposed(trackUri: string, session: LayerSession): void {
    const composed = this.renderable(session.baseline);
    if (session.overlays.sound) applySound(composed, session.overlays.sound);
    if (session.overlays.meaning) applyMeaning(composed, session.overlays.meaning);
    this.publish(trackUri, composed, session.overlays.sound || session.overlays.meaning ? "overlay" : "baseline", session.revision);
  }

  private renderable(document: any): any {
    const copy = structuredClone(document);
    delete copy.AIOriginalSnapshot;
    return copy;
  }
}
