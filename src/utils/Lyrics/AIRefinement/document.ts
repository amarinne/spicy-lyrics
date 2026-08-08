import { shouldTranslateLine } from "../Fork/Translation.ts";
import { canonicalTextFromSyllables } from "../Processing/ProviderBoundary.ts";
import { AI_ORIGINAL_SNAPSHOT_SCHEMA, type CanonicalOriginalSnapshot, type EnumeratedLine, type RefinementLineClass } from "./types.ts";

const STRUCTURAL_HEADINGS = /^(?:intro|verse(?: \d+)?|pre-chorus|chorus|post-chorus|refrain|hook|bridge|interlude|instrumental|break|solo|outro)$/;
const ADLIB_TOKENS = new Set(["ah", "aah", "eh", "hey", "hm", "hmm", "la", "na", "oh", "ooh", "uh", "woo", "woah", "yeah", "yo"]);

export function classifyRefinementLine(sourceText: string): RefinementLineClass {
  const trimmed = sourceText.trim();
  if (!trimmed || ["♪", "♫", "♬"].includes(trimmed)) return "structural";
  const heading = trimmed.match(/^\[([^\]]+)\]$/);
  if (heading) {
    const label = heading[1].normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
    if ([...label].every((character) => character.charCodeAt(0) <= 0x7f) && STRUCTURAL_HEADINGS.test(label)) return "structural";
  }
  const tokens = trimmed.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((token) => ADLIB_TOKENS.has(token))) return "adlib";
  return "ordinary";
}

function syllableText(group: any): string {
  return Array.isArray(group?.Syllables) ? canonicalTextFromSyllables(group.Syllables).canonical.text : "";
}
function row(id: string, sourceText: string, target: any, sourceLang: string, targetLang: string): EnumeratedLine {
  const lineClass = classifyRefinementLine(sourceText);
  const sendDisposition = lineClass === "structural" ? "structural" : shouldTranslateLine(sourceText, sourceLang, targetLang) ? "sent" : "skipped";
  return { id, class: lineClass, sendDisposition, sourceText, baselineTranslatedText: typeof target?.TranslatedText === "string" ? target.TranslatedText : undefined, target: target ?? null, targetField: target ? "TranslatedText" : null };
}

export function enumerateRefinementLines(document: any, targetLang: string): EnumeratedLine[] {
  const sourceLang = document?.Language || "und";
  const rows: EnumeratedLine[] = [];
  if (document?.Type === "Static") {
    for (let i = 0; i < (document.Lines ?? []).length; i++) rows.push(row(`S${i}`, document.Lines[i]?.Text ?? "", document.Lines[i], sourceLang, targetLang));
  } else if (document?.Type === "Line") {
    for (let i = 0; i < (document.Content ?? []).length; i++) rows.push(row(`G${i}`, document.Content[i]?.Text ?? "", document.Content[i], sourceLang, targetLang));
  } else if (document?.Type === "Syllable") {
    for (let i = 0; i < (document.Content ?? []).length; i++) {
      const group = document.Content[i];
      if (group?.Type !== undefined && group.Type !== "Vocal") { rows.push(row(`G${i}`, group?.Text ?? "", null, sourceLang, targetLang)); continue; }
      rows.push(row(`L${i}`, syllableText(group?.Lead), group?.Lead, sourceLang, targetLang));
      for (let j = 0; j < (group?.Background ?? []).length; j++) rows.push(row(`B${i}.${j}`, syllableText(group.Background[j]), group.Background[j], sourceLang, targetLang));
    }
  } else throw new TypeError(`Unsupported lyrics type: ${String(document?.Type)}`);
  return rows;
}

