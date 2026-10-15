import { resolveLyricsSourceLabel } from "./LyricsSourcePreferences.ts";

export type TrackLyricsInfo = { uri: string; id: string; title: string; artists: string[]; album: string; durationMs: number };
export type LyricsSourceResult = { lyrics: any | null; status: number; provider?: "spicy" };

function clean(value: unknown): string {
  return String(value ?? "").replace(/\r/g, "").replace(/[\t ]+/g, " ").trim();
}

function stamp(lyrics: any, label?: string): LyricsSourceResult | null {
  if (!lyrics || !["Static", "Line", "Syllable"].includes(lyrics.Type)) return null;
  const sourceMatch = lyrics.SourceMatch ?? { confidence: 1, method: "spotify-id" };
  return {
    status: 200,
    provider: "spicy",
    lyrics: { ...lyrics, SourceMatch: sourceMatch, fetchProvider: "spicy", sourceDisplayName: resolveLyricsSourceLabel(lyrics.source, label ?? lyrics.sourceDisplayName, "spicy") },
  };
}

/**
 * The Spicy Lyrics service returns the document already in the extension's own
 * shape, so normalization only assigns the source label and rejects the
 * forced-update notice payload.
 */
export function normalizeSpicyLyrics(data: any): LyricsSourceResult | null {
  if (isSpicyForcedUpdateControl(data)) return null;
  const source = typeof data?.source === "string" ? data.source : "spl";
  const label = source === "aml" ? "Apple Music" : resolveLyricsSourceLabel(source) ?? "Spicy Lyrics";
  return stamp(data, label);
}

export function isSpicyForcedUpdateControl(data: any): boolean {
  if (data?.Type !== "Static" || !Array.isArray(data?.Lines)) return false;
  let asksForUpdate = false;
  let asksForRestart = false;
  for (const line of data.Lines) {
    const text = clean(line?.Text).toLowerCase();
    if (text === "please update spicy lyrics") asksForUpdate = true;
    if (text.includes("immediately by restarting spotify")) asksForRestart = true;
  }
  return asksForUpdate && asksForRestart;
}