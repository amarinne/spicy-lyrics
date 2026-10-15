import Platform from "../../components/Global/Platform.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import Logger from "../Logger.ts";
import { SLObjPack } from "../objpack.ts";
import { normalizeSpicyLyrics, type LyricsSourceResult, type TrackLyricsInfo } from "./LyricsSourceDocuments.ts";
import { ProviderResponseError, type ProviderAcquisitionOutcome } from "./ProviderAcquisition.ts";
import { acquireSpicyOutcomeWithBoundedAuthRetry, isSpicyAuthRejectionStatus, type SpicyQueryAttempt } from "./SpicyAuthRetry.ts";
import { Query, QueryHttpError, QueryNetworkError, type QueryObjectResult } from "../API/Query.ts";
import { ServiceUnavailableError } from "../API/CircuitBreaker.ts";

const sourceLogger = new Logger("Lyrics Sources");
const packer = new SLObjPack();

function currentTrackInfo(uri: string): TrackLyricsInfo | null {
  if (SpotifyPlayer.GetUri() !== uri) return null;
  const id = uri.split(":")[2] ?? "";
  if (!id) return null;
  return {
    uri,
    id,
    title: SpotifyPlayer.GetName() ?? "",
    artists: SpotifyPlayer.GetArtists()?.map((artist) => artist.name).filter(Boolean) ?? [],
    album: SpotifyPlayer.GetAlbumName() ?? "",
    durationMs: SpotifyPlayer.GetDuration(),
  };
}

/**
 * One lyrics query, sent the official way: through `Query()` so it rides the
 * shared circuit breaker and its 15s deadline. `probe: true` marks a
 * user-initiated fetch — the only caller allowed to set it, since the person
 * waiting may pass while the breaker is open and their request doubles as the
 * health check.
 *
 * A missing result entry (the server's policy-notice envelope) reads as
 * `lyrics-not-found`, exactly as official clients see it.
 */
async function requestSpicyLyrics(info: TrackLyricsInfo, token: string): Promise<SpicyQueryAttempt<ProviderAcquisitionOutcome<LyricsSourceResult>>> {
  let result: QueryObjectResult | undefined;
  try {
    const queries = await Query(
      [
        {
          operation: "lyrics",
          variables: {
            id: info.id,
            auth: "SpicyLyrics-WebAuth",
          },
        },
      ],
      {
        "SpicyLyrics-WebAuth": `Bearer ${token}`,
      },
      { probe: true }
    );
    result = queries.get("0");
  } catch (error) {
    // Breaker suppression stays raw so a suppressed auth retry can preserve
    // its 401; the adapter maps it to a rate-limited outcome at the boundary.
    if (error instanceof ServiceUnavailableError) throw error;
    if (error instanceof QueryHttpError) {
      if (error.status === 429) throw new ProviderResponseError({ kind: "rate-limited", retryAfterMs: error.retryAfterMs });
      throw new ProviderResponseError({ kind: "upstream-error", status: error.status });
    }
    if (error instanceof QueryNetworkError) throw new ProviderResponseError({ kind: "upstream-error", status: 0 });
    throw error;
  }
  if (!result) return { kind: "settled", outcome: { kind: "no-match" } };
  const status = Number(result.httpStatus ?? 0);
  if (isSpicyAuthRejectionStatus(status)) return { kind: "auth-rejected", status };
  if (status === 503) return { kind: "settled", outcome: { kind: "queued" } };
  if (status === 404) return { kind: "settled", outcome: { kind: "no-match" } };
  if (status === 429) return { kind: "settled", outcome: { kind: "rate-limited" } };
  if (status !== 200) return { kind: "settled", outcome: { kind: "upstream-error", status } };
  const normalized = normalizeSpicyLyrics(Array.isArray(result.data) ? packer.unpack(result.data) : result.data);
  return { kind: "settled", outcome: normalized ? { kind: "lyrics", result: normalized } : { kind: "no-match" } };
}

/** The Spicy Lyrics service is the only source, with bounded auth retry. */
export async function fetchSpicyLyrics(info: TrackLyricsInfo, signal: AbortSignal): Promise<ProviderAcquisitionOutcome<LyricsSourceResult>> {
  if (signal.aborted) return { kind: "aborted" };
  try {
    return await acquireSpicyOutcomeWithBoundedAuthRetry<ProviderAcquisitionOutcome<LyricsSourceResult>>({
      signal,
      resolveToken: () => Platform.GetSpotifyAccessToken(),
      invalidateToken: (token) => Platform.InvalidateSpotifyAccessToken(token),
      runAttempt: (token) => requestSpicyLyrics(info, token),
    });
  } catch (error) {
    // The breaker is holding traffic back because the API is refusing us — a
    // temporary pause reported as a rate limit with its retry window, not a
    // fault in the pipeline.
    if (error instanceof ServiceUnavailableError) throw new ProviderResponseError({ kind: "rate-limited", retryAfterMs: error.retryAfterMs });
    throw error;
  }
}

/**
 * Fetch lyrics for the current track, or a 404-shaped result when the track
 * changed under us and its metadata is no longer safe to send.
 */
export async function fetchLyricsFromSpicy(uri: string, signal?: AbortSignal): Promise<LyricsSourceResult> {
  const info = currentTrackInfo(uri);
  if (!info) return { lyrics: null, status: 404 };
  const outcome = await fetchSpicyLyrics(info, signal ?? new AbortController().signal);
  if (outcome.kind === "lyrics") return outcome.result;
  if (outcome.kind === "queued") return { lyrics: null, status: 503 };
  if (outcome.kind === "rate-limited") return { lyrics: null, status: 429 };
  if (outcome.kind === "upstream-error") return { lyrics: null, status: outcome.status };
  sourceLogger.debug("No lyrics source selected", { outcome: outcome.kind });
  return { lyrics: null, status: outcome.kind === "timeout" || outcome.kind === "aborted" ? 0 : 404 };
}