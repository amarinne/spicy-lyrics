import { atom } from "nanostores";
import { isRhymeChineseMode, resolveChineseTranslitMode, type ChineseTranslitMode, type ChineseLanguage } from "./ChineseTranslitMode.ts";
import { validChineseAudioDecision, type ChineseAudioDecision } from "./ChineseAudioDetection.ts";

const CACHE_KEY = "SL:chineseAudioDetection";
const decisions = new Map<string, ChineseAudioDecision>();
export const $chineseAudioRevision = atom(0);
export const $chineseAudioStatus = atom<"waiting" | "listening" | "unavailable" | "detected">("waiting");
try {
  const saved = JSON.parse(Spicetify.LocalStorage.get(CACHE_KEY) ?? "{}");
  for (const [uri, value] of Object.entries(saved).slice(-512)) {
    if (/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) && validChineseAudioDecision(value)) decisions.set(uri, value);
  }
} catch { /* A missing or old cache only delays detection. */ }

export function resolvedChineseMode(mode: ChineseTranslitMode, uri: string, lyrics?: {
  uri?: string;
  ChineseRhymeGuess?: { language?: ChineseLanguage };
}) {
  if (isRhymeChineseMode(mode)) {
    return resolveChineseTranslitMode(mode, lyrics?.uri === uri ? lyrics.ChineseRhymeGuess?.language : undefined);
  }
  // Auto mode shows a confident text guess immediately; the audio decision replaces it when it lands.
  return resolveChineseTranslitMode(mode,
    decisions.get(uri)?.language ?? (lyrics?.uri === uri ? lyrics.ChineseRhymeGuess?.language : undefined));
}

export const hasChineseAudioDecision = (uri: string): boolean => decisions.has(uri);

export function saveChineseAudioDecision(uri: string, decision: ChineseAudioDecision): void {
  decisions.delete(uri);
  decisions.set(uri, decision);
  if (decisions.size > 512) decisions.delete(decisions.keys().next().value!);
  try {
    Spicetify.LocalStorage.set(CACHE_KEY, JSON.stringify(Object.fromEntries(decisions)));
  } catch { /* The current session can use the decision even when storage is full. */ }
  $chineseAudioStatus.set("detected");
  $chineseAudioRevision.set($chineseAudioRevision.get() + 1);
}
