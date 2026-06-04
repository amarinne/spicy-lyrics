import { $staticBackgroundMode } from "../../utils/stores.ts";
import { $forceDarkBackground } from "../../utils/uiState.ts";
import Global from "../Global/Global.ts";
import { SpotifyPlayer } from "../Global/SpotifyPlayer.ts";
import ArtistVisuals from "./ArtistVisuals/Main.ts";
import { PageContainer } from "../Pages/PageView.ts";
import Kawarp, { type KawarpOptions } from "@kawarp/core";
import { BackgroundAnimationController, type AudioAnalysisData } from "./BackgroundAnimationController.ts";
import { getDynamicAudioAnalysis } from "../../utils/audioAnalysis.ts";
import Logger from "../../utils/Logger.ts";

const dynamicBgLogger = new Logger("Dynamic Background");

const KawarpTransitionDuration = 1000;
export const KawarpOptionsStatic: KawarpOptions = {
  warpIntensity: 1,
  blurPasses: 8,
  animationSpeed: 0.1,
  saturation: 1.5,
  dithering: 0.008,
  transitionDuration: 500,
  // tintColor: [0.16, 0.16, 0.24],
  tintIntensity: 0, // 0.15
  scale: 1,
}

const KawarpOptionsForceDark: Partial<KawarpOptions> = {
  saturation: 0.75,
  tintColor: [0.025, 0.022, 0.03],
  tintIntensity: 0.38,
};

const COLOR_BG_FALLBACK_RGB = "18, 18, 18, 1";
let cachedColorBackgroundEl: HTMLElement | null = null;

type Rgba = { red: number; green: number; blue: number; alpha: number };

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function rgbToHsl({ red, green, blue }: Rgba): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number, alpha: number): Rgba {
  if (s === 0) {
    const value = Math.round(l * 255);
    return { red: value, green: value, blue: value, alpha };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    red: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    green: Math.round(hue2rgb(p, q, h) * 255),
    blue: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    alpha,
  };
}

function forceDarkColor(color: Rgba): Rgba {
  if (!$forceDarkBackground.get()) return color;
  const [h, s, l] = rgbToHsl(color);
  const mutedS = Math.min(s * 0.62, 0.5);
  const darkL = Math.min(l * 0.58, 0.24);
  return hslToRgb(h, clamp01(mutedS), clamp01(darkL), color.alpha);
}

function colorToCss(color: Rgba): string {
  const next = forceDarkColor(color);
  return `${next.red}, ${next.green}, ${next.blue}, ${next.alpha}`;
}

function getKawarpOptions(): KawarpOptions {
  return $forceDarkBackground.get()
    ? { ...KawarpOptionsStatic, ...KawarpOptionsForceDark }
    : KawarpOptionsStatic;
}

function syncForceDarkBackgroundClass(): void {
  PageContainer?.classList.toggle("ForceDarkBackground", $forceDarkBackground.get());
}

export const KawarpMap = new Map<HTMLElement | string, Kawarp>();
const animSpeedController = new BackgroundAnimationController();

interface ApplyDynamicBackgroundOpts {
  doTransitionDurationAppendWithPromise?: boolean;
}

