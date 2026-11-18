import type { ChineseLanguage } from "./ChineseTranslitMode.ts";

export const CHINESE_AUDIO_REVISION = "qwen-zipa-phonefit-v1";
export const CHINESE_AUDIO_ENDPOINT = "http://127.0.0.1:18767/window";

/** One captured window. Both signals are null when the helper found no usable audio. */
export type ChineseAudioWindow = {
  /** Qwen first-token language log-odds; positive leans Cantonese. */
  logOdds: number | null;
  /** ZIPA phone fit of the aligned lyric span; positive leans Cantonese. */
  phoneFit: number | null;
};

export type ChineseAudioDecision = {
  revision: typeof CHINESE_AUDIO_REVISION;
  language: ChineseLanguage;
  /** Which signal produced the language: the reading fit when enough windows carry it, else LID. */
  method: "phone" | "lid";
  windows: ChineseAudioWindow[];
};

/** Positive reading fit means jyutping explains the vocals better than pinyin. */
const PHONE_FIT_THRESHOLD = 0.025;
/** The desktop probe separates the languages around a mean log-odds of -10. */
const LID_THRESHOLD = -10;
const MIN_PHONE_WINDOWS = 2;
const WINDOW_COUNT = 3;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Reading fit needs two of three windows; otherwise the older LID rule needs all three.
 * Both values are kept so the decision log can show why a track landed where it did.
 */
export function classifyChineseAudio(windows: readonly ChineseAudioWindow[]): ChineseAudioDecision | undefined {
  if (windows.length !== WINDOW_COUNT) return;
  const copied = windows.map((window) => ({
    logOdds: finite(window?.logOdds) ? window.logOdds : null,
    phoneFit: finite(window?.phoneFit) ? window.phoneFit : null,
  }));
  const fits = copied.map((window) => window.phoneFit).filter(finite);
  if (fits.length >= MIN_PHONE_WINDOWS) {
    return {
      revision: CHINESE_AUDIO_REVISION,
      language: mean(fits) > PHONE_FIT_THRESHOLD ? "yue" : "cmn",
      method: "phone",
      windows: copied,
    };
  }
  const logOdds = copied.map((window) => window.logOdds).filter(finite);
  if (logOdds.length !== WINDOW_COUNT) return;
  return {
    revision: CHINESE_AUDIO_REVISION,
    language: mean(logOdds) > LID_THRESHOLD ? "yue" : "cmn",
    method: "lid",
    windows: copied,
  };
}

export function validChineseAudioDecision(value: unknown): value is ChineseAudioDecision {
  const decision = value as ChineseAudioDecision | undefined;
  if (!decision || decision.revision !== CHINESE_AUDIO_REVISION || !Array.isArray(decision.windows)) return false;
  if (decision.windows.length !== WINDOW_COUNT) return false;
  if (decision.windows.some((window) => !window || typeof window !== "object"
    || (window.logOdds !== null && !finite(window.logOdds))
    || (window.phoneFit !== null && !finite(window.phoneFit)))) return false;
  const replay = classifyChineseAudio(decision.windows);
  return replay?.language === decision.language && replay.method === decision.method;
}

export type ChinesePlayback = { uri: string; positionMs: number; playing: boolean; eligible: boolean };
type DetectionDependencies = {
  playback: () => ChinesePlayback;
  cached: (uri: string) => boolean;
  save: (uri: string, decision: ChineseAudioDecision) => void;
  capture: (uri: string, signal: AbortSignal) => Promise<ChineseAudioWindow | null>;
  now?: () => number;
};

/** Owns one request and one track's partial evidence. A changed track cannot publish old evidence. */
export class ChineseAudioDetector {
  private deps: DetectionDependencies;
  private uri = "";
  private windows: { position: number; logOdds: number | null; phoneFit: number | null }[] = [];
  private attempts = 0;
  private retryAt = 0;
  private request?: { controller: AbortController; position: number; started: number };

  constructor(deps: DetectionDependencies) { this.deps = deps; }

  stop(): void {
    this.request?.controller.abort();
    this.request = undefined;
    this.uri = "";
    this.windows = [];
    this.attempts = 0;
    this.retryAt = 0;
  }

  tick(): void {
    const state = this.deps.playback();
    const now = this.deps.now?.() ?? Date.now();
    if (!state.eligible || state.uri !== this.uri) {
      this.stop();
      if (!state.eligible) return;
      this.uri = state.uri;
    }
    if (this.request) {
      const elapsed = now - this.request.started;
      // Capture takes 30 s; the first request also loads Qwen, htdemucs and ZIPA.
      if (!state.playing || Math.abs(state.positionMs - this.request.position - elapsed) > 2000 || elapsed > 180_000) {
        this.request.controller.abort();
        this.request = undefined;
        this.retryAt = now + 5000;
      }
      return;
    }
    if (!state.playing || this.deps.cached(state.uri) || this.attempts >= 6 || now < this.retryAt) return;
    if (this.windows.some((window) => Math.abs(state.positionMs - window.position) < 30_000)) return;
    const uri = state.uri;
    const request = { controller: new AbortController(), position: state.positionMs, started: now };
    this.request = request;
    void this.deps.capture(uri, request.controller.signal).then((window) => {
      if (this.request !== request || request.controller.signal.aborted) return;
      const current = this.deps.playback();
      const elapsed = (this.deps.now?.() ?? Date.now()) - request.started;
      if (!current.eligible || !current.playing || current.uri !== uri
        || Math.abs(current.positionMs - request.position - elapsed) > 2000) return;
      this.attempts += 1;
      if (window && (finite(window.logOdds) || finite(window.phoneFit))) {
        this.windows.push({ position: request.position, logOdds: window.logOdds, phoneFit: window.phoneFit });
        // Silence or a failed span can leave a window without enough evidence to decide. Slide
        // forward one window at a time instead of throwing away the whole track.
        if (this.windows.length > 3) this.windows.shift();
      }
      const decision = classifyChineseAudio(this.windows);
      if (decision) this.deps.save(uri, decision);
      this.retryAt = (this.deps.now?.() ?? Date.now()) + 2000;
    }).catch(() => {
      if (this.request === request) this.retryAt = (this.deps.now?.() ?? Date.now()) + 60_000;
    }).finally(() => {
      if (this.request === request) this.request = undefined;
    });
  }
}
