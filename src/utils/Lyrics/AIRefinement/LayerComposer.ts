import { enumerateSourceRows } from "./document.ts";
import type { DerivedLayer } from "./types.ts";

type LayerSession = {
  revision: number;
  baseline: any;
  overlays: Partial<Record<DerivedLayer, any>>;
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

function sameSource(left: any, right: any): boolean {
  try {
    const leftRows = enumerateSourceRows(left);
    const rightRows = enumerateSourceRows(right);
    return leftRows.length === rightRows.length && leftRows.every((row, index) => row.id === rightRows[index].id && row.sourceText === rightRows[index].sourceText);
  } catch { return false; }
}

function applyMeaning(composed: any, overlay: any): void {
  const targets = targetRows(composed);
  for (const [id, source] of targetRows(overlay)) {
    const target = targets.get(id);
    if (target && typeof source?.TranslatedText === "string") target.TranslatedText = source.TranslatedText;
  }
  composed.IncludesTranslation = true;
}

function applySound(composed: any, overlay: any): void {
  const targets = targetRows(composed);
  for (const [id, source] of targetRows(overlay)) {
    const target = targets.get(id);
    const text = typeof source?.RomanizedText === "string" ? source.RomanizedText : source?.TransliteratedText;
    if (!target || typeof text !== "string") continue;
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
  private readonly publish: (trackUri: string, document: any, origin: "baseline" | "overlay") => void;

  constructor(publish: (trackUri: string, document: any, origin: "baseline" | "overlay") => void) { this.publish = publish; }

  acceptBaseline(trackUri: string, revision: number, document: any): void {
    this.sessions.set(trackUri, { revision, baseline: structuredClone(document), overlays: {} });
    this.publish(trackUri, this.renderable(document), "baseline");
  }

  acceptLayerPublication(trackUri: string, layer: DerivedLayer, revision: number, document: any, origin: "baseline" | "overlay"): boolean {
    const session = this.sessions.get(trackUri);
    if (!session || session.revision !== revision || !sameSource(session.baseline, document)) return false;
    if (origin === "baseline") {
      if (!session.overlays[layer]) return true;
      delete session.overlays[layer];
    } else {
      session.overlays[layer] = structuredClone(document);
    }
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
    this.publish(trackUri, composed, session.overlays.sound || session.overlays.meaning ? "overlay" : "baseline");
  }

  private renderable(document: any): any {
    const copy = structuredClone(document);
    delete copy.AIOriginalSnapshot;
    return copy;
  }
}
