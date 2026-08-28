export function isLyricsSourceCacheCompatible(lyrics: unknown, currentSignature: string): boolean {
  if (!lyrics || typeof lyrics !== "object") return false;
  const entry = lyrics as Record<string, unknown>;
  if (entry.source === "ldb") return true;
  return typeof entry.fetchProvider === "string" && entry.LyricsSourceCacheSignature === currentSignature;
}
