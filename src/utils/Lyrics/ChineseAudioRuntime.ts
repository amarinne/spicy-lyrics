import { $chineseTranslitMode } from "../uiState.ts";
import { $currentLyricsData } from "../stores.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import { isAudioChineseMode } from "./ChineseTranslitMode.ts";
import {
  CHINESE_AUDIO_ENDPOINT, CHINESE_AUDIO_REVISION, ChineseAudioDetector, type ChineseAudioWindow,
} from "./ChineseAudioDetection.ts";
import { $chineseAudioStatus, hasChineseAudioDecision, saveChineseAudioDecision } from "./ChineseAudioState.ts";
import { chineseAudioLyricLines } from "./ChineseAudioLyrics.ts";
import { recordChineseAudio } from "./ChineseDetectionLog.ts";

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

let stopDetection: (() => void) | undefined;
export function startChineseAudioDetection(): void {
  if (stopDetection) return;
  let lastUri = "";
  const detector = new ChineseAudioDetector({
    playback: () => {
      const uri = SpotifyPlayer.GetUri() ?? "";
      if (uri !== lastUri) {
        lastUri = uri;
        $chineseAudioStatus.set(hasChineseAudioDecision(uri) ? "detected" : "waiting");
      }
      if (!SpotifyPlayer.IsPlaying && $chineseAudioStatus.get() === "listening") $chineseAudioStatus.set("waiting");
      const auto = isAudioChineseMode($chineseTranslitMode.get());
      if (!auto) return { uri, positionMs: 0, playing: false, eligible: false };
      let chinese = false;
      try {
        const lyrics = JSON.parse($currentLyricsData.get() || "null");
        chinese = lyrics?.uri === uri && lyrics?.DetectedChinese === true;
      } catch { /* No current lyric document. */ }
      return { uri, positionMs: SpotifyPlayer.GetPosition(), playing: SpotifyPlayer.IsPlaying,
        eligible: chinese && /^spotify:track:[A-Za-z0-9]{22}$/.test(uri) };
    },
    cached: hasChineseAudioDecision,
    capture: async (uri, signal) => {
      $chineseAudioStatus.set("listening");
      try {
        let lyrics: any;
        try { lyrics = JSON.parse($currentLyricsData.get() || "null"); } catch { /* Send LID-only. */ }
        const lines = lyrics?.uri === uri ? chineseAudioLyricLines(lyrics) : [];
        const encoder = new TextEncoder();
        const payload = () => JSON.stringify({ uri, revision: CHINESE_AUDIO_REVISION, lines });
        // The helper accepts at most 128 KB; a very long document must not make every window fail.
        let body = payload();
        while (lines.length && encoder.encode(body).length > 126 * 1024) {
          lines.pop();
          body = payload();
        }
        const response = await fetch(CHINESE_AUDIO_ENDPOINT, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body,
        });
        if (!response.ok) throw new Error(`Audio detection unavailable (${response.status})`);
        const result = await response.json();
        if (result.uri !== uri || result.revision !== CHINESE_AUDIO_REVISION) throw new Error("Mismatched audio window");
        const window: ChineseAudioWindow = { logOdds: finite(result.logOdds), phoneFit: finite(result.phoneFit) };
        if (window.logOdds === null && window.phoneFit === null) $chineseAudioStatus.set("waiting");
        return window;
      } catch (error) {
        if (!signal.aborted) $chineseAudioStatus.set("unavailable");
        throw error;
      }
    },
    save: (uri, decision) => {
      saveChineseAudioDecision(uri, decision);
      const logOdds = decision.windows.map((window) => window.logOdds).filter((value): value is number => value !== null);
      const fits = decision.windows.map((window) => window.phoneFit).filter((value): value is number => value !== null);
      recordChineseAudio(uri, {
        audioLid: logOdds.length ? mean(logOdds) : undefined,
        audioFit: fits.length ? mean(fits) : undefined,
        audioLanguage: decision.language,
      }, $chineseTranslitMode.get());
    },
  });
  const timer = setInterval(() => detector.tick(), 1000);
  const unsubscribe = $chineseTranslitMode.listen(() => {
    detector.stop();
    $chineseAudioStatus.set(hasChineseAudioDecision(lastUri) ? "detected" : "waiting");
  });
  stopDetection = () => { clearInterval(timer); unsubscribe(); detector.stop(); stopDetection = undefined; };
  window.addEventListener("pagehide", () => stopDetection?.(), { once: true });
}
