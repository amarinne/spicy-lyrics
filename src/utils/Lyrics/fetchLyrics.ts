import { franc } from "franc-all";
import langs from "langs";
import { isDev } from "../../components/Global/Defaults.ts";
import { $currentLyricsData, $currentLyricsType, $currentlyFetching, $lyricsSelectionMode, $lyricsSourceOrder, $lyricsSourceOverrides, $meaningBackend } from "../stores.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import PageView, { PageContainer } from "../../components/Pages/PageView.ts";
import { LYRICS_PROCESSING_VERSION, ProcessLyrics, READING_PLAN_SCHEMA_VERSION } from "./ProcessLyrics.ts";
import {
  chineseTones,
  chineseTranslitMode,
  cyrillicKeepSigns,
  cyrillicRomanizationMode,
  koreanDisplayMode,
  chineseReadingPlacement,
  joinMandarinWords,
  translationEnabled,
  translationTargetLang,
} from "./lyrics.ts";
import Logger from "../Logger.ts";
import { LocalLyricsManager } from "./manager/index.ts";
import { LyricsQueueRetry } from "./LyricsQueueRetry.ts";
import { GetExpireStore } from "../../modules/Store.ts";
import { translateLyrics } from "./Fork/Translation.ts";
import { $chineseCharacterForm, $japaneseReadingMode } from "../uiState.ts";
import { buildProcessingContextKey } from "./ProcessingContext.ts";
import { captureOriginalSnapshot, type CanonicalOriginalSnapshot } from "./AIRefinement/index.ts";
import { acceptAIRefinementBaseline, getAIRefinementBaseline } from "./AIRefinement/singleton.ts";
import { getTrackSourceOverride } from "./LyricsSourceOverrides.ts";
import { effectiveLyricsSourceConfig, lyricsSourceCacheSignature } from "./LyricsSourcePreferences.ts";
import { isLyricsSourceCacheCompatible } from "./LyricsSourceCache.ts";
import { fetchLyricsFromSources, RUNTIME_LYRICS_SOURCE_ADAPTERS, type TrackLyricsInfo } from "./LyricsSources.ts";
import { LyricsRequestCoordinator, type LyricsRequestSession } from "./LyricsRequestSession.ts";
import { runProviderAcquisition } from "./ProviderAcquisition.ts";

const lyricsLogger = new Logger("Lyrics Pipeline");
const lyricsCacheLogger = new Logger("Lyrics Cache");
const lyricsPrefetchLogger = new Logger("Lyrics Prefetch");
const prefetchInFlight = new Set<string>();
const lyricsRequestCoordinator = new LyricsRequestCoordinator<[object | string, number] | null>();

// recently updated key structure - changed name
export const LyricsStore = GetExpireStore<any>("SpicyLyrics_LyricsStore_g1", 2, undefined, isDev as true);

function sourceConfigFor(trackUri: string) {
  return effectiveLyricsSourceConfig(
    $lyricsSourceOrder.get(),
    $lyricsSelectionMode.get(),
    getTrackSourceOverride($lyricsSourceOverrides.get(), trackUri),
  );
}

function requestIsCurrent(session: LyricsRequestSession, trackUri: string): boolean {
  return session.isCurrent() && SpotifyPlayer.GetUri() === trackUri;
}

function finishFetching(session: LyricsRequestSession): void {
  if (session.isCurrent()) $currentlyFetching.set(false);
}

function currentProcessingContextKey(): string {
  return buildProcessingContextKey({
    translationEnabled,
    translationTargetLang,
    meaningBackend: $meaningBackend.get(),
    chineseTranslitMode,
    chineseTones,
    joinMandarinWords,
    chineseReadingPlacement,
    chineseCharacterForm: $chineseCharacterForm.get(),
    koreanDisplayMode,
    cyrillicRomanizationMode,
    cyrillicKeepSigns,
    japaneseReadingMode: $japaneseReadingMode.get(),
  });
}

async function setProcessedLyricsStoreItem(trackId: string, lyrics: any, session?: LyricsRequestSession): Promise<void> {
  if (session && !session.isCurrent()) return;
  lyrics.ProcessingContextKey = currentProcessingContextKey();
  lyrics.ReadingPlanSchemaVersion = READING_PLAN_SCHEMA_VERSION;
  await LyricsStore.SetItem(trackId, lyrics);
}

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
function snapshotFrom(lyrics: any): CanonicalOriginalSnapshot | null {
  return lyrics?.AIOriginalSnapshot?.schema === 1 ? lyrics.AIOriginalSnapshot : null;
}

