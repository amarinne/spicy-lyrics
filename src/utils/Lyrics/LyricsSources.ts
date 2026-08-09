import Defaults from "../../components/Global/Defaults.ts";
import Platform from "../../components/Global/Platform.ts";
import Session from "../../components/Global/Session.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import { $lyricsSelectionDiagnostics } from "../stores.ts";
import Logger from "../Logger.ts";
import { SLObjPack } from "../objpack.ts";
import { acquireLyricsFromSources, canQueryLrclib, normalizeLrclibLyrics, normalizeSpicyLyrics, normalizeSpotifyLyrics, type LyricsSourceAdapter, type LyricsSourceResult, type TrackLyricsInfo } from "./LyricsSourceDocuments.ts";
import { ProviderResponseError, type ProviderAcquisitionOutcome } from "./ProviderAcquisition.ts";
import type { LyricsSelectionMode, LyricsSourceProviderId } from "./LyricsSourcePreferences.ts";

export { acquireLyricsFromSources, canQueryLrclib, normalizeLrclibLyrics, normalizeSpicyLyrics, normalizeSpotifyLyrics } from "./LyricsSourceDocuments.ts";
export type { LyricsSourceAdapter, LyricsSourceResult, TrackLyricsInfo } from "./LyricsSourceDocuments.ts";

const sourceLogger = new Logger("Lyrics Sources");
const packer = new SLObjPack();

function currentTrackInfo(uri: string): TrackLyricsInfo | null {
  if (SpotifyPlayer.GetUri() !== uri) return null;
  const id = uri.split(":")[2] ?? "";
  const title = SpotifyPlayer.GetName() ?? "";
  const artists = SpotifyPlayer.GetArtists()?.map((artist) => artist.name).filter(Boolean) ?? [];
  const durationMs = SpotifyPlayer.GetDuration();
  if (!id) return null;
  return { uri, id, title, artists, album: SpotifyPlayer.GetAlbumName() ?? "", durationMs };
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function spicyAdapter(info: TrackLyricsInfo, signal: AbortSignal): Promise<ProviderAcquisitionOutcome<LyricsSourceResult>> {
  const token = await Platform.GetSpotifyAccessToken();
  if (signal.aborted) return { kind: "aborted" };
  const version = Session.SpicyLyrics.GetCurrentVersion()?.Text ?? "unknown";
  const response = await fetch(`${Defaults.lyrics.api.url}/query`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "SpicyLyrics-Version": version, "SpicyLyrics-WebAuth": `Bearer ${token}` },
    body: JSON.stringify({ queries: [{ operation: "lyrics", variables: { id: info.id, auth: "SpicyLyrics-WebAuth" } }], client: { version } }),
  });
  if (response.status === 429) throw new ProviderResponseError({ kind: "rate-limited", retryAfterMs: retryAfterMs(response) });
  if (!response.ok) throw new ProviderResponseError({ kind: "upstream-error", status: response.status });
  const result = (await response.json())?.queries?.[0]?.result;
  const status = Number(result?.httpStatus ?? 0);
  if (status === 503) return { kind: "queued" };
  if (status === 404 || status === 204) return { kind: "no-match" };
  if (status === 429) return { kind: "rate-limited" };
  if (status !== 200) return { kind: "upstream-error", status };
  const normalized = normalizeSpicyLyrics(Array.isArray(result?.data) ? packer.unpack(result.data) : result?.data);
  return normalized ? { kind: "lyrics", result: normalized } : { kind: "no-match" };
}

async function spotifyAdapter(info: TrackLyricsInfo, signal: AbortSignal): Promise<ProviderAcquisitionOutcome<LyricsSourceResult>> {
  if (signal.aborted) return { kind: "aborted" };
  const body = await Spicetify.CosmosAsync.get(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${encodeURIComponent(info.id)}?format=json&vocalRemoval=false&market=from_token`);
  if (signal.aborted) return { kind: "aborted" };
  const normalized = normalizeSpotifyLyrics(body, info);
  return normalized ? { kind: "lyrics", result: normalized } : { kind: "no-match" };
}

async function lrclibAdapter(info: TrackLyricsInfo, signal: AbortSignal): Promise<ProviderAcquisitionOutcome<LyricsSourceResult>> {
  if (!canQueryLrclib(info)) return { kind: "no-match" };
  const query = new URLSearchParams({ track_name: info.title, artist_name: info.artists.join(", "), album_name: info.album, duration: String(info.durationMs / 1000) });
  const response = await fetch(`https://lrclib.net/api/get?${query}`, { signal, headers: { "x-user-agent": "Spicy Lyrics" } });
  if (response.status === 404 || response.status === 204) return { kind: "no-match" };
  if (response.status === 429) throw new ProviderResponseError({ kind: "rate-limited", retryAfterMs: retryAfterMs(response) });
  if (response.status >= 500) throw new ProviderResponseError({ kind: "upstream-error", status: response.status });
  if (!response.ok) return { kind: "no-match" };
  const normalized = normalizeLrclibLyrics(await response.json(), info);
  return normalized ? { kind: "lyrics", result: normalized } : { kind: "no-match" };
}

export const RUNTIME_LYRICS_SOURCE_ADAPTERS: Record<LyricsSourceProviderId, LyricsSourceAdapter> = { spicy: spicyAdapter, spotify: spotifyAdapter, lrclib: lrclibAdapter };

export async function fetchLyricsFromSources(uri: string, order: readonly LyricsSourceProviderId[], mode: LyricsSelectionMode, signal?: AbortSignal): Promise<LyricsSourceResult> {
  const info = currentTrackInfo(uri);
  if (!info) return { lyrics: null, status: 404 };
  const result = await acquireLyricsFromSources(info, order, mode, RUNTIME_LYRICS_SOURCE_ADAPTERS, signal);
  if (result.lyrics?.SelectionDiagnostics) $lyricsSelectionDiagnostics.set(result.lyrics.SelectionDiagnostics);
  if (!result.lyrics) sourceLogger.debug("No lyrics source selected", { status: result.status, mode, providers: order });
  return result;
}
