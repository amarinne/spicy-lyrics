import { isDev } from "../../components/Global/Defaults.ts";
import { $currentLyricsData, $currentLyricsType, $currentlyFetching } from "../stores.ts";
import Platform from "../../components/Global/Platform.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import PageView, { PageContainer } from "../../components/Pages/PageView.ts";
import { Query } from "../API/Query.ts";
import { ProcessLyrics } from "./ProcessLyrics.ts";
import { translationEnabled } from "./lyrics.ts";
import Logger from "../Logger.ts";
import { LocalLyricsManager } from "./manager/index.ts";
import { LyricsQueueRetry } from "./LyricsQueueRetry.ts";
import { GetExpireStore } from "../../modules/Store.ts";
import { SLObjPack } from "../objpack.ts";

const lyricsLogger = new Logger("Lyrics Pipeline");
const lyricsCacheLogger = new Logger("Lyrics Cache");
const lyricsPrefetchLogger = new Logger("Lyrics Prefetch");
const prefetchInFlight = new Set<string>();

// recently updated key structure - changed name
export const LyricsStore = GetExpireStore<any>("SpicyLyrics_LyricsStore_g1", 1, {
  Unit: "Days",
  Duration: 3,
}, isDev as true);

const lyricsPacker = new SLObjPack();

function setRomanizationClass(hasTransliterations: boolean | undefined): void {
  if (hasTransliterations) {
    PageContainer?.classList.add("Lyrics_RomanizationAvailable");
  } else {
    PageContainer?.classList.remove("Lyrics_RomanizationAvailable");
  }
}

/**
 * Shared "lyrics are ready" presentation: toggle the romanization class, hide the
 * loader, publish the type, reveal the containers and view controls, and clear the
 * fetching flag. Used by every successful return path.
 */
async function finishProcessingInBackground(trackId: string, lyrics: any): Promise<void> {
  try {
    await ProcessLyrics(lyrics, { updatePageClasses: false, awaitTranslation: true });
    lyrics.ProcessingPending = false;
    lyrics.RomanizationPending = false;
    lyrics.TranslationPending = false;
    await LyricsStore.SetItem(trackId, lyrics);
    if (SpotifyPlayer.GetId() === trackId) {
      $currentLyricsData.set(JSON.stringify(lyrics));
      window.dispatchEvent(
        new CustomEvent("spicy-lyrics:processing-ready", {
          detail: { trackId, lyrics },
        })
      );
    }
  } catch (error) {
    lyrics.ProcessingPending = false;
    lyrics.RomanizationPending = false;
    lyrics.TranslationPending = false;
    lyricsCacheLogger.error("Background lyrics processing failed", error);
  }
}

function detectChineseQuick(lyrics: any): boolean {
  const parts: string[] = [];
  if (lyrics?.Type === "Static") {
    for (const line of lyrics.Lines || []) parts.push(line.Text || "");
  } else if (lyrics?.Type === "Line") {
    for (const line of lyrics.Content || []) parts.push(line.Text || "");
  } else if (lyrics?.Type === "Syllable") {
    for (const group of lyrics.Content || []) {
      for (const syl of group.Lead?.Syllables || []) parts.push(syl.Text || "");
      for (const bg of group.Background || []) {
        for (const syl of bg.Syllables || []) parts.push(syl.Text || "");
      }
    }
  }
  const text = parts.join("");
  return /[\u4E00-\u9FFF]/.test(text) && !/[ぁ-んァ-ン]/.test(text);
}