function createAndAttachSnapshot(lyrics: any): CanonicalOriginalSnapshot {
  const snapshot = captureOriginalSnapshot(lyrics, translationEnabled ? translationTargetLang : null);
  lyrics.AIOriginalSnapshot = snapshot;
  return snapshot;
}

function acceptBaseline(trackUri: string, lyrics: any, stage: "intermediate" | "final", snapshot: CanonicalOriginalSnapshot, hydrateBeforePublish = false): Promise<void> {
  return acceptAIRefinementBaseline(trackUri, lyrics, stage, snapshot, hydrateBeforePublish);
}

async function finishProcessingInBackground(trackId: string, trackUri: string, lyrics: any, snapshot: CanonicalOriginalSnapshot, session: LyricsRequestSession): Promise<void> {
  const shouldTranslate = lyrics.TranslationPending === true;
  const shouldRerenderAfterRomanization = lyrics.RomanizationPending === true;

  try {
    await ProcessLyrics(lyrics, { updatePageClasses: false, awaitTranslation: false });
    if (!requestIsCurrent(session, trackUri)) return;
    lyrics.ProcessingPending = false;
    lyrics.RomanizationPending = false;
    lyrics.TranslationPending = shouldTranslate;
    await setProcessedLyricsStoreItem(trackId, lyrics, session);
    if (!requestIsCurrent(session, trackUri)) return;
    if (shouldRerenderAfterRomanization) void acceptBaseline(trackUri, lyrics, shouldTranslate ? "intermediate" : "final", snapshot);
  } catch (error) {
    lyrics.ProcessingPending = false;
    lyrics.RomanizationPending = false;
    lyrics.TranslationPending = false;
    lyricsCacheLogger.error("Background lyrics romanization failed", error);
    return;
  }

  if (!shouldTranslate) return;

  try {
    await translateLyrics(lyrics);
    if (!requestIsCurrent(session, trackUri)) return;
  } catch (error) {
    lyricsCacheLogger.error("Background lyrics translation failed", error);
  }
  lyrics.TranslationPending = false;
  await setProcessedLyricsStoreItem(trackId, lyrics, session);
  if (!requestIsCurrent(session, trackUri)) return;
  void acceptBaseline(trackUri, lyrics, "final", snapshot);
}

const RomanizableScriptQuickTest = /[぀-ヿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ԯͰ-Ͽἀ-῿]/;
const ObviousNonEnglishScriptQuickTest = /[぀-ヿ一-鿿가-힯ᄀ-ᇿ㄰-㆏Ѐ-ԯͰ-Ͽἀ-῿]/;
const NonAsciiLatinQuickTest = /[À-ÖØ-öø-ÿĀ-žƀ-ɏ]/;

function collectLyricsText(lyrics: any): string[] {
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
  return parts;
}

function detectChineseQuick(lyrics: any): boolean {
  const text = collectLyricsText(lyrics).join("");
  return /[\u4E00-\u9FFF]/.test(text) && !/[ぁ-んァ-ン]/.test(text);
}

function hasRomanizationWorkQuick(lyrics: any): boolean {
  return RomanizableScriptQuickTest.test(collectLyricsText(lyrics).join(""));
}

