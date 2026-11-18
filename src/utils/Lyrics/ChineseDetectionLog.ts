import type { ChineseLanguage } from "./ChineseTranslitMode.ts";

/**
 * Owner-facing record of every Chinese language decision, so a wrong reading can be reported with
 * the evidence that produced it. Bounded ring buffer; no audio, transcript or lyric text is stored.
 */
export const CHINESE_DETECTION_LOG_KEY = "spicy-chinese-detect-log";
const LOG_LIMIT = 300;

export type ChineseDetectionLogEntry = {
  uri: string;
  title: string;
  artist: string;
  time: string;
  mode: string;
  lines: number;
  z: number;
  toneExcess: number;
  markers: number;
  p: number;
  textLanguage?: ChineseLanguage;
  /** Mean Qwen first-token log-odds once audio evidence exists; positive leans Cantonese. */
  audioLid?: number;
  /** Mean ZIPA phone fit once audio evidence exists; positive leans Cantonese. */
  audioFit?: number;
  audioLanguage?: ChineseLanguage;
};

function trackLabel(): { title: string; artist: string } {
  try {
    const item = (globalThis as any).Spicetify?.Player?.data?.item;
    return {
      title: String(item?.name ?? ""),
      artist: Array.isArray(item?.artists) ? item.artists.map((artist: any) => artist?.name).filter(Boolean).join(", ") : "",
    };
  } catch {
    return { title: "", artist: "" };
  }
}

function readLog(): ChineseDetectionLogEntry[] {
  try {
    const raw = (globalThis as any).Spicetify?.LocalStorage?.get(CHINESE_DETECTION_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLog(entries: ChineseDetectionLogEntry[], entry: ChineseDetectionLogEntry): void {
  try {
    (globalThis as any).Spicetify?.LocalStorage?.set(CHINESE_DETECTION_LOG_KEY, JSON.stringify(entries));
  } catch {
    /* Storage unavailable; the console line still carries the decision. */
  }
  console.info(`[spicy-lyrics] chinese-detect ${JSON.stringify(entry)}`);
}

export function recordChineseDetection(entry: Omit<ChineseDetectionLogEntry, "title" | "artist" | "time">): void {
  const log = readLog();
  const record = { ...trackLabel(), ...entry, time: new Date().toISOString() };
  writeLog([...log, record].slice(-LOG_LIMIT), record);
}

/** Attach audio evidence to the newest text decision for the same track. */
export function recordChineseAudio(uri: string, audio: Pick<ChineseDetectionLogEntry, "audioLid" | "audioFit" | "audioLanguage">, mode = "auto"): void {
  const log = readLog();
  for (let index = log.length - 1; index >= 0; index--) {
    if (log[index].uri !== uri) continue;
    const record = { ...log[index], ...audio };
    log[index] = record;
    writeLog(log, record);
    if (record.textLanguage && record.audioLanguage && record.textLanguage !== record.audioLanguage) {
      console.info(`[spicy-lyrics] chinese-detect-disagreement ${JSON.stringify({
        uri, textLanguage: record.textLanguage, audioLanguage: record.audioLanguage,
        p: record.p, audioLid: record.audioLid, audioFit: record.audioFit,
      })}`);
    }
    return;
  }
  // A cached processed document can skip text detection; keep the audio decision reportable anyway.
  const record: ChineseDetectionLogEntry = {
    uri, ...trackLabel(), time: new Date().toISOString(), mode,
    lines: 0, z: 0, toneExcess: 0, markers: 0, p: 0.5, ...audio,
  };
  writeLog([...log, record].slice(-LOG_LIMIT), record);
}
