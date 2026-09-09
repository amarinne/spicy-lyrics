export const SPICY_API_MODE = "2";

export function buildSpicyLyricsQueryBody(trackId: string, version: string): string {
  return JSON.stringify({
    queries: [{ operation: "lyrics", variables: { id: trackId, auth: "SpicyLyrics-WebAuth" } }],
    client: { version },
  });
}

export function buildSpicyApiHeaders(
  version: string,
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "SpicyLyrics-Version": version,
    "X-mode": SPICY_API_MODE,
    ...extraHeaders,
  };
}

export function buildSpicyLyricsQueryHeaders(version: string, token: string): Record<string, string> {
  return buildSpicyApiHeaders(version, { "SpicyLyrics-WebAuth": `Bearer ${token}` });
}

/**
 * Pick the real query result out of a `/query` response envelope.
 *
 * The server can prepend entries that carry only an access-policy `_notice`
 * and no `result`, shifting the actual answer off index 0 (observed
 * 2026-09-09). Match on a present `result` instead of a fixed position.
 */
export function extractSpicyQueryResult(envelope: unknown): { data?: unknown; httpStatus?: number; format?: string } | undefined {
  if (!Array.isArray(envelope)) return undefined;
  for (const entry of envelope) {
    const result = (entry as { result?: unknown } | null)?.result;
    if (result && typeof result === "object") return result as { data?: unknown; httpStatus?: number; format?: string };
  }
  return undefined;
}