function hasTranslationWorkQuick(lyrics: any): boolean {
  if (!translationEnabled || !translationTargetLang) return false;
  const text = collectLyricsText(lyrics).join(" ").trim();
  if (!text) return false;

  if (translationTargetLang === "en") {
    if (ObviousNonEnglishScriptQuickTest.test(text) || NonAsciiLatinQuickTest.test(text)) return true;
    const compact = text.replace(/[^\p{L}\s']/gu, " ").replace(/\s+/g, " ").trim();
    if (compact.length < 24) return false;
    const detected = franc(compact);
    if (detected === "und") return false;
    return langs.where("3", detected)?.["1"] !== "en";
  }

  return true;
}

function markProcessedWithoutBackground(lyrics: any): void {
  lyrics.ProcessingVersion = LYRICS_PROCESSING_VERSION;
  lyrics.ReadingPlanSchemaVersion = READING_PLAN_SCHEMA_VERSION;
  lyrics.ProcessingPending = false;
  lyrics.RomanizationPending = false;
  lyrics.TranslationPending = false;
  lyrics.HasTransliterations = lyrics.HasTransliterations === true;
  lyrics.IncludesRomanization = lyrics.HasTransliterations === true;
  lyrics.IncludesTranslation = lyrics.IncludesTranslation === true;
}

function presentLyrics(lyricsData: any, session?: LyricsRequestSession): void {
  if (session && !session.isCurrent()) return;
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

async function ensureProcessingVersion(trackId: string, uri: string, lyrics: any, session?: LyricsRequestSession): Promise<any> {
  if (lyrics) {
    lyrics.uri = lyrics.uri || uri;
    lyrics.id = lyrics.id || trackId;
  }

  const processingContextKey = currentProcessingContextKey();

  if (!lyrics) return lyrics;
  // A previous session may have cached raw lyrics and exited before background processing finished.
  if (
    lyrics.ProcessingPending !== true
    && lyrics.ProcessingVersion === LYRICS_PROCESSING_VERSION
    && lyrics.ReadingPlanSchemaVersion === READING_PLAN_SCHEMA_VERSION
    && lyrics.ProcessingContextKey === processingContextKey
  ) {
    return lyrics;
  }

  if (!hasRomanizationWorkQuick(lyrics) && !hasTranslationWorkQuick(lyrics)) {
    markProcessedWithoutBackground(lyrics);
    lyrics.id = lyrics.id || trackId;
    await setProcessedLyricsStoreItem(trackId, lyrics, session);
    if (session && !requestIsCurrent(session, uri)) return null;
    return lyrics;
  }

  lyricsCacheLogger.debug("Reprocessing stale cached lyrics", {
    trackId,
    fromVersion: lyrics.ProcessingVersion,
    toVersion: LYRICS_PROCESSING_VERSION,
    fromContext: lyrics.ProcessingContextKey,
    toContext: processingContextKey,
  });
  await ProcessLyrics(lyrics, { updatePageClasses: false, awaitTranslation: true });
  if (session && !requestIsCurrent(session, uri)) return null;
  lyrics.ProcessingPending = false;
  lyrics.RomanizationPending = false;
  lyrics.TranslationPending = false;
  await setProcessedLyricsStoreItem(trackId, lyrics, session);
  if (session && !requestIsCurrent(session, uri)) return null;
  return lyrics;
}

export async function PrefetchLyrics(uri: string): Promise<void> {
  const trackId = uri?.split(":")?.[2];
  if (!trackId || uri.startsWith("spotify:local:")) return;
  if (prefetchInFlight.has(trackId)) return;
  const sourceConfig = sourceConfigFor(uri);
  const sourceSignature = lyricsSourceCacheSignature(sourceConfig);

  try {
    const cached = await LyricsStore.GetItem(trackId);
    if (cached && isLyricsSourceCacheCompatible(cached, sourceSignature)) return;
    const localLyric = await LocalLyricsManager.get(uri);
    if (localLyric) {
      const localDocument = { ...localLyric, id: trackId, uri };
      createAndAttachSnapshot(localDocument);
      await setProcessedLyricsStoreItem(trackId, localDocument);
      return;
    }
  } catch (error) {
    lyricsPrefetchLogger.debug("Prefetch cache probe failed", error);
  }

  // Automatic source selection needs current-track metadata and a complete
  // comparison. Only strict Spicy acquisition is safe to prefetch by id.
  if (sourceConfig.mode !== "strict" || sourceConfig.order[0] !== "spicy") return;

  prefetchInFlight.add(trackId);
  try {
    const info: TrackLyricsInfo = { uri, id: trackId, title: "", artists: [], album: "", durationMs: 1 };
    const outcome = await runProviderAcquisition((signal) => RUNTIME_LYRICS_SOURCE_ADAPTERS.spicy(info, signal));
    if (outcome.kind !== "lyrics" || !outcome.result.lyrics) return;
    const lyrics = outcome.result.lyrics;
    lyrics.id = trackId;
    lyrics.uri = uri;
    lyrics.LyricsSourceCacheSignature = sourceSignature;
    createAndAttachSnapshot(lyrics);

    if (hasRomanizationWorkQuick(lyrics) || hasTranslationWorkQuick(lyrics)) {
      await ProcessLyrics(lyrics, { updatePageClasses: false });
    } else {
      markProcessedWithoutBackground(lyrics);
    }
    await setProcessedLyricsStoreItem(trackId, lyrics);
    lyricsPrefetchLogger.debug("Prefetched next lyrics", { trackId, provider: "spicy" });
  } catch (error) {
    lyricsPrefetchLogger.debug("Prefetch failed", { category: error instanceof SyntaxError ? "invalid-response" : "request-error" });
  } finally {
    prefetchInFlight.delete(trackId);
  }
}

async function fetchLyricsForSession(uri: string, session: LyricsRequestSession): Promise<[object | string, number] | null> {
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
    finishFetching(session);
    return ["dj", 400];
  }

  const mediaType = SpotifyPlayer.GetMediaType();

  if (
    mediaType &&
    mediaType !== "audio"
  ) {
    finishFetching(session);
    if (mediaType === "video") {
      return ["video-track", 400];
    } else if (mediaType === "mixed") {
      return ["mixed-track", 400];
    }
    return ["unknown-track", 400];
  }

  const contentType = SpotifyPlayer.GetContentType();
  if (contentType !== "track") {
    finishFetching(session);
    if (contentType === "episode") {
      return ["episode-track", 400];
    }
    return ["unknown-track", 400];
  }

  const trackId = uri.split(":")[2];
  const sourceConfig = sourceConfigFor(uri);
  const sourceSignature = lyricsSourceCacheSignature(sourceConfig);

  $currentlyFetching.set(true);

  if (LyricsContent) {
    LyricsContent.classList.add("HiddenTransitioned");
  }


  // Check if there's already data in localStorage
  const coordinatorBaseline = getAIRefinementBaseline(uri);
  const savedLyricsData = coordinatorBaseline && isLyricsSourceCacheCompatible(coordinatorBaseline, sourceSignature)
    ? JSON.stringify(coordinatorBaseline)
    : $currentLyricsData.get();

  if (savedLyricsData && !isDev) {
    try {
      if (savedLyricsData.startsWith("NO_LYRICS:")) {
        // Sentinel format is `NO_LYRICS:<uri>`. The uri itself contains colons,
        // so strip the prefix rather than splitting on ":".
        const savedUri = savedLyricsData.slice("NO_LYRICS:".length);
        if (savedUri === uri) {
          finishFetching(session);
          return ["lyrics-not-found", 404];
        }
      } else {
        const lyricsData = JSON.parse(savedLyricsData);
        // Return stored lyrics only when they match the current track. Prefer the
        // URI guard; fall back to id only for pre-uri cache entries.
        const isCurrentTrack = lyricsData?.uri === uri || (!lyricsData?.uri && lyricsData?.id === trackId);
        if (isCurrentTrack && isLyricsSourceCacheCompatible(lyricsData, sourceSignature)) {
          const snapshot = snapshotFrom(lyricsData);
          if (snapshot) {
            const processedLyrics = await ensureProcessingVersion(trackId, uri, lyricsData, session);
            if (!processedLyrics || !requestIsCurrent(session, uri)) return null;
            await acceptBaseline(uri, processedLyrics, "final", snapshot, true);
            presentLyrics(processedLyrics, session);
            return null;
          }
          lyricsCacheLogger.debug("Ignoring saved lyrics without canonical original snapshot", { trackId });
        }
      }
    } catch (error) {
      lyricsCacheLogger.error("Error parsing saved lyrics data", error);
      finishFetching(session);
      HideLoaderContainer();
    }
  }

  const localLyric = await LocalLyricsManager.get(uri);
  if (!requestIsCurrent(session, uri)) return null;
  if (localLyric) {
    const lyricsData = { ...localLyric, uri };
    const snapshot = createAndAttachSnapshot(lyricsData);
    const processedLyrics = await ensureProcessingVersion(trackId, uri, lyricsData, session);
    if (!processedLyrics || !requestIsCurrent(session, uri)) return null;
    await acceptBaseline(uri, processedLyrics, "final", snapshot, true);
    presentLyrics(processedLyrics, session);
    return null;
  }

  // Local files have no real track id (uri.split(":")[2] is the URL-encoded
  // artist name), so they can't be looked up in LyricsStore or fetched from the
  // API. Bail out here — after LocalLyricsManager.get() (which serves any
  // user-uploaded TTML) but before the meaningless remote cache read.
  if (uri.startsWith("spotify:local:")) {
    finishFetching(session);
    return ["local-track", 400];
  }

  if (LyricsStore) {
    try {
      const lyricsFromCacheRes = await LyricsStore.GetItem(trackId);
      if (!requestIsCurrent(session, uri)) return null;
      if (lyricsFromCacheRes && isLyricsSourceCacheCompatible(lyricsFromCacheRes, sourceSignature)) {
        if (lyricsFromCacheRes?.Value === "NO_LYRICS") {
          finishFetching(session);
          return ["lyrics-not-found", 404];
        }
        // Tag the cached payload with the current uri so the saved-data and
        // re-fetch checks (which match on uri) recognise it — older cache
        // entries predate the uri field.
        const cachedCandidate = {
          ...lyricsFromCacheRes,
          uri,
        };
        const snapshot = snapshotFrom(cachedCandidate);
        if (snapshot) {
          const lyricsFromCache = await ensureProcessingVersion(trackId, uri, cachedCandidate, session);
          if (!lyricsFromCache || !requestIsCurrent(session, uri)) return null;
          await acceptBaseline(uri, lyricsFromCache, "final", snapshot, true);
          presentLyrics(lyricsFromCache, session);
          return null;
        }
        lyricsCacheLogger.debug("Ignoring processed cache without canonical original snapshot", { trackId });
      }
    } catch (error) {
      lyricsCacheLogger.error("Error parsing cache entry", error);
      finishFetching(session);
      return ["unknown-error", 0];
    }
  }


  if (!navigator.onLine) {
    finishFetching(session);
    return ["offline", 400];
  }

  ShowLoaderContainer();

  try {
    const sourceResult = await fetchLyricsFromSources(uri, sourceConfig.order, sourceConfig.mode, session.signal);
    if (!requestIsCurrent(session, uri)) return null;
    const status = sourceResult.status;
    if (status === 503) {
      // The server accepted the request but hasn't processed it yet — it's
      // queued. Surface the queue loader immediately and hand off to the retry
      // loop, which keeps polling with backoff (and survives page close / view
      // swaps). We deliberately leave the loader up and return a sentinel so no
      // error notice is rendered.
      finishFetching(session);
      LyricsQueueRetry.HandleQueued(uri);
      return ["lyrics-queued", 503];
    }

    if (status !== 200 || !sourceResult.lyrics) {
      HideLoaderContainer();
      finishFetching(session);
      if (status === 404) {
        return sourceConfig.override === "auto"
          ? ["lyrics-not-found", 404]
          : [`source-unavailable:${sourceConfig.override}`, 404];
      }
      if (sourceConfig.override !== "auto") return [`source-unavailable:${sourceConfig.override}`, status];
      return ["status-not-200", status];
    }

    const lyrics = sourceResult.lyrics;

    // Stamp the uri so every match downstream (saved-data, re-fetch, cache)
    // keys off the stable uri instead of the API-supplied id.
    lyrics.uri = uri;
    lyrics.id = trackId;
    lyrics.LyricsSourceCacheSignature = sourceSignature;
    lyricsLogger.debug("Lyrics source selected", { provider: lyrics.fetchProvider, type: lyrics.Type });
    const originalSnapshot = createAndAttachSnapshot(lyrics);
    lyrics.DetectedChinese = detectChineseQuick(lyrics);
    const needsRomanization = hasRomanizationWorkQuick(lyrics);
    const needsTranslation = hasTranslationWorkQuick(lyrics);

    if (!needsRomanization && !needsTranslation) {
      markProcessedWithoutBackground(lyrics);
      await setProcessedLyricsStoreItem(trackId, lyrics, session);
      if (!requestIsCurrent(session, uri)) return null;
      void acceptBaseline(uri, lyrics, "final", originalSnapshot);
      presentLyrics(lyrics, session);
      return null;
    }

    lyrics.ProcessingPending = true;
    lyrics.RomanizationPending = needsRomanization;
    lyrics.TranslationPending = needsTranslation;
    if (!requestIsCurrent(session, uri)) return null;
    void acceptBaseline(uri, lyrics, "intermediate", originalSnapshot);

    presentLyrics(lyrics, session);
    void finishProcessingInBackground(trackId, uri, lyrics, originalSnapshot, session);
    return null;
  } catch (error) {
    if (!requestIsCurrent(session, uri)) return null;
    lyricsLogger.error("Lyrics acquisition failed", { category: error instanceof SyntaxError ? "invalid-response" : "request-error" });
    finishFetching(session);
    HideLoaderContainer();
    if (sourceConfig.override !== "auto") return [`source-unavailable:${sourceConfig.override}`, 0];
    return ["unknown-error", 0];
  }
}

export function invalidateLyricsPipeline(): void {
  lyricsRequestCoordinator.invalidate();
  $currentlyFetching.set(false);
}

export default function fetchLyrics(uri: string): Promise<[object | string, number] | null> {
  return lyricsRequestCoordinator.run(uri, (session) => fetchLyricsForSession(uri, session));
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
