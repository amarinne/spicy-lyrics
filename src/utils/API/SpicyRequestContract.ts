export const SPICY_API_MODE = "2";

/**
 * The exact wire headers every Spicy `/query` request carries, matching
 * official clients (6.3.15): JSON content, the client version, the API mode,
 * and any caller headers (e.g. `SpicyLyrics-WebAuth`) merged last so they can
 * override the defaults.
 */
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