function soundRow(id: string, sourceText: string, target: any): EnumeratedLine {
  const lineClass = classifyRefinementLine(sourceText);
  const baseline = typeof target?.ReadingRenderPlan?.joinedDisplayText === "string"
    ? target.ReadingRenderPlan.joinedDisplayText
    : typeof target?.RomanizedText === "string"
      ? target.RomanizedText
      : typeof target?.TransliteratedText === "string"
        ? target.TransliteratedText
        : typeof target?.JapaneseReading?.romaji === "string"
          ? target.JapaneseReading.romaji
          : undefined;
  return { id, class: lineClass, sendDisposition: lineClass === "structural" ? "structural" : "sent", sourceText, baselineTranslatedText: baseline, target: target ?? null, targetField: target ? "RomanizedText" : null };
}

export function enumerateSourceRows(document: any): Array<{ id: string; sourceText: string }> {
  if (document?.Type === "Static") return (document.Lines ?? []).map((line: any, index: number) => ({ id: `S${index}`, sourceText: line?.Text ?? "" }));
  if (document?.Type === "Line") return (document.Content ?? []).map((line: any, index: number) => ({ id: `G${index}`, sourceText: line?.Text ?? "" }));
  if (document?.Type === "Syllable") {
    const rows: Array<{ id: string; sourceText: string }> = [];
    for (let i = 0; i < (document.Content ?? []).length; i++) {
      const group = document.Content[i];
      if (group?.Type !== undefined && group.Type !== "Vocal") { rows.push({ id: `G${i}`, sourceText: group?.Text ?? "" }); continue; }
      rows.push({ id: `L${i}`, sourceText: syllableText(group?.Lead) });
      for (let j = 0; j < (group?.Background ?? []).length; j++) rows.push({ id: `B${i}.${j}`, sourceText: syllableText(group.Background[j]) });
    }
    return rows;
  }
  throw new TypeError(`Unsupported lyrics type: ${String(document?.Type)}`);
}

export function enumerateSoundLines(document: any): EnumeratedLine[] {
  const rows: EnumeratedLine[] = [];
  if (document?.Type === "Static") {
    for (let i = 0; i < (document.Lines ?? []).length; i++) rows.push(soundRow(`S${i}`, document.Lines[i]?.Text ?? "", document.Lines[i]));
  } else if (document?.Type === "Line") {
    for (let i = 0; i < (document.Content ?? []).length; i++) rows.push(soundRow(`G${i}`, document.Content[i]?.Text ?? "", document.Content[i]));
  } else if (document?.Type === "Syllable") {
    throw new TypeError("sound_alignment_required");
  } else throw new TypeError(`Unsupported lyrics type: ${String(document?.Type)}`);
  return rows;
}

export function captureOriginalSnapshot(document: Record<string, unknown>, targetLang: string | null): CanonicalOriginalSnapshot {
  const derivedKeys = new Set([
    "AIOriginalSnapshot", "TranslatedText", "RomanizedText", "TransliteratedText",
    "ReadingPlan", "RenderPlan", "ReadingRenderPlan", "ReadingAnnotation", "Annotations", "Furigana", "JapaneseReading",
    "FuriganaHtml", "FuriganaText", "FuriganaAnnotations", "FuriganaTargetStart", "FuriganaTargetEnd", "FuriganaSegments",
    "HasTransliterations", "IncludesRomanization", "IncludesTranslation", "DetectedChinese",
    "ProcessingPending", "RomanizationPending", "TranslationPending", "ProcessingVersion",
    "ProcessingContextKey", "ReadingPlanSchemaVersion", "fromCache",
  ]);
  const sourceOnly = (value: any): any => {
    if (Array.isArray(value)) return value.map(sourceOnly);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (!derivedKeys.has(key)) out[key] = sourceOnly(child);
    }
    return out;
  };
  const deepFreeze = (value: any): any => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
  };
  return deepFreeze({ schema: AI_ORIGINAL_SNAPSHOT_SCHEMA, targetLang, document: sourceOnly(structuredClone(document)) });
}
export function cloneSnapshotDocument(snapshot: CanonicalOriginalSnapshot): Record<string, unknown> {
  if (snapshot.schema !== AI_ORIGINAL_SNAPSHOT_SCHEMA) throw new TypeError("Unsupported original snapshot schema");
  return structuredClone(snapshot.document);
}
