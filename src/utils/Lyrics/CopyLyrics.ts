import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import { $currentLyricsData } from "../stores.ts";
import { $lyricsCopyFormat } from "../uiState.ts";
import { isMeaningfullyDifferent } from "./TextCompare.ts";

export type LyricsCopyFormat = "plain" | "timestamps" | "translation" | "metadata";

type CopyLine = {
  text: string;
  startTime?: number;
  translatedText?: string;
};

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const joinSyllables = (syllables: any[] | undefined): string => {
  if (!Array.isArray(syllables)) return "";
  let out = "";
  let previousWasWordEnd = false;

  for (const syllable of syllables) {
    const text = cleanText(syllable?.Text);
    if (!text) continue;

    if ((previousWasWordEnd || syllable?.RomajiSpaceBefore) && out && !out.endsWith(" ")) {
      out += " ";
    }

    out += text;
    previousWasWordEnd = syllable?.IsPartOfWord === false;
  }

  return out.trim();
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
      }))
      .filter((line: CopyLine) => line.text);
  }

  if (lyrics.Type === "Line") {
    return (lyrics.Content ?? [])
      .map((line: any) => ({
        text: cleanText(line?.Text),
        startTime: line?.StartTime,
        translatedText: cleanText(line?.TranslatedText),
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
        });
      }
      for (const bg of group?.Background ?? []) {
        const bgText = joinSyllables(bg?.Syllables);
        if (bgText) {
          out.push({
            text: bgText,
            startTime: bg?.StartTime,
            translatedText: cleanText(bg?.TranslatedText),
          });
        }
      }
    }
    return out;
  }

  return [];
}

function currentMetadata(): string {
  const title = cleanText(SpotifyPlayer.GetName());
  const artists = (SpotifyPlayer.GetArtists() ?? [])
    .map((artist) => cleanText(artist?.name))
    .filter(Boolean)
    .join(", ");

  if (title && artists) return `${artists} - ${title}`;
  return title || artists;
}

export function formatLyricsForCopy(lyrics: any, format: LyricsCopyFormat): string {
  const lines = linesFromLyrics(lyrics);
  const body = lines
    .map((line) => {
      const prefix = format === "timestamps" && typeof line.startTime === "number"
        ? `[${formatTime(line.startTime)}] `
        : "";
      const base = `${prefix}${line.text}`;
      if (format !== "translation") return base;
      if (!isMeaningfullyDifferent(line.translatedText, line.text)) return base;
      return `${base}\n${line.translatedText}`;
    })
    .join("\n");

  if (format !== "metadata") return body;
  const metadata = currentMetadata();
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

  const text = formatLyricsForCopy(lyrics, $lyricsCopyFormat.get());
  if (!text.trim()) return false;

  await navigator.clipboard.writeText(text);
  return true;
}