function presentLyrics(lyricsData: any): void {
  // Lyrics are in hand — end any 503 retry loop that was running for this track.
  LyricsQueueRetry.NotifyResolved(lyricsData?.uri);
  setRomanizationClass(lyricsData?.HasTransliterations || lyricsData?.RomanizationPending);
  PageContainer?.classList.toggle("Lyrics_ChineseDetected", lyricsData?.DetectedChinese === true);
  PageContainer?.classList.toggle("Lyrics_TranslationAvailable", lyricsData?.IncludesTranslation === true || lyricsData?.TranslationPending === true);
  HideLoaderContainer();
  $currentLyricsType.set(lyricsData.Type);
  PageContainer?.querySelector<HTMLElement>(".ContentBox")?.classList.remove("LyricsHidden");
  PageContainer?.querySelector(".ContentBox .LyricsContainer")?.classList.remove("Hidden");
  PageView.AppendViewControls(true);
  $currentlyFetching.set(false);
}

export async function PrefetchLyrics(uri: string): Promise<void> {
  const trackId = uri?.split(":")?.[2];
  if (!trackId || uri.startsWith("spotify:local:")) return;
  if (prefetchInFlight.has(trackId)) return;

  try {
    const cached = await LyricsStore.GetItem(trackId);
    if (cached) return;
    const localLyric = await LocalLyricsManager.get(uri);
    if (localLyric) {
      await LyricsStore.SetItem(trackId, { ...localLyric, id: trackId });
      return;
    }
  } catch (error) {
    lyricsPrefetchLogger.debug("Prefetch cache probe failed", error);
  }

  prefetchInFlight.add(trackId);
  try {
    const Token = await Platform.GetSpotifyAccessToken();
    const queries = await Query(
      [
        {
          operation: "lyrics",
          variables: {
            id: trackId,
            auth: "SpicyLyrics-WebAuth",
          },
        },
      ],
      {
        "SpicyLyrics-WebAuth": `Bearer ${Token}`,
      }
    );

    const lyricsQuery = queries.get("0");
    if (!lyricsQuery || lyricsQuery.httpStatus !== 200) return;

    const lyrics = lyricsPacker.unpack(lyricsQuery.data);
    if (lyrics === null || lyrics === undefined || lyrics === "") return;

    await ProcessLyrics(lyrics, { updatePageClasses: false });
    await LyricsStore.SetItem(trackId, lyrics);
    lyricsPrefetchLogger.debug("Prefetched next lyrics", { trackId, uri });
  } catch (error) {
    lyricsPrefetchLogger.debug("Prefetch failed", error);
  } finally {
    prefetchInFlight.delete(trackId);
  }
}

