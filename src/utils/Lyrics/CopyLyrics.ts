import { $currentLyricsData } from "../stores.ts";
import { $lyricsCopyFormat } from "../uiState.ts";
import { isMeaningfullyDifferent } from "./TextCompare.ts";
import { canonicalTextFromSyllables } from "./Processing/ProviderBoundary.ts";

export type LyricsCopyFormat = "plain" | "timestamps" | "translation" | "metadata" | "transliteration";

type CopyLine = {
  text: string;
  startTime?: number;
  translatedText?: string;
  transliteration?: string;
};

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const joinSyllables = (syllables: any[] | undefined): string => {
  if (!Array.isArray(syllables)) return "";
  return cleanText(canonicalTextFromSyllables(syllables).canonical.text);
};

/**
 * The transliteration output currently shown for a line: the render plan's
 * joined display text when a reading pipeline produced one, otherwise the
 * legacy romanized fields. Empty when the line was never romanized.
 */
const readingOf = (target: any): string => {
  if (!target || typeof target !== "object") return "";
  return cleanText(
    target?.ReadingRenderPlan?.joinedDisplayText
      ?? target?.RomanizedText
      ?? target?.TransliteratedText
  );
};

const formatTime = (seconds: unknown): string => {
  const value = typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  const secs = value - minutes * 60;
  return `${minutes.toString().padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
};

function linesFromLyrics(lyrics: any): CopyLine[] {
  if (!lyrics || typeof lyrics !== "object") return [];

  if (lyrics.Type === "Static") {
    return (lyrics.Lines ?? [])
      .map((line: any) => ({
        text: cleanText(line?.Text),
        translatedText: cleanText(line?.TranslatedText),
        transliteration: readingOf(line),
      }))
      .filter((line: CopyLine) => line.text);
  }

  if (lyrics.Type === "Line") {
    return (lyrics.Content ?? [])
      .map((line: any) => ({
        text: cleanText(line?.Text),
        startTime: line?.StartTime,
        translatedText: cleanText(line?.TranslatedText),
        transliteration: readingOf(line),
      }))
      .filter((line: CopyLine) => line.text);
  }

  if (lyrics.Type === "Syllable") {
    const out: CopyLine[] = [];
    for (const group of lyrics.Content ?? []) {
      const leadText = joinSyllables(group?.Lead?.Syllables);
      if (leadText) {
        out.push({
          text: leadText,
          startTime: group?.Lead?.StartTime,
          translatedText: cleanText(group?.Lead?.TranslatedText),
          transliteration: readingOf(group?.Lead),
        });
      }
      for (const bg of group?.Background ?? []) {
        const bgText = joinSyllables(bg?.Syllables);
        if (bgText) {
          out.push({
            text: bgText,
            startTime: bg?.StartTime,
            translatedText: cleanText(bg?.TranslatedText),
            transliteration: readingOf(bg),
          });
        }
      }
    }
    return out;
  }

  return [];
}

async function currentMetadata(): Promise<string> {
  // Lazy: the player graph has a module cycle that node ESM cannot evaluate
  // on import, and copy tests never need it. Loaded on demand in the app.
  const { SpotifyPlayer } = await import("../../components/Global/SpotifyPlayer.ts");
  const title = cleanText(SpotifyPlayer.GetName());
  const artists = (SpotifyPlayer.GetArtists() ?? [])
    .map((artist) => cleanText(artist?.name))
    .filter(Boolean)
    .join(", ");

  if (title && artists) return `${artists} - ${title}`;
  return title || artists;
}

export function formatLyricsForCopy(lyrics: any, format: LyricsCopyFormat, metadata = ""): string {
  const lines = linesFromLyrics(lyrics);
  const body = lines
    .map((line) => {
      const prefix = format === "timestamps" && typeof line.startTime === "number"
        ? `[${formatTime(line.startTime)}] `
        : "";
      const base = `${prefix}${line.text}`;
      if (format === "translation" && isMeaningfullyDifferent(line.translatedText, line.text)) {
        return `${base}\n${line.translatedText}`;
      }
      if (format === "transliteration" && isMeaningfullyDifferent(line.transliteration, line.text)) {
        return `${base}\n${line.transliteration}`;
      }
      return base;
    })
    .join("\n");

  if (format !== "metadata") return body;
  return metadata ? `${metadata}\n\n${body}` : body;
}

export async function copyCurrentLyricsToClipboard(): Promise<boolean> {
  const raw = $currentLyricsData.get();
  if (!raw || raw.startsWith("NO_LYRICS:")) return false;

  let lyrics: any;
  try {
    lyrics = JSON.parse(raw);
  } catch {
    return false;
  }

  const format = $lyricsCopyFormat.get();
  const metadata = format === "metadata" ? await currentMetadata() : "";
  const text = formatLyricsForCopy(lyrics, format, metadata);
  if (!text.trim()) return false;

  await navigator.clipboard.writeText(text);
  return true;
}
