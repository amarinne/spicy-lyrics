import Defaults from "../../components/Global/Defaults.ts";
import Session from "../../components/Global/Session.ts";
import storage from "../storage.ts";

export type Query = {
  operation: string;
  variables?: any;
};

export type QueryObjectResult = {
  data: any;
  httpStatus: number;
  format: "text" | "json";
};

export type QueryObject = {
  operation: string;
  operationId: string;
  result: QueryObjectResult;
};

export interface QueryResultGetter {
  get(operationId: string): QueryObjectResult | undefined;
}

const log = {
  info: (...args: unknown[]) => {
    if (storage.get("developerMode") === "true") {
      console.log("[Spicy Lyrics] [Query]", ...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (storage.get("developerMode") === "true") {
      console.warn("[Spicy Lyrics] [Query]", ...args);
    }
  },
  error: (...args: unknown[]) => {
    console.error("[Spicy Lyrics] [Query]", ...args);
  },
};

// Convert Spotify lyrics format to Spicy Lyrics format
function convertSpotifyLyrics(spotifyLyrics: any, trackId: string): any {
  if (!spotifyLyrics || !spotifyLyrics.lyrics || !spotifyLyrics.lyrics.lines) {
    return null;
  }

  const lines = spotifyLyrics.lyrics.lines;
  const hasTiming = lines.length > 0 && lines[0].startTimeMs !== undefined;
  
  if (hasTiming) {
    return {
      Type: "Line",
      id: trackId,
      alternative_api: true,
      Content: lines.map((line: any, index: number) => {
        const startTime = parseInt(line.startTimeMs) || 0;
        const endTime = index < lines.length - 1 
          ? parseInt(lines[index + 1].startTimeMs)
          : startTime + 5000;
        
        return {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            Syllables: [{
              Text: line.words,
              StartTime: startTime,
              EndTime: endTime,
              IsPartOfWord: false
            }],
            StartTime: startTime,
            EndTime: endTime
          }
        };
      })
    };
  } else {
    return {
      Type: "Static",
      id: trackId,
      alternative_api: true,
      Lines: lines.map((line: any) => ({
        Text: line.words
      }))
    };
  }
}

// Fetch from Spotify's native API
async function fetchFromSpotify(trackId: string, authToken: string): Promise<QueryObjectResult> {
  log.info("Trying Spotify native API for track:", trackId);
  
  const response = await fetch(
    `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`,
    {
      headers: {
        "Authorization": authToken,
        "Accept": "application/json"
      }
    }
  );
  
  if (response.status === 404) {
    return { data: null, httpStatus: 404, format: "json" };
  }
  
  if (!response.ok) {
    throw new Error(`Spotify API error: ${response.status}`);
  }
  
  const spotifyData = await response.json();
  const converted = convertSpotifyLyrics(spotifyData, trackId);
  
  if (!converted) {
    return { data: null, httpStatus: 404, format: "json" };
  }
  
  log.info("Successfully fetched from Spotify API");
  return { data: converted, httpStatus: 200, format: "json" };
}

export async function Query(
  queries: Query[],
  headers: Record<string, string> = {}
): Promise<QueryResultGetter> {
  const host = Defaults.lyrics.api.url;
  const clientVersion = Session.SpicyLyrics.GetCurrentVersion();
  const results: Map<string, QueryObjectResult> = new Map();

  log.info("Sending Query request", { queries, host, clientVersion: clientVersion?.Text, headers });

  // Try custom API first
  try {
    const res = await fetch(`${host}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "SpicyLyrics-Version": clientVersion?.Text ?? "",
        ...headers,
      },
      body: JSON.stringify({
        queries,
        client: {
          version: clientVersion?.Text ?? "unknown",
        },
      }),
    });

    log.info("Received response from custom API", { status: res.status });

    if (res.ok) {
      const data = await res.json();
      log.info("Response data", data);

      // Check if we got valid lyrics data
      const lyricsResult = data.queries?.find((q: any) => q.operation === "lyrics")?.result;
      
      if (lyricsResult && lyricsResult.httpStatus === 200 && lyricsResult.data) {
        // Custom API has lyrics, use it
        console.log("%c[Lyrics Source] Using Custom API (api.spicylyrics.org)", "color: #1DB954; font-weight: bold; font-size: 14px;");
        for (const job of data.queries) {
          results.set(job.operationId, job.result);
          log.info("Query result set", { operationId: job.operationId, result: job.result });
        }
        return {
          get(operationId: string): QueryObjectResult | undefined {
            return results.get(operationId);
          },
        };
      } else {
        // Custom API returned empty/404, will try Spotify below
        log.warn("Custom API returned no lyrics, will try Spotify");
      }
    }
  } catch (error) {
    log.warn("Custom API failed, trying Spotify API:", error);
  }

  // Try Spotify API for lyrics queries
  const lyricsQuery = queries.find(q => q.operation === "lyrics");
  if (lyricsQuery?.variables?.id) {
    try {
      const trackId = lyricsQuery.variables.id;
      const authToken = headers["SpicyLyrics-WebAuth"] || "";
      const result = await fetchFromSpotify(trackId, authToken);
      if (result.httpStatus === 200 && result.data) {
        console.log("%c[Lyrics Source] Using Spotify Native API (color-lyrics)", "color: #1DB954; font-weight: bold; font-size: 14px;");
      }
      results.set("0", result);
      
      return {
        get(operationId: string): QueryObjectResult | undefined {
          return results.get(operationId);
        },
      };
    } catch (spotifyError) {
      log.error("Spotify API also failed:", spotifyError);
    }
  }

  // Return empty results if both failed
  return {
    get(operationId: string): QueryObjectResult | undefined {
      log.warn("No results available for operationId:", operationId);
      return undefined;
    },
  };
}