export default async function fetchLyrics(uri: string): Promise<[object | string, number] | null> {
  lyricsLogger.debug("Fetch requested", uri);
  //if (!PageContainer) return;
  const LyricsContent =
    PageContainer?.querySelector(".LyricsContainer .LyricsContent") ?? undefined;
  if (!LyricsContent) return;
  if (LyricsContent?.classList.contains("offline")) {
    LyricsContent.classList.remove("offline");
  }

  //if (!Fullscreen.IsOpen) PageView.AppendViewControls(true);

  if (SpotifyPlayer.IsDJ()) {
    $currentlyFetching.set(false);
    return ["dj", 400];
  }

  const mediaType = SpotifyPlayer.GetMediaType();

  if (
    mediaType &&
    mediaType !== "audio"
  ) {
    $currentlyFetching.set(false);
    if (mediaType === "video") {
      return ["video-track", 400];
    } else if (mediaType === "mixed") {
      return ["mixed-track", 400];
    }
    return ["unknown-track", 400];
  }

  const contentType = SpotifyPlayer.GetContentType();
  if (contentType !== "track") {
    $currentlyFetching.set(false);
    if (contentType === "episode") {
      return ["episode-track", 400];
    }
    return ["unknown-track", 400];
  }

  const trackId = uri.split(":")[2];

  if ($currentlyFetching.get()) {
    $currentlyFetching.set(false);
    return null;
  }

  $currentlyFetching.set(true);

  if (LyricsContent) {
    LyricsContent.classList.add("HiddenTransitioned");
  }


  // Check if there's already data in localStorage
  const savedLyricsData = $currentLyricsData.get();

  if (savedLyricsData && !isDev) {
    try {
      if (savedLyricsData.startsWith("NO_LYRICS:")) {
        // Sentinel format is `NO_LYRICS:<uri>`. The uri itself contains colons,
        // so strip the prefix rather than splitting on ":".
        const savedUri = savedLyricsData.slice("NO_LYRICS:".length);
        if (savedUri === uri) {
          $currentlyFetching.set(false);
          return ["lyrics-not-found", 404];
        }
      } else {
        const lyricsData = JSON.parse(savedLyricsData);
        // Return the stored lyrics if the URI matches the current track URI
        if (lyricsData?.uri === uri && lyricsData?.ProcessingPending !== true) {
          presentLyrics(lyricsData);
          return [lyricsData, 200];
        }
      }
    } catch (error) {
      lyricsCacheLogger.error("Error parsing saved lyrics data", error);
      $currentlyFetching.set(false);
      HideLoaderContainer();
    }
  }

  const localLyric = await LocalLyricsManager.get(uri);
  if (localLyric) {
    const lyricsData = { ...localLyric, uri };
    $currentLyricsData.set(JSON.stringify(lyricsData));
    presentLyrics(lyricsData);
    return [lyricsData, 200];
  }

  // Local files have no real track id (uri.split(":")[2] is the URL-encoded
  // artist name), so they can't be looked up in LyricsStore or fetched from the
  // API. Bail out here — after LocalLyricsManager.get() (which serves any
  // user-uploaded TTML) but before the meaningless remote cache read.
  if (uri.startsWith("spotify:local:")) {
    $currentlyFetching.set(false);
    return ["local-track", 400];
  }

  if (LyricsStore) {
    try {
      const lyricsFromCacheRes = await LyricsStore.GetItem(trackId);
      if (lyricsFromCacheRes) {
        if (lyricsFromCacheRes?.Value === "NO_LYRICS") {
          $currentlyFetching.set(false);
          return ["lyrics-not-found", 404];
        }
        // Tag the cached payload with the current uri so the saved-data and
        // re-fetch checks (which match on uri) recognise it — older cache
        // entries predate the uri field.
        const lyricsFromCache = { ...(lyricsFromCacheRes ?? {}), uri };
        $currentLyricsData.set(JSON.stringify(lyricsFromCache));
        presentLyrics(lyricsFromCache);
        return [{ ...lyricsFromCache, fromCache: true }, 200];
      }
    } catch (error) {
      lyricsCacheLogger.error("Error parsing cache entry", error);
      $currentlyFetching.set(false);
      return ["unknown-error", 0];
    }
  }


  if (!navigator.onLine) {
    $currentlyFetching.set(false);
    return ["offline", 400];
  }

  ShowLoaderContainer();

  // Fetch new lyrics if no match in localStorage
  /* const lyricsApi = storage.get("customLyricsApi") ?? Defaults.LyricsContent.api.url;
    const lyricsAccessToken = storage.get("lyricsApiAccessToken") ?? Defaults.LyricsContent.api.accessToken; */

  try {
    const Token = await Platform.GetSpotifyAccessToken();

    let status = 0;

    lyricsLogger.debug("API lyrics query", { trackId });
    const queries = await Query(
      [
        {
          operation: "lyrics",
          variables: {
            id: trackId,
            auth: "SpicyLyrics-WebAuth",
          },
        },
      ],
      {
        "SpicyLyrics-WebAuth": `Bearer ${Token}`,
      }
    );

    const lyricsQuery = queries.get("0");
    if (!lyricsQuery) {
      lyricsLogger.error("Lyrics query not found");
      HideLoaderContainer();
      $currentlyFetching.set(false);
      return ["lyrics-not-found", 404];
    }

    status = lyricsQuery.httpStatus;

    if (status === 503) {
      // The server accepted the request but hasn't processed it yet — it's
      // queued. Surface the queue loader immediately and hand off to the retry
      // loop, which keeps polling with backoff (and survives page close / view
      // swaps). We deliberately leave the loader up and return a sentinel so no
      // error notice is rendered.
      $currentlyFetching.set(false);
      LyricsQueueRetry.HandleQueued(uri);
      return ["lyrics-queued", 503];
    }

    if (status !== 200) {
      if (status === 404) {
        HideLoaderContainer();
        $currentlyFetching.set(false);
        return ["lyrics-not-found", 404];
      }
      HideLoaderContainer();
      $currentlyFetching.set(false);
      return ["status-not-200", status];
    }

    const lyrics = lyricsPacker.unpack(lyricsQuery.data) as any;

    if (lyrics === null || lyrics === undefined || lyrics === "") {
      HideLoaderContainer();
      $currentlyFetching.set(false);
      return ["lyrics-not-found", 404];
    }

    // Stamp the uri so every match downstream (saved-data, re-fetch, cache)
    // keys off the stable uri instead of the API-supplied id.
    lyrics.uri = uri;
    lyrics.id = trackId;
    lyrics.DetectedChinese = detectChineseQuick(lyrics);
    lyrics.ProcessingPending = true;
    lyrics.RomanizationPending = true;
    lyrics.TranslationPending = translationEnabled;
    $currentLyricsData.set(JSON.stringify(lyrics));

    presentLyrics(lyrics);
    void finishProcessingInBackground(trackId, lyrics);
    return [{ ...lyrics, fromCache: false }, 200];
  } catch (error) {
    lyricsLogger.error("Error fetching lyrics", error);
    $currentlyFetching.set(false);
    HideLoaderContainer();
    return ["unknown-error", 0];
  }
}