export default async function ApplyDynamicBackground(element: HTMLElement, tag?: string, opts: ApplyDynamicBackgroundOpts = {}) {
  if (!element) return;
  syncForceDarkBackgroundClass();
  dynamicBgLogger.debug("Applying dynamic background", { tag });
  const preCurrentImgCover = SpotifyPlayer.GetCover("large") ?? "";
  const currentImgCover = preCurrentImgCover?.replace("spotify:image:", "https://i.scdn.co/image/");
  const IsEpisode = SpotifyPlayer.GetContentType() === "episode";

  const artists = SpotifyPlayer.GetArtists() ?? [];
  const TrackArtist =
    artists.length > 0 && artists[0]?.uri
      ? artists[0].uri.replace("spotify:artist:", "")
      : undefined;

  const TrackId = SpotifyPlayer.GetId() ?? undefined;
  
  const staticBgMode = $staticBackgroundMode.get();
  if (staticBgMode !== "off") {
    if (staticBgMode === "color") {
      // First, create/init the background with black as a fallback
      let dynamicBg = element.querySelector<HTMLElement>(".spicy-dynamic-bg.ColorBackground");
      if (!dynamicBg) {
        dynamicBg = document.createElement("div");
        dynamicBg.classList.add("spicy-dynamic-bg", "ColorBackground");
        // Set initial fallback colors to black
        dynamicBg.style.setProperty("--MinContrastColor", COLOR_BG_FALLBACK_RGB);
        dynamicBg.style.setProperty("--HighContrastColor", COLOR_BG_FALLBACK_RGB);
        dynamicBg.style.setProperty("--OverlayColor", COLOR_BG_FALLBACK_RGB);
        element.appendChild(dynamicBg);
      }
      cachedColorBackgroundEl = dynamicBg;

      // Now fetch the real colors and apply them
      try {
        const colorQuery = await Spicetify.GraphQL.Request(
          Spicetify.GraphQL.Definitions.getDynamicColorsByUris,
          {
            imageUris: [SpotifyPlayer.GetCover("large") ?? ""]
          }
        );

        const colorResponse = colorQuery.data.dynamicColors[0];
        const colorBestFit = colorResponse.bestFit === "DARK" ? "dark" : colorResponse.bestFit === "LIGHT" ? "light" : "dark";

        const colors = colorResponse[colorBestFit];
        const fromColorObj = colors.minContrast;
        const toColorObj = colors.highContrast;
        const overlayColorObj = colors.higherContrast;

        const fromColorBgObj = fromColorObj.backgroundBase;
        const toColorBgObj = toColorObj.backgroundBase;
        const overlayColorBgObj = overlayColorObj.backgroundBase;

        const fromColor = colorToCss(fromColorBgObj);
        const toColor = colorToCss(toColorBgObj);
        const overlayColor = colorToCss(overlayColorBgObj);

        dynamicBg.style.setProperty("--MinContrastColor", fromColor);
        dynamicBg.style.setProperty("--HighContrastColor", toColor);
        dynamicBg.style.setProperty("--OverlayColor", overlayColor);
      } catch (err) {
        // If the color fetch fails, just keep the black fallback
        dynamicBgLogger.error("Failed to fetch dynamic colors, using fallback black background", err);
      }
      return;
    }
    const currentImgCover = await GetStaticBackground(TrackArtist, TrackId);

    if (IsEpisode || !currentImgCover) return;
    const prevBg = element.querySelector<HTMLElement>(".spicy-dynamic-bg.StaticBackground");

    if (prevBg && prevBg.getAttribute("data-cover-id") === currentImgCover) {
      return;
    }
    const dynamicBg = document.createElement("div");

    dynamicBg.classList.add("spicy-dynamic-bg", "StaticBackground", "Hidden");

    //const processedCover = `https://i.scdn.co/image/${currentImgCover.replace("spotify:image:", "")}`;

    dynamicBg.style.backgroundImage = `url("${currentImgCover}")`;
    dynamicBg.setAttribute("data-cover-id", currentImgCover);
    element.appendChild(dynamicBg);

    setTimeout(() => {
      if (prevBg) {
        prevBg.classList.add("Hidden");
        setTimeout(() => prevBg?.remove(), 500);
      }
      dynamicBg.classList.remove("Hidden");
    }, 80);
  } else {
    const existingElement = element.querySelector<HTMLElement>(".spicy-dynamic-bg");
  
    if (existingElement) {
      const existingBgData = existingElement.getAttribute("data-cover-id") ?? null;

      if (existingBgData === currentImgCover) {
        return;
      }
      const kawarpInstance = KawarpMap.get(
        tag ?
          tag :
          existingElement
      )

      if (kawarpInstance) {
        existingElement.setAttribute("data-cover-id", currentImgCover ?? "");
        kawarpInstance.setOptions(getKawarpOptions());
        await kawarpInstance.loadImage(currentImgCover);
        kawarpInstance.start();
        return;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.classList.add("spicy-dynamic-bg");
    canvas.setAttribute("data-cover-id", currentImgCover ?? "");

    const kawarpInstance = new Kawarp(canvas, getKawarpOptions())
    KawarpMap.set(
      tag ?
        tag :
        canvas,
      kawarpInstance
    )
    element.appendChild(canvas);
    await kawarpInstance.loadImage(currentImgCover);
    kawarpInstance.start();
    const msDelay = KawarpOptionsStatic.transitionDuration * 2;

    if (opts?.doTransitionDurationAppendWithPromise) {
      await new Promise(r => setTimeout(r, msDelay));
      kawarpInstance?.setOptions({ ...getKawarpOptions(), transitionDuration: KawarpTransitionDuration });
    } else {
      setTimeout(() => {
        kawarpInstance?.setOptions({ ...getKawarpOptions(), transitionDuration: KawarpTransitionDuration });
      }, msDelay);
    }
  }
}

export async function GetStaticBackground(
  TrackArtist: string | undefined,
  TrackId: string | undefined
): Promise<string | undefined> {
  if (!TrackArtist || !TrackId) return undefined;

  try {
    return await ArtistVisuals.ApplyContent(TrackArtist, TrackId);
  } catch (error) {
    dynamicBgLogger.error("Error setting static low quality dynamic background", error);
    return undefined;
  }
}

let staticColorBgTransitionTimeout = null;

const getColorBackgroundElement = (): HTMLElement | null => {
  if (cachedColorBackgroundEl?.isConnected) {
    return cachedColorBackgroundEl;
  }
  const el = PageContainer?.querySelector<HTMLElement>(".spicy-dynamic-bg.ColorBackground") ?? null;
  cachedColorBackgroundEl = el;
  return el;
};

Global.Event.listen("playback:songchange", () => {
  if ($staticBackgroundMode.get() === "color" && PageContainer) {
    if (staticColorBgTransitionTimeout) {
      clearTimeout(staticColorBgTransitionTimeout);
      staticColorBgTransitionTimeout = null;

      const dynamicBg = getColorBackgroundElement();
      if (dynamicBg) {
        const min = dynamicBg.style.getPropertyValue("--MinContrastColor").trim();
        const high = dynamicBg.style.getPropertyValue("--HighContrastColor").trim();
        const overlay = dynamicBg.style.getPropertyValue("--OverlayColor").trim();
        if (
          min !== COLOR_BG_FALLBACK_RGB ||
          high !== COLOR_BG_FALLBACK_RGB ||
          overlay !== COLOR_BG_FALLBACK_RGB
        ) {
          dynamicBg.style.setProperty("--MinContrastColor", COLOR_BG_FALLBACK_RGB);
          dynamicBg.style.setProperty("--HighContrastColor", COLOR_BG_FALLBACK_RGB);
          dynamicBg.style.setProperty("--OverlayColor", COLOR_BG_FALLBACK_RGB);
        }
      }
    }

    staticColorBgTransitionTimeout = setTimeout(() => {
      const contentBox = PageContainer.querySelector<HTMLElement>(".ContentBox");
      if (contentBox) ApplyDynamicBackground(contentBox);

      clearTimeout(staticColorBgTransitionTimeout);
      staticColorBgTransitionTimeout = null;
    }, 1000);
  }
})

/** Successful analysis, or `null` once we know the track has no analysis (stops progress-handler spam). */
const audioAnalysisCache = new Map<string, AudioAnalysisData | null>();
const audioAnalysisInflightRequests = new Map<string, Promise<AudioAnalysisData | null>>();
let latestPlaybackTrackId: string | null = null;

const pruneAudioAnalysisCache = (activeTrackId: string) => {
  for (const cachedTrackId of audioAnalysisCache.keys()) {
    if (cachedTrackId !== activeTrackId) {
      audioAnalysisCache.delete(cachedTrackId);
    }
  }
};

const getAudioAnalysisForTrack = async (trackId: string): Promise<AudioAnalysisData | null> => {
  if (audioAnalysisCache.has(trackId)) {
    return audioAnalysisCache.get(trackId)!;
  }

  const inflight = audioAnalysisInflightRequests.get(trackId);
  if (inflight) {
    return inflight;
  }

  const request = getDynamicAudioAnalysis(trackId)
    .then((analysis) => {
      audioAnalysisCache.set(trackId, analysis);
      return analysis;
    })
    .finally(() => {
      audioAnalysisInflightRequests.delete(trackId);
    });

  audioAnalysisInflightRequests.set(trackId, request);
  return request;
};

const setDynamicBackgroundAnimationSpeed = (speed: number) => {
  KawarpMap.forEach((kawarpInstance) => {
    void kawarpInstance.setOptions({
      animationSpeed: speed
    })
  })
};

const resetDynamicBackgroundAnimationSpeed = () => {
  setDynamicBackgroundAnimationSpeed(1);
};

Global.Event.listen("playback:songchange", () => {
  latestPlaybackTrackId = SpotifyPlayer.GetId();

  if (latestPlaybackTrackId) {
    pruneAudioAnalysisCache(latestPlaybackTrackId);
  } else {
    audioAnalysisCache.clear();
  }
});

const applyPlayPauseAnimationSpeed = (isPaused: boolean) => {
  setDynamicBackgroundAnimationSpeed(isPaused ? 0.1 : 1);
};

Global.Event.listen("playback:playpause", (e: { data?: { isPaused?: boolean } }) => {
  applyPlayPauseAnimationSpeed(!!e?.data?.isPaused);
});

// TODO: Make this also remove the NPV dynamic bg when we switch to staticBackground mode, as that should be removed.
const reapplyPageBackground = () => {
  const contentBox = PageContainer?.querySelector<HTMLElement>(".ContentBox");
  if (!contentBox) return;
  const kawarp = KawarpMap.get("lpagebg");
  if (kawarp) {
    kawarp.dispose();
    KawarpMap.delete("lpagebg");
  }
  contentBox.querySelectorAll<HTMLElement>(".spicy-dynamic-bg").forEach((el) => el.remove());
  void ApplyDynamicBackground(contentBox, "lpagebg");
};

$staticBackgroundMode.listen(reapplyPageBackground);

$forceDarkBackground.listen(() => {
  syncForceDarkBackgroundClass();
  KawarpMap.forEach((kawarpInstance) => {
    void kawarpInstance.setOptions(getKawarpOptions());
  });
  reapplyPageBackground();
});

Global.Event.listen("playback:progress", async (e) => {
  const songId = SpotifyPlayer.GetId();
  if (!songId) {
    resetDynamicBackgroundAnimationSpeed();
    return;
  }

  latestPlaybackTrackId = songId;
  const requestTrackId = songId;

  const audioAnalysisData = await getAudioAnalysisForTrack(requestTrackId);
  if (!audioAnalysisData) {
    resetDynamicBackgroundAnimationSpeed();
    return;
  }

  // Prevent stale async results from old tracks applying after rapid song switches.
  const currentTrackId = SpotifyPlayer.GetId();
  if (!currentTrackId || currentTrackId !== requestTrackId || latestPlaybackTrackId !== requestTrackId) {
    return;
  }

  pruneAudioAnalysisCache(requestTrackId);

  const currentTimeMs = SpotifyPlayer.GetPosition();
  const currentTime = currentTimeMs / 1000;

  const speedMultiplier = animSpeedController.getSpeedMultiplier(currentTime, audioAnalysisData);

  KawarpMap.forEach((kawarpInstance) => {
    void kawarpInstance.setOptions({
      animationSpeed: speedMultiplier
    })
  })
})