export const LYRICS_SOURCE_PROVIDER_IDS = ["spicy", "spotify", "lrclib"] as const;

export type LyricsSourceProviderId = (typeof LYRICS_SOURCE_PROVIDER_IDS)[number];
export type LyricsSelectionMode = "smart" | "syncType" | "strict";
export type TrackSourceOverride = "auto" | LyricsSourceProviderId;

export const DEFAULT_LYRICS_SOURCE_ORDER: LyricsSourceProviderId[] = [
  "spicy",
  "spotify",
  "lrclib",
];

const SOURCE_LABELS: Record<string, string> = {
  spl: "Spicy Lyrics",
  aml: "Apple Music",
  spt: "Spotify",
  ldb: "Local",
  spicy: "Spicy Lyrics",
  spotify: "Spotify",
  lrclib: "LRCLIB",
};

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function isLyricsSourceProviderId(value: unknown): value is LyricsSourceProviderId {
  return typeof value === "string" && (LYRICS_SOURCE_PROVIDER_IDS as readonly string[]).includes(value);
}

export function normalizeLyricsSourceOrder(value: unknown): LyricsSourceProviderId[] {
  const normalized = stringArray(value).filter(isLyricsSourceProviderId);
  const result = [...new Set(normalized)];
  for (const provider of DEFAULT_LYRICS_SOURCE_ORDER) {
    if (!result.includes(provider)) result.push(provider);
  }
  return result;
}

export function normalizeLyricsSelectionMode(value: unknown): LyricsSelectionMode {
  return value === "syncType" || value === "strict" ? value : "smart";
}

export function effectiveLyricsSourceConfig(
  orderValue: unknown,
  modeValue: unknown,
  override: TrackSourceOverride,
): { order: LyricsSourceProviderId[]; mode: LyricsSelectionMode; override: TrackSourceOverride } {
  if (override !== "auto") return { order: [override], mode: "strict", override };
  return {
    order: normalizeLyricsSourceOrder(orderValue),
    mode: normalizeLyricsSelectionMode(modeValue),
    override,
  };
}

export function lyricsSourceCacheSignature(config: {
  order: readonly LyricsSourceProviderId[];
  mode: LyricsSelectionMode;
  override: TrackSourceOverride;
}): string {
  return JSON.stringify({ version: 1, order: [...config.order], mode: config.mode, override: config.override });
}

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
