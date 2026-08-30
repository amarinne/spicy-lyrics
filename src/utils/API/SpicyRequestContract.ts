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
