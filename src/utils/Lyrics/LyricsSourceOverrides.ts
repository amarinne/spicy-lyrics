import { isLyricsSourceProviderId, type LyricsSourceProviderId, type TrackSourceOverride } from "./LyricsSourcePreferences.ts";

export type LyricsSourceOverrideMap = Record<string, LyricsSourceProviderId>;

const MAX_TRACK_OVERRIDES = 200;

export function parseLyricsSourceOverrides(value: unknown): LyricsSourceOverrideMap {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const entries = Object.entries(parsed as Record<string, unknown>)
    .filter(([uri, provider]) => uri.startsWith("spotify:track:") && isLyricsSourceProviderId(provider))
    .slice(-MAX_TRACK_OVERRIDES);
  return Object.fromEntries(entries);
}

export function getTrackSourceOverride(value: unknown, trackUri: string): TrackSourceOverride {
  return parseLyricsSourceOverrides(value)[trackUri] ?? "auto";
}

export function setTrackSourceOverride(
  value: unknown,
  trackUri: string,
  override: TrackSourceOverride,
): LyricsSourceOverrideMap {
  const current = parseLyricsSourceOverrides(value);
  delete current[trackUri];
  if (override !== "auto" && trackUri.startsWith("spotify:track:")) current[trackUri] = override;
  return Object.fromEntries(Object.entries(current).slice(-MAX_TRACK_OVERRIDES));
}

export function serializeLyricsSourceOverrides(value: LyricsSourceOverrideMap): string {
  return JSON.stringify(value);
}
