/**
 * Display labels for the lyrics source recorded on a document.
 *
 * The fork fetches from the Spicy Lyrics service only, like upstream. A document
 * still carries the `source` code the service assigned (`spl`, `aml`, `spt`,
 * `ldb`), and the credits footer renders it, so the code-to-label mapping stays
 * here even though nothing selects between providers any more.
 */
const SOURCE_LABELS: Record<string, string> = {
  spl: "Spicy Lyrics",
  aml: "Apple Music",
  spt: "Spotify",
  ldb: "Local",
};

export function resolveLyricsSourceLabel(
  source?: string,
  displayName?: string,
  fetchProvider?: string,
): string | null {
  if (displayName?.trim()) return displayName.trim();
  return (source && SOURCE_LABELS[source])
    || (fetchProvider && SOURCE_LABELS[fetchProvider])
    || source?.trim()
    || fetchProvider?.trim()
    || null;
}