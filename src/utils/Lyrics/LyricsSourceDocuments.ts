import { parseLrcDocument } from "./LrcParser.ts";
import { selectLyricsCandidate, type LyricsCandidate, type LyricsMatchMetadata } from "./LyricsCandidateSelector.ts";
import { acquireProviderOutcomes, runProviderAcquisition, type ProviderAcquisitionOutcome } from "./ProviderAcquisition.ts";
import { resolveLyricsSourceLabel, type LyricsSelectionMode, type LyricsSourceProviderId } from "./LyricsSourcePreferences.ts";

export type TrackLyricsInfo = { uri: string; id: string; title: string; artists: string[]; album: string; durationMs: number };
export type LyricsSourceResult = { lyrics: any | null; status: number; match?: LyricsMatchMetadata; provider?: LyricsSourceProviderId };
export type LyricsSourceAdapter = (info: TrackLyricsInfo, signal: AbortSignal) => Promise<ProviderAcquisitionOutcome<LyricsSourceResult>>;

export function canQueryLrclib(info: TrackLyricsInfo): boolean {
  return !!info.title && info.artists.length > 0 && info.durationMs > 0;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\r/g, "").replace(/[\t ]+/g, " ").trim();
}

function metadataKey(value: unknown): string {
  return clean(value).normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function metadataSimilarity(left: unknown, right: unknown): number {
  const a = metadataKey(left);
  const b = metadataKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return 0.9;
  const grams = (value: string) => {
    const result = new Map<string, number>();
    const points = Array.from(value);
    for (let index = 0; index < Math.max(1, points.length - 1); index++) {
      const gram = points.slice(index, index + 2).join("");
      result.set(gram, (result.get(gram) ?? 0) + 1);
    }
    return result;
  };
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  let leftCount = 0;
  let rightCount = 0;
  let overlap = 0;
  for (const count of leftGrams.values()) leftCount += count;
  for (const count of rightGrams.values()) rightCount += count;
  for (const [gram, count] of leftGrams) overlap += Math.min(count, rightGrams.get(gram) ?? 0);
  return leftCount + rightCount ? (2 * overlap) / (leftCount + rightCount) : 0;
}

function stamp(lyrics: any, provider: LyricsSourceProviderId, label?: string, match?: LyricsMatchMetadata): LyricsSourceResult | null {
  if (!lyrics || !["Static", "Line", "Syllable"].includes(lyrics.Type)) return null;
  const sourceMatch = match ?? lyrics.SourceMatch ?? (provider === "lrclib" ? undefined : { confidence: 1, method: "spotify-id" });
  return { status: 200, provider, match: sourceMatch, lyrics: { ...lyrics, SourceMatch: sourceMatch, fetchProvider: provider, sourceDisplayName: resolveLyricsSourceLabel(lyrics.source, label ?? lyrics.sourceDisplayName, provider) } };
}

function staticDocument(lines: unknown[], source: string, label: string): any | null {
  const Lines = lines.map(clean).filter(Boolean).map((Text) => ({ Text }));
  return Lines.length ? { Type: "Static", Lines, source, sourceDisplayName: label } : null;
}

function lineDocument(rows: ReadonlyArray<{ text: unknown; startTimeMs: unknown; endTimeMs?: unknown }>, durationMs: number, source: string, label: string): any | null {
  const prepared = rows.flatMap((row) => {
    const text = clean(row.text);
    const startTimeMs = Number(row.startTimeMs);
    const endTimeMs = row.endTimeMs === undefined ? undefined : Number(row.endTimeMs);
    return text && Number.isFinite(startTimeMs) ? [{ text, startTimeMs, endTimeMs }] : [];
  }).sort((left, right) => left.startTimeMs - right.startTimeMs);
  if (!prepared.length) return null;
  const durationSeconds = Math.max(0, durationMs / 1000);
  const Content = prepared.map((row, index) => {
    const start = Math.max(0, row.startTimeMs / 1000);
    const nextStart = prepared[index + 1]?.startTimeMs;
    const inferredEnd = nextStart === undefined ? Math.max(durationSeconds, start + 4) : nextStart / 1000;
    const suppliedEnd = Number.isFinite(row.endTimeMs) ? Number(row.endTimeMs) / 1000 : inferredEnd;
    return { Type: "Vocal", Text: row.text, StartTime: start, EndTime: Math.max(start, suppliedEnd), OppositeAligned: false };
  });
  return { Type: "Line", StartTime: Content[0].StartTime, EndTime: Content.at(-1)?.EndTime, Content, source, sourceDisplayName: label };
}

export function normalizeSpicyLyrics(data: any): LyricsSourceResult | null {
  const source = typeof data?.source === "string" ? data.source : "spl";
  const label = source === "aml" ? "Apple Music" : resolveLyricsSourceLabel(source) ?? "Spicy Lyrics";
  return stamp(data, "spicy", label);
}

export function normalizeSpotifyLyrics(body: any, info: TrackLyricsInfo): LyricsSourceResult | null {
  const data = body?.lyrics ?? body;
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const document = data?.syncType === "LINE_SYNCED"
    ? lineDocument(lines.map((line: any) => ({ text: line?.words, startTimeMs: line?.startTimeMs })), info.durationMs, "spt", "Spotify")
    : staticDocument(lines.map((line: any) => line?.words), "spt", "Spotify");
  return stamp(document, "spotify", "Spotify", { confidence: 1, method: "spotify-id" });
}

export function normalizeLrclibLyrics(body: any, info: TrackLyricsInfo): LyricsSourceResult | null {
  const duration = Number(body?.duration);
  const returnedTitle = clean(body?.trackName);
  const returnedArtist = clean(body?.artistName);
  const titleScore = returnedTitle ? metadataSimilarity(info.title, returnedTitle) : 0;
  const artistScore = returnedArtist
    ? Math.max(metadataSimilarity(info.artists.join(" "), returnedArtist), ...info.artists.map((artist) => metadataSimilarity(artist, returnedArtist)))
    : 0;
  const durationDelta = Number.isFinite(duration) && duration > 0 && info.durationMs > 0
    ? Math.abs(duration * 1000 - info.durationMs)
    : Number.POSITIVE_INFINITY;
  const durationScore = durationDelta <= 2_000 ? 1 : durationDelta <= 5_000 ? 0.9 : durationDelta <= 10_000 ? 0.65 : durationDelta <= 20_000 ? 0.3 : 0;
  if (titleScore < 0.55 || artistScore < 0.5 || durationScore < 0.3) return null;
  const albumScore = body?.albumName && info.album ? metadataSimilarity(info.album, body.albumName) : 0.7;
  const confidence = titleScore * 0.45 + artistScore * 0.35 + durationScore * 0.15 + albumScore * 0.05;
  const match: LyricsMatchMetadata = {
    title: returnedTitle || info.title,
    artists: returnedArtist ? [returnedArtist] : info.artists,
    album: clean(body?.albumName) || info.album,
    durationMs: Number.isFinite(duration) && duration > 0 ? duration * 1000 : undefined,
    confidence,
    method: "metadata-query",
  };
  if (body?.instrumental === true) return stamp(staticDocument(["♪ Instrumental ♪"], "lrclib", "LRCLIB"), "lrclib", "LRCLIB", match);
  if (typeof body?.syncedLyrics === "string") {
    const parsed = parseLrcDocument(body.syncedLyrics);
    if (parsed.synced.length) return stamp(lineDocument(parsed.synced, info.durationMs, "lrclib", "LRCLIB"), "lrclib", "LRCLIB", match);
  }
  return typeof body?.plainLyrics === "string"
    ? stamp(staticDocument(body.plainLyrics.split(/\r?\n/u), "lrclib", "LRCLIB"), "lrclib", "LRCLIB", match)
    : null;
}

export async function acquireLyricsFromSources(
  info: TrackLyricsInfo,
  order: readonly LyricsSourceProviderId[],
  mode: LyricsSelectionMode,
  adapters: Record<LyricsSourceProviderId, LyricsSourceAdapter>,
  parentSignal?: AbortSignal,
): Promise<LyricsSourceResult> {
  const records = await acquireProviderOutcomes(order, mode === "strict" ? "sequential" : "concurrent", (provider) => runProviderAcquisition((signal) => adapters[provider](info, signal), parentSignal));
  const entries = records.flatMap(({ provider, orderIndex, outcome }) => outcome.kind === "lyrics"
    ? [{ result: outcome.result, candidate: { provider, orderIndex, lyrics: outcome.result.lyrics, match: outcome.result.match } satisfies LyricsCandidate }]
    : []);
  if (entries.length) {
    const selection = selectLyricsCandidate(entries.map((entry) => entry.candidate), info.durationMs, mode);
    const selected = entries.find((entry) => entry.candidate === selection.candidate);
    if (selected) {
      selected.result.lyrics.SelectionDiagnostics = selection.diagnostics;
      return selected.result;
    }
  }
  if (records.some(({ outcome }) => outcome.kind === "queued")) return { lyrics: null, status: 503 };
  if (records.some(({ outcome }) => outcome.kind === "rate-limited")) return { lyrics: null, status: 429 };
  const upstream = records.find(({ outcome }) => outcome.kind === "upstream-error");
  if (upstream?.outcome.kind === "upstream-error") return { lyrics: null, status: upstream.outcome.status };
  return { lyrics: null, status: 404 };
}
