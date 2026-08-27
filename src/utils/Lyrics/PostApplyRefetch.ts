/**
 * Pure decision helper for the post-apply safety guard in `src/app.tsx`.
 *
 * After lyrics have been applied, the delayed `lyrics:apply` guard checks
 * whether the saved/applied lyric state still describes the track that is
 * currently playing. This module owns that decision so it never throws on
 * malformed saved state and can be reasoned about in isolation.
 *
 * Race ownership stays with `LyricsRequestCoordinator`: this helper only
 * decides *whether* a refetch should be kicked off — it never issues a fetch
 * and never tracks in-flight requests itself.
 */

/** Sentinel stored by the applyer when a track has no lyrics: `NO_LYRICS:<uri>`. */
const NO_LYRICS_PREFIX = "NO_LYRICS:";

/**
 * Decides whether the post-apply lyric state needs a refetch for the track
 * that is currently playing. Pure: it never throws and never touches globals.
 *
 * - Returns `false` when the current player URI is empty (nothing to compare
 *   against, so no refetch can be scoped to a track).
 * - Returns `false` for empty/null saved state (nothing was applied).
 * - Parses the `NO_LYRICS:<uri>` sentinel by slicing the prefix — the Spotify
 *   URI itself contains colons, so it must not be split on ":".
 * - Parses valid JSON and compares its `uri` field against the current URI.
 * - Treats malformed JSON as stale (it cannot describe the current track), so
 *   the guard recovers with a single refetch instead of throwing.
 *
 * A refetch is requested only when the saved/applied URI differs from the
 * current player URI, so a matching state can never trigger a fetch and no
 * duplicate fetch loop is possible.
 */
export function shouldRefetchAfterApply(
  savedState: string | null | undefined,
  currentUri: string | null | undefined
): boolean {
  if (!currentUri) return false;
  if (!savedState) return false;

  if (savedState.startsWith(NO_LYRICS_PREFIX)) {
    // The sentinel format is `NO_LYRICS:<uri>`. The uri itself contains colons,
    // so strip the prefix rather than splitting on ":".
    return savedState.slice(NO_LYRICS_PREFIX.length) !== currentUri;
  }

  try {
    const parsedState = JSON.parse(savedState);
    return parsedState?.uri !== currentUri;
  } catch {
    // Malformed saved state can't be matched to any track. Treat it as stale
    // so the guard recovers with a single refetch instead of throwing.
    return true;
  }
}