let ContainerShowLoaderTimeout: ReturnType<typeof setTimeout> | null = null;

/** Default copy shown in the loader while a lyrics request is queued (HTTP 503). */
export const LYRICS_QUEUE_MESSAGE =
  "Your request is in the queue — hang tight, your lyrics are on the way!";

/**
 * Show the loader container after a delay
 */
function ShowLoaderContainer(): void {
  const loaderContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .loaderContainer"
  );
  if (loaderContainer) {
    ContainerShowLoaderTimeout = setTimeout(() => {
      loaderContainer.classList.add("active");
    }, 2000);
  }
}

/**
 * Immediately reveal the loader with a "request queued" message. Used for the
 * HTTP 503 server-queue state, where we want instant feedback (no 2s delay)
 * plus a note explaining the wait. Idempotent and safe to call when the page is
 * closed (no-ops if there's no loader in the current DOM).
 */
export function ShowQueueLoader(message: string = LYRICS_QUEUE_MESSAGE): void {
  const loaderContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .loaderContainer"
  );
  if (!loaderContainer) return;

  // We're showing now, so cancel the delayed plain-loader reveal.
  if (ContainerShowLoaderTimeout) {
    clearTimeout(ContainerShowLoaderTimeout);
    ContainerShowLoaderTimeout = null;
  }

  loaderContainer.classList.add("active", "queued");

  let messageEl = loaderContainer.querySelector<HTMLElement>(".loaderMessage");
  if (!messageEl) {
    messageEl = document.createElement("div");
    messageEl.className = "loaderMessage";
    loaderContainer.appendChild(messageEl);
  }
  messageEl.textContent = message;
}

/**
 * Hide the loader container and clear any pending timeout
 */
function HideLoaderContainer(): void {
  const loaderContainer = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .loaderContainer"
  );
  if (loaderContainer) {
    if (ContainerShowLoaderTimeout) {
      clearTimeout(ContainerShowLoaderTimeout);
      ContainerShowLoaderTimeout = null;
    }
    loaderContainer.classList.remove("active", "queued");
    loaderContainer.querySelector(".loaderMessage")?.remove();
  }
}

/**
 * Clear the lyrics container content
 */
export function ClearLyricsPageContainer(): void {
  const lyricsContent = PageContainer?.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent"
  );
  if (lyricsContent) {
    lyricsContent.innerHTML = "";
  }
}
