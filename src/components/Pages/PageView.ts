import fetchLyrics, { invalidateLyricsPipeline, LyricsStore, ShowQueueLoader } from "../../utils/Lyrics/fetchLyrics.ts";
import { LyricsQueueRetry } from "../../utils/Lyrics/LyricsQueueRetry.ts";
import {
  $chineseCharacterForm,
  $chineseTones,
  $chineseTranslitMode,
  $flatViewControls,
  $forceCompactMode,
  $forceDarkBackground,
  $japaneseReadingMode,
  $joinMandarinWords,
  $showChineseTranslitButton,
  $translationTargetLang,
} from "../../utils/uiState.ts";
import "../../css/Loaders/DotLoader.css";
import { DestroyAllLyricsContainers } from "../../utils/Lyrics/Applyer/CreateLyricsContainer.ts";
import ApplyLyrics, {
  cleanupApplyLyricsAbortController,
} from "../../utils/Lyrics/Global/Applyer.ts";
import {
  addLinesEvListener,
  chineseTranslitMode,
  isRomanized,
  removeLinesEvListener,
  setChineseTranslitMode,
  setRomanizedStatus,
  setTranslationEnabled,
  translationEnabled,
} from "../../utils/Lyrics/lyrics.ts";
import {
  CleanupScrollEvents,
  InitializeScrollEvents,
  ResetLastLine,
} from "../../utils/Scrolling/ScrollToActiveLine.ts";
import { ScrollSimplebar } from "../../utils/Scrolling/Simplebar/ScrollSimplebar.ts";
import ApplyDynamicBackground, { KawarpMap } from "../DynamicBG/dynamicBackground.ts";
import {
  $adaptiveSectioning,
  $currentLyricsData,
  $fixHanGlyphVariants,
  $lineHoverBackground,
  $lyricsContainerExists,
  $lyricsSelectionMode,
  $lyricsSourceOrder,
  $minimalLyricsMode,
  $meaningBackend,
  $soundBackend,
  $soundTargetOrthography,
  $showVolumeSlider,
  $simpleLyricsMode,
  $skipSpicyFont,
  $systemFontStack,
  $ttmlMakerMode,
  $viewControlsPosition,
} from "../../utils/stores.ts";
import { toCssFontFamilyStack, toHanLanguageFontStack } from "../../utils/cssFontFamily.ts";
import Global from "../Global/Global.ts";
import Session from "../Global/Session.ts";
import { SpotifyPlayer } from "../Global/SpotifyPlayer.ts";
import { Icons } from "../Styling/Icons.ts";
import {
  DisableCompactMode,
  EnableCompactMode,
  IsCompactMode,
} from "../Utils/CompactMode.ts";
import Fullscreen, {
  EnterSpicyLyricsFullscreen,
  ExitFullscreenElement,
} from "../Utils/Fullscreen.ts";
import {
  NowBarObj,
  NowBar_SwapSides,
  Session_NowBar_SetSide,
  Session_OpenNowBar,
  ToggleNowBar,
  OpenNowBar,
} from "../Utils/NowBar.ts";
import TransferElement from "../Utils/TransferElement.ts";
import { IsPIP, _IsPIP_after, ClosePopupLyrics } from "../Utils/PopupLyrics.ts";
import { NPVCardOwnsPage, DeRenderNPVCard } from "../Utils/NPVLyrics.ts";
import { CleanUpIsByCommunity } from "../../utils/Lyrics/Applyer/Credits/ApplyIsByCommunity.tsx";
import { OpenLyricsDBPanel } from "../../utils/openLyricsDBPanel.tsx";
import { openSettingsPanel } from "../../utils/settings.ts";
import Logger from "../../utils/Logger.ts";
import { ApplyExperimentClasses, onExperimentChange } from "../../utils/experiments.ts";
import { aiRefinementCoordinator, aiSoundCoordinator, invalidateAIRefinementBaseline, syncAIRefinementBackends } from "../../utils/Lyrics/AIRefinement/singleton.ts";
import { triggerRemeasureLV } from "../../utils/Lyrics/LyricsVirtualizer.ts";
import { copyCurrentLyricsToClipboard } from "../../utils/Lyrics/CopyLyrics.ts";
import { openAISteeringEditor } from "../../utils/openAISteeringEditor.tsx";

const pageLogger = new Logger("Page View");
const controlsLogger = new Logger("View Controls");

interface TippyInstance {
  destroy: () => void;
  [key: string]: any;
}

export const Tooltips: {
  Close: TippyInstance | null;
  NowBarToggle: TippyInstance | null;
  FullscreenToggle: TippyInstance | null;
  CinemaView: TippyInstance | null;
  NowBarSideToggle: TippyInstance | null;
  LyricsManager: TippyInstance | null;
  CopyLyrics: TippyInstance | null;
  Settings: TippyInstance | null;
  AIRefinement: TippyInstance | null;
  AISound: TippyInstance | null;
} = {
  Close: null,
  NowBarToggle: null,
  FullscreenToggle: null,
  CinemaView: null,
  NowBarSideToggle: null,
  LyricsManager: null,
  CopyLyrics: null,
  Settings: null,
  AIRefinement: null,
  AISound: null,
};

const PageView = {
  Open: OpenPage,
  Destroy: DestroyPage,
  AppendViewControls,
  IsOpened: false,
  IsTippyCapable: true,
};

export const GetPageRoot = () =>
  /* document.querySelector<HTMLElement>(".QdB2YtfEq0ks5O4QbtwX .WRGTOibB8qNEkgPNtMxq") ?? */
  document.querySelector<HTMLElement>(
    ".Root__main-view .main-view-container div[data-overlayscrollbars-viewport]"
  ) ??
  (() => {
    const child = document.querySelector<HTMLElement>(
      ".Root__main-view .main-view-container .main-view-container__scroll-node-child"
    );
    return child?.parentElement as HTMLElement | null;
  })() ??
  document.querySelector<HTMLElement>(
    ".Root__main-view .main-view-container .os-host"
  ) ??
  document.querySelector<HTMLElement>(
    ".Root__main-view .main-view-container .uGZUPBPcDpzSYqKcQT8r > div"
  );

let PageResizeListener: ResizeObserver | null = null;
export let PageContainer: HTMLElement | null = null;
export let IsCardMode = false;

function applySystemFontStack(targetDocument: Document = PageContainer?.ownerDocument ?? document): void {
  const configuredStack = $systemFontStack.get();
  const stack = toCssFontFamilyStack(configuredStack);
  if ($skipSpicyFont.get() && stack) {
    targetDocument.documentElement.style.setProperty("--spicy-system-font", stack);
    if ($fixHanGlyphVariants.get()) {
      targetDocument.documentElement.style.setProperty("--spicy-system-font-ja", toHanLanguageFontStack(configuredStack, "ja"));
      targetDocument.documentElement.style.setProperty("--spicy-system-font-zh", toHanLanguageFontStack(configuredStack, "zh-Hans"));
      targetDocument.documentElement.style.setProperty("--spicy-system-font-zh-hant", toHanLanguageFontStack(configuredStack, "zh-Hant"));
    } else {
      targetDocument.documentElement.style.removeProperty("--spicy-system-font-ja");
      targetDocument.documentElement.style.removeProperty("--spicy-system-font-zh");
      targetDocument.documentElement.style.removeProperty("--spicy-system-font-zh-hant");
    }
  } else {
    targetDocument.documentElement.style.removeProperty("--spicy-system-font");
    targetDocument.documentElement.style.removeProperty("--spicy-system-font-ja");
    targetDocument.documentElement.style.removeProperty("--spicy-system-font-zh");
    targetDocument.documentElement.style.removeProperty("--spicy-system-font-zh-hant");
  }
}

async function OpenPage(
  AppendTo: HTMLElement | undefined = undefined,
  options?: { cardMode?: boolean }
) {

  if (_IsPIP_after) {
    await ClosePopupLyrics();
    // After closing, open again with the same arguments
    return OpenPage(AppendTo, options);
  }

  if (!options?.cardMode && NPVCardOwnsPage()) {
    // The NPV card holds the global page; hand it over to the real requester.
    await DeRenderNPVCard();
    return OpenPage(AppendTo, options);
  }

  if (PageView.IsOpened) return;

  IsCardMode = !!options?.cardMode;
  /* if (!HoverMode) {
        PageView.IsTippyCapable = false;
    } */
  const elem = document.createElement("div");
  elem.id = "SpicyLyricsPage";

  elem.classList.add("SpicyRenderer");

  if (IsCardMode) {
    elem.classList.add("CardMode");
  }

  /* if (HoverMode) {
        elem.classList.add("TippyMode");
    } */
  //const extractedColors = ((await Spicetify.colorExtractor(SpotifyPlayer.GetUri() ?? "spotify:track:31CsSZ9KlQmEu0JvWSkM3j")) as any) ?? { VIBRANT_NON_ALARMING: "#999999" };
  //const vibrantNonAlarmingColor = extractedColors?.VIBRANT_NON_ALARMING ?? "#999999";
  elem.innerHTML = `
        <div class="ContentBox">
            <div class="NowBar">
                <div class="CenteredView">
                    <div class="Header">
                        <div class="MediaBox">
                            <div class="MediaContent"></div>
                            <div class="MediaImageContainer">
                              <div class="fi_FromImage ib_ImageBox"></div>
                              <div class="ti_ToImage ib_ImageBox"></div>
                            </div>
                        </div>
                        <div class="Metadata">
                            <div class="SongName">
                                <span></span>
                            </div>
                            <div class="Artists">
                                <span></span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="LyricsContainer">
                <div class="loaderContainer">
                    <div id="DotLoader"></div>
                </div>
                <div class="LyricsContent ScrollbarScrollable"></div>
            </div>
            <div class="ViewControls"></div>
        </div>
    `;

  if ($flatViewControls.get()) {
    elem.classList.add("FlatViewControls");
  }

  if ($forceDarkBackground.get()) {
    elem.classList.add("ForceDarkBackground");
  }

  if ($viewControlsPosition.get() === "Top") {
    elem.classList.add("ViewControlsPosition_Top")
  } else if ($viewControlsPosition.get() === "Bottom") {
    elem.classList.add("ViewControlsPosition_Bottom")
  }

  /* 
        <div class="SongMoreInfo">
            <div class="Content">
                <div class="SongMetadata">
                    <img src="" class="SongArtwork">
                    <div class="SongMetadataTextContent">
                        <p class="SongName">
                            <span></span>
                        </p>
                        <p class="ArtistsNames">
                            <span></span>
                        </p>
                    </div>
                </div>
                <div class="SongAnnotation">
                    <div class="BackgroundVisualizer">    
                        <p class="Annotation">
                            <span></span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    */

  
  PageContainer = elem;

  if (!$skipSpicyFont.get()) {
    elem.classList.add("UseSpicyFont");
  }
  elem.classList.toggle("FixHanGlyphVariants", $fixHanGlyphVariants.get());
  applySystemFontStack(elem.ownerDocument ?? document);

  if ($simpleLyricsMode.get()) {
    elem.classList.add("SimpleLyricsMode");
  }

  if ($minimalLyricsMode.get()) {
    elem.classList.add("MinimalLyricsMode");
  }

  if ($adaptiveSectioning.get()) {
    elem.classList.add("AdaptiveSectioning");
  }

  if (!$lineHoverBackground.get()) {
    elem.classList.add("NoLineHoverBackground");
  }

  // Gates layout offsets that reserve room for the fullscreen volume band.
  if ($showVolumeSlider.get()) {
    elem.classList.add("ShowVolumeSlider");
  }

  ApplyExperimentClasses(elem);

  const contentBox = elem.querySelector<HTMLElement>(
    ".ContentBox"
  );
  // Card mode stays transparent — the NPV's own dynamic background shows through.
  if (contentBox && !IsCardMode) {
    try {
      ApplyDynamicBackground(contentBox, "lpagebg");
    } catch (err) {
      pageLogger.error("Error applying dynamic background", err);
    }
  }

  if (AppendTo !== undefined) {
    AppendTo?.appendChild(elem);
  } else {
    GetPageRoot()?.appendChild(elem);
  }

  addLinesEvListener();

  {
    const currentUri = Spicetify?.Player?.data?.item?.uri;
    if (currentUri) {
      // If a 503 retry loop is already running for this track, re-show the
      // queue loader right away so reopening the page / swapping views restores
      // the queued state with no flash of empty content.
      if (LyricsQueueRetry.IsRetryingFor(currentUri)) {
        ShowQueueLoader();
      }
      fetchLyrics(currentUri).then(ApplyLyrics);
    }
  }

  if (!IsCardMode) {
    Session_OpenNowBar();

    /* const ArtworkButton = document.querySelector<HTMLElement>("#SpicyLyricsPage .ContentBox .NowBar .Header .Artwork");

      ArtworkButton.addEventListener("click", () => {
          NowBar_SwapSides();
      }) */

    Session_NowBar_SetSide();

    AppendViewControls();

    DisableCompactMode();
  } else if (IsCompactMode()) {
    // A previous PiP/fullscreen open left the module flag set; the card page
    // never enables compact mode, and a stale flag makes ScrollToActiveLine
    // pin the active line to the top instead of centering it.
    DisableCompactMode();
  }

  PageResizeListener = new ResizeObserver(() => {
    if (!Fullscreen.IsOpen || !Fullscreen.CinemaViewOpen) return;
    Compactify(elem);
  });

  PageResizeListener.observe(elem);

  if (AppendTo === undefined) {
    const legacyPage = document.querySelector<HTMLElement>(
      ".Root__main-view .main-view-container .os-host"
    );
    if (legacyPage) {
      legacyPage.style.containerType = "inline-size";
    }
  }

  // UpdateSongMoreInfo()

  $lyricsContainerExists.set(true);
  PageView.IsOpened = true;

  if (IsPIP) {
    elem?.classList.add("ForcedCompactMode");
    OpenNowBar(true);
    EnableCompactMode();
  }

  PageContainer = elem;

  const contentType = SpotifyPlayer.GetContentType();
  if (contentType === "episode") {
    elem?.classList.add("episode-content-type");
  } else {
    elem?.classList.remove("episode-content-type");
  }

  Global.Event.evoke("page:open", { cardMode: IsCardMode });
}

/* Global.Event.listen("playback:songchange", () => {
    if (!PageView.IsOpened) return;
    UpdateSongMoreInfo();
}) */

export const isSizeReadyToBeCompacted = () =>
  window.matchMedia("(max-width: 70.812rem)").matches;

export function Compactify(Element: HTMLElement | undefined = undefined) {
  if (!Fullscreen.IsOpen) return;
  const elem = Element ?? PageContainer;
  if (!elem) return;
  if (isSizeReadyToBeCompacted()) {
    elem.classList.add("CompactifyEnabledCompactMode");
    EnableCompactMode();
  } else {
    if (!elem.classList.contains("CompactifyEnabledCompactMode")) return;
    elem.classList.remove("CompactifyEnabledCompactMode");
    if (elem.classList.contains("ForcedCompactMode")) return;
    DisableCompactMode();
  }
}

async function DestroyPage() {
  if (!PageView.IsOpened) return;
  pageLogger.debug("Destroying page");

  cleanupApplyLyricsAbortController();

  if (Fullscreen.IsOpen) await Fullscreen.Close();
  if (!PageContainer) return;

  KawarpMap.get("lpagebg")?.dispose();
  KawarpMap.delete("lpagebg");
  ResetLastLine();
  CleanupScrollEvents();
  PageResizeListener?.disconnect(); // Disconnect the observer
  PageView.IsOpened = false;
  $lyricsContainerExists.set(false);
  DestroyAllLyricsContainers();
  CleanUpIsByCommunity();

  const legacyPage = document.querySelector<HTMLElement>(
    ".Root__main-view .main-view-container .os-host"
  );
  if (legacyPage) {
    legacyPage.style.containerType = "";
  }

  PageContainer?.remove();
  removeLinesEvListener();
  Object.values(Tooltips).forEach((a) => {
    a?.destroy();
  });
  ScrollSimplebar?.unMount();
  IsCardMode = false;
  Global.Event.evoke("page:destroy", null);
  PageView.IsTippyCapable = true;
  PageContainer = null;
}

export let LyricsApplied = false;

Global.Event.listen("lyrics:not-apply", () => {
  CleanupScrollEvents();
  LyricsApplied = false;
  CleanUpIsByCommunity();
});

Global.Event.listen("lyrics:apply", ({ Type }: { Type: string }) => {
  CleanupScrollEvents();

  if (!Type || Type === "Static") return;
  if (ScrollSimplebar) {
    InitializeScrollEvents(ScrollSimplebar);
    //QueueForceScroll(); // Queue a force scroll instead of directly calling with true
    LyricsApplied = true;
  }

  setTimeout(() => triggerRemeasureLV(), 1000);
  setTimeout(() => triggerRemeasureLV(), 1500);
});

function AppendViewControls(ReAppend: boolean = false) {
  if (IsCardMode) return;
  if (!PageContainer) return;
  controlsLogger.debug("Append view controls");
  const elem = PageContainer.querySelector<HTMLElement>(
    ".ContentBox .ViewControls"
  );
  if (!elem) return;

  // Safely destroy existing tooltips first
  Object.keys(Tooltips).forEach((key) => {
    const tippy = Tooltips[key as keyof typeof Tooltips];
    if (tippy?.destroy && typeof tippy.destroy === "function") {
      tippy.destroy();
      Tooltips[key as keyof typeof Tooltips] = null;
    }
  });

  if (ReAppend) elem.innerHTML = "";
  const isNoLyrics =
    $currentLyricsData.get() === `NO_LYRICS:${SpotifyPlayer.GetUri()}`;
  const isTTMLMakerMode = $ttmlMakerMode.get();
  elem.innerHTML = `
        ${
          Fullscreen.IsOpen || Fullscreen.CinemaViewOpen
            ? ""
            : IsPIP ? "" : `<button id="CinemaView" class="ViewControl">${Icons.CinemaView}</button>`
        }
        ${
          Fullscreen.IsOpen || Fullscreen.CinemaViewOpen
            ? IsPIP ? "" : `<button id="CompactModeToggle" class="ViewControl">${
                IsCompactMode()
                  ? Icons.DisableCompactModeIcon
                  : Icons.EnableCompactModeIcon
              }</button>`
            : ""
        }
        <button id="RomanizationToggle" class="ViewControl">
          ${
            isRomanized
              ? Icons.DisableRomanization
              : Icons.EnableRomanization
          }
        </button>
        ${
          $soundBackend.get() !== "deterministic"
            ? `<button id="AISoundToggle" class="ViewControl">${
                aiSoundCoordinator.getState(SpotifyPlayer.GetUri() ?? "").status === "refining"
                  || aiSoundCoordinator.getState(SpotifyPlayer.GetUri() ?? "").status === "requested"
                  ? Icons.Spinner.replaceAll("{SIZE}", "20")
                  : aiSoundCoordinator.getState(SpotifyPlayer.GetUri() ?? "").status === "refined"
                    ? Icons.AIRestore
                    : Icons.AIRefine
              }</button>`
            : ""
        }
        ${
          $showChineseTranslitButton.get() && PageContainer.classList.contains("Lyrics_ChineseDetected")
            ? `<button id="ChineseTranslitToggle" class="ViewControl" style="font-size: 14px; font-weight: 600; line-height: 1;">${
                chineseTranslitMode === "jyutping" ? "粵" : "拼"
              }</button>`
            : ""
        }
        <button id="TranslationToggle" class="ViewControl">
          ${translationEnabled ? Icons.DisableTranslation : Icons.EnableTranslation}
        </button>
        ${
          $meaningBackend.get() !== "google"
            ? `<button id="AIRefinementToggle" class="ViewControl">${
                aiRefinementCoordinator.getState(SpotifyPlayer.GetUri() ?? "").status === "refining"
                  || aiRefinementCoordinator.getState(SpotifyPlayer.GetUri() ?? "").status === "requested"
                  ? Icons.Spinner.replaceAll("{SIZE}", "20")
                  : aiRefinementCoordinator.getState(SpotifyPlayer.GetUri() ?? "").status === "refined"
                    ? Icons.AIRestore
                    : Icons.AIRefine
              }</button>`
            : ""
        }
        ${
          !Fullscreen.IsOpen &&
          !Fullscreen.CinemaViewOpen
            ? IsPIP ? "" : `<button id="NowBarToggle" class="ViewControl">${Icons.NowBar}</button>`
            : ""
        }
        ${
          NowBarObj.Open
            ? IsPIP ? "" : `<button id="NowBarSideToggle" class="ViewControl">${Icons.NowBarSideSwap}</button>`
            : ""
        }
        ${
          Fullscreen.IsOpen
            ? (IsPIP ? "" : `<button id="FullscreenToggle" class="ViewControl">${
                Fullscreen.CinemaViewOpen
                  ? Icons.Fullscreen
                  : Icons.CloseFullscreen
              }</button>`)
            : ""
        }
        ${
          isTTMLMakerMode
            ? `<button id="LyricsManager" class="ViewControl">${Icons.LyricsManager}</button>`
            : ""
        }
        <button id="CopyLyrics" class="ViewControl">${Icons.CopyLyrics}</button>
        ${IsPIP ? "" : `<button id="SettingsToggle" class="ViewControl">${Icons.Settings}</button>`}
        <button id="Close" class="ViewControl">${Icons.Close}</button>
    `;

  let targetElem: HTMLElement | null = elem;
  if (Fullscreen.IsOpen) {
    const mediaContent = PageContainer?.querySelector<HTMLElement>(
      ".ContentBox .NowBar .Header .MediaBox .MediaContent"
    );
    if (mediaContent) {
      TransferElement(elem, mediaContent);
      const viewControls =
        mediaContent.querySelector<HTMLElement>(".ViewControls");
      if (viewControls) {
        targetElem = viewControls;
      }
    }
  } else {
    const contentBox = PageContainer?.querySelector<HTMLElement>(".ContentBox");
    if (
      PageContainer?.querySelector<HTMLElement>(
        ".ContentBox .NowBar .Header .ViewControls"
      ) &&
      contentBox
    ) {
      TransferElement(elem, contentBox);
    }
  }

  if (targetElem) {
    SetupTippy(targetElem);
  }

  function SetupTippy(elem: HTMLElement) {
    // If in PIP mode, do not create any Tippy tooltips, but still wire up click handlers
    const isPip = IsPIP;

    const closeButton = elem.querySelector("#Close");
    if (closeButton) {
      try {
        if (!isPip) {
          Tooltips.Close = Spicetify.Tippy(closeButton, {
            ...Spicetify.TippyProps,
            content: `Close Page`,
          });
        }
        closeButton.addEventListener("click", async () => {
          if (IsPIP) {
            await ClosePopupLyrics();
            globalThis.focus();
            return;
          }

          if (Fullscreen.IsOpen) {
            await Fullscreen.Close();
          }

          Session.GoBack();
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Close tooltip", err);
      }
    }

    const compactModeToggle = elem.querySelector("#CompactModeToggle");
    if (compactModeToggle) {
      try {
        if (!isPip) {
          Tooltips.Close = Spicetify.Tippy(compactModeToggle, {
            ...Spicetify.TippyProps,
            content: `${
              IsCompactMode() ? "Disable Compact Mode" : "Enable Compact Mode"
            }`,
          });
        }
        compactModeToggle.addEventListener("click", () => {
          // Use PageContainer instead of document.querySelector
          const SpicyLyricsPage = PageContainer;
          if (Fullscreen.IsOpen || Fullscreen.CinemaViewOpen) {
            if (IsCompactMode()) {
              SpicyLyricsPage?.classList.remove("ForcedCompactMode");
              DisableCompactMode();
              $forceCompactMode.set(false);
            } else {
              SpicyLyricsPage?.classList.add("ForcedCompactMode");
              EnableCompactMode();
              $forceCompactMode.set(true);
            }

            setTimeout(() => {
              AppendViewControls(true);
            }, 65);
          }
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Compact Mode tooltip", err);
      }
    }

    const romanizationToggle = elem.querySelector("#RomanizationToggle");
    if (romanizationToggle) {
      try {
        if (!isPip) {
          Tooltips.Close = Spicetify.Tippy(romanizationToggle, {
            ...Spicetify.TippyProps,
            content: isRomanized ? `Disable Romanization` : `Enable Romanization`,
          });
        }
        romanizationToggle.addEventListener("click", async () => {
          const songUri = SpotifyPlayer.GetUri();
          if (!songUri) return;
          PageContainer?.querySelector(
            ".LyricsContainer .LyricsContent"
          )?.classList.add("HiddenTransitioned");
          const lyrics = await fetchLyrics(songUri);

          setRomanizedStatus(!isRomanized);

          ApplyLyrics(lyrics);

          setTimeout(() => {
            AppendViewControls();
            PageContainer?.querySelector(
              ".LyricsContainer .LyricsContent"
            )?.classList.remove("HiddenTransitioned");
          }, 45);
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Romanization tooltip", err);
      }
    }

    const reprocessCurrentLyrics = async () => {
      const songUri = SpotifyPlayer.GetUri();
      const songId = SpotifyPlayer.GetId();
      if (!songUri) return;
      PageContainer?.querySelector(".LyricsContainer .LyricsContent")?.classList.add("HiddenTransitioned");
      invalidateAIRefinementBaseline(songUri);
      $currentLyricsData.set("");
      if (songId) await LyricsStore.RemoveItem(songId).catch(() => {});
      const lyrics = await fetchLyrics(songUri);
      ApplyLyrics(lyrics);
      setTimeout(() => {
        AppendViewControls();
        triggerRemeasureLV();
        PageContainer?.querySelector(".LyricsContainer .LyricsContent")?.classList.remove("HiddenTransitioned");
      }, 45);
    };

    const chineseTranslitToggle = elem.querySelector("#ChineseTranslitToggle");
    if (chineseTranslitToggle) {
      try {
        if (!isPip) {
          Tooltips.Close = Spicetify.Tippy(chineseTranslitToggle, {
            ...Spicetify.TippyProps,
            content: chineseTranslitMode === "jyutping" ? "Switch to Mandarin (Pinyin)" : "Switch to Cantonese (Jyutping)",
          });
        }
        chineseTranslitToggle.addEventListener("click", () => {
          setChineseTranslitMode(chineseTranslitMode === "jyutping" ? "pinyin" : "jyutping");
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Chinese transliteration tooltip", err);
      }
    }

    const soundToggle = elem.querySelector("#AISoundToggle");
    if (soundToggle) {
      const trackUri = SpotifyPlayer.GetUri();
      const state = trackUri ? aiSoundCoordinator.getState(trackUri) : { status: "idle" as const };
      if (!isPip) {
        const label = state.status === "refined"
          ? "Restore built-in sound"
          : state.status === "refining" || state.status === "requested"
            ? `Refining sound ${state.done ?? 0}/${state.total ?? 0}`
            : state.status === "failed"
              ? state.reason === "alignment_required" ? "AI sound is unavailable for syllable-timed lyrics." : `Sound failed: ${state.reason}. Click to retry.`
              : "Refine sound with AI";
        Tooltips.AISound = Spicetify.Tippy(soundToggle, { ...Spicetify.TippyProps, content: label });
      }
      soundToggle.addEventListener("click", () => {
        if (!trackUri || state.status === "refining" || state.status === "requested") return;
        if (state.status === "refined") aiSoundCoordinator.restoreBaseline(trackUri);
        else aiSoundCoordinator.refine(trackUri);
      });
      soundToggle.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openAISteeringEditor();
      });
    }

    const translationToggle = elem.querySelector("#TranslationToggle");
    if (translationToggle) {
      try {
        if (!isPip) {
          Tooltips.Close = Spicetify.Tippy(translationToggle, {
            ...Spicetify.TippyProps,
            content: translationEnabled ? "Disable Translation" : "Enable Translation",
          });
        }
        translationToggle.addEventListener("click", async () => {
          setTranslationEnabled(!translationEnabled);
          await reprocessCurrentLyrics();
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Translation tooltip", err);
      }
    }

    const refinementToggle = elem.querySelector("#AIRefinementToggle");
    if (refinementToggle) {
      const trackUri = SpotifyPlayer.GetUri();
      const state = trackUri ? aiRefinementCoordinator.getState(trackUri) : { status: "idle" as const };
      if (!isPip) {
        const label = state.status === "refined"
          ? "Restore baseline"
          : state.status === "refining" || state.status === "requested"
            ? `Refining ${state.done ?? 0}/${state.total ?? 0}`
            : state.status === "failed"
              ? `Refine failed: ${state.reason}. Click to retry.`
              : "Refine translation with AI";
        Tooltips.AIRefinement = Spicetify.Tippy(refinementToggle, { ...Spicetify.TippyProps, content: label });
      }
      refinementToggle.addEventListener("click", () => {
        if (!trackUri || state.status === "refining" || state.status === "requested") return;
        if (state.status === "refined") aiRefinementCoordinator.restoreBaseline(trackUri);
        else aiRefinementCoordinator.refine(trackUri);
      });
      refinementToggle.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openAISteeringEditor();
      });
    }

    if (!Fullscreen.IsOpen && !Fullscreen.CinemaViewOpen) {
      const nowBarButton = elem.querySelector("#NowBarToggle");
      if (nowBarButton) {
        try {
          if (!isPip) {
            Tooltips.NowBarToggle = Spicetify.Tippy(nowBarButton, {
              ...Spicetify.TippyProps,
              content: `NowBar`,
            });
          }
          nowBarButton.addEventListener("click", () => ToggleNowBar());
        } catch (err) {
          controlsLogger.warn("Failed to setup NowBar tooltip", err);
        }
      }

    }

    const fullscreenBtn = elem.querySelector("#FullscreenToggle");
    if (fullscreenBtn) {
      try {
        if (!isPip) {
          Tooltips.FullscreenToggle = Spicetify.Tippy(fullscreenBtn, {
            ...Spicetify.TippyProps,
            content: `${
              Fullscreen.CinemaViewOpen ? "Fullscreen" : "Cinema View"
            }`,
          });
        }
        fullscreenBtn.addEventListener("click", async () => {
          // If we're in cinema view, go to full fullscreen
          if (Fullscreen.CinemaViewOpen) {
            Fullscreen.CinemaViewOpen = false;
            await EnterSpicyLyricsFullscreen();
            PageView.AppendViewControls(true);
          } else {
            Fullscreen.CinemaViewOpen = true;
            await ExitFullscreenElement();
            PageView.AppendViewControls(true);
          }
          setTimeout(Compactify, 250);
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Fullscreen tooltip", err);
      }
    }

    const cinemaViewBtn = elem.querySelector("#CinemaView");
    if (cinemaViewBtn && !Fullscreen.IsOpen) {
      try {
        if (!isPip) {
          Tooltips.CinemaView = Spicetify.Tippy(cinemaViewBtn, {
            ...Spicetify.TippyProps,
            content: `Cinema View`,
          });
        }
        cinemaViewBtn.addEventListener("click", async () => {
          Fullscreen.Open(true);
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Cinema View tooltip", err);
      }
    }

    const nowBarSideToggleBtn = elem.querySelector("#NowBarSideToggle");
    if (
      nowBarSideToggleBtn &&
      NowBarObj.Open &&
      !(isNoLyrics && (Fullscreen.IsOpen || Fullscreen.CinemaViewOpen))
    ) {
      try {
        if (!isPip) {
          Tooltips.NowBarSideToggle = Spicetify.Tippy(nowBarSideToggleBtn, {
            ...Spicetify.TippyProps,
            content: `Swap NowBar Side`,
          });
        }
        nowBarSideToggleBtn.addEventListener("click", () => NowBar_SwapSides());
      } catch (err) {
        controlsLogger.warn("Failed to setup NowBar Side Toggle tooltip", err);
      }
    }

    const copyLyricsButton = elem.querySelector("#CopyLyrics");
    if (copyLyricsButton) {
      try {
        if (!isPip) {
          Tooltips.CopyLyrics = Spicetify.Tippy(copyLyricsButton, {
            ...Spicetify.TippyProps,
            content: `Copy Lyrics`,
          });
        }
        copyLyricsButton.addEventListener("click", async () => {
          try {
            const copied = await copyCurrentLyricsToClipboard();
            Spicetify.showNotification(copied ? "Lyrics copied" : "No lyrics to copy", !copied);
          } catch (err) {
            controlsLogger.warn("Failed to copy lyrics", err);
            Spicetify.showNotification("Failed to copy lyrics", true);
          }
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Copy Lyrics tooltip", err);
      }
    }

    const settingsButton = elem.querySelector("#SettingsToggle");
    if (settingsButton && !isPip) {
      try {
        Tooltips.Settings = Spicetify.Tippy(settingsButton, {
          ...Spicetify.TippyProps,
          content: `Spicy Lyrics Settings`,
        });
        settingsButton.addEventListener("click", () => {
          openSettingsPanel();
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Settings tooltip", err);
      }
    }

    const lyricsManagerButton = elem.querySelector("#LyricsManager");
    if (lyricsManagerButton && isTTMLMakerMode) {
      try {
        if (!isPip) {
          Tooltips.LyricsManager = Spicetify.Tippy(lyricsManagerButton, {
            ...Spicetify.TippyProps,
            content: `Lyrics Manager`,
          });
        }
        lyricsManagerButton.addEventListener("click", () => {
          if (IsPIP) {
            globalThis.focus();
          }
          
          OpenLyricsDBPanel();
        });
      } catch (err) {
        controlsLogger.warn("Failed to setup Lyrics Manager tooltip", err);
      }
    }
  }
}

// --- Reactive setting subscriptions ---

let processingSettingsRevision = 0;
let appliedProcessingSettingsRevision = 0;
let processingSettingsRefreshRunning = false;

const reprocessCurrentLyricsFromSource = async (): Promise<void> => {
  if (!PageContainer || !PageView.IsOpened) return;
  const uri = SpotifyPlayer.GetUri();
  const trackId = SpotifyPlayer.GetId();
  if (!uri) return;
  const lyricsContent = PageContainer.querySelector(".LyricsContainer .LyricsContent");
  lyricsContent?.classList.add("HiddenTransitioned");
  invalidateLyricsPipeline();
  invalidateAIRefinementBaseline(uri);
  $currentLyricsData.set("");
  if (trackId) await LyricsStore.RemoveItem(trackId).catch(() => {});
  const lyrics = await fetchLyrics(uri);
  await ApplyLyrics(lyrics);
};

const runQueuedProcessingSettingsRefresh = async (): Promise<void> => {
  if (processingSettingsRefreshRunning) return;
  processingSettingsRefreshRunning = true;
  try {
    while (appliedProcessingSettingsRevision < processingSettingsRevision) {
      const targetRevision = processingSettingsRevision;
      await reprocessCurrentLyricsFromSource();
      appliedProcessingSettingsRevision = targetRevision;
    }
  } catch (error) {
    pageLogger.warn("Failed to reprocess lyrics after a Chinese setting changed", error);
    appliedProcessingSettingsRevision = processingSettingsRevision;
  } finally {
    processingSettingsRefreshRunning = false;
    if (appliedProcessingSettingsRevision < processingSettingsRevision) {
      void runQueuedProcessingSettingsRefresh();
    } else {
      setTimeout(() => {
        AppendViewControls(true);
        triggerRemeasureLV();
        PageContainer?.querySelector(".LyricsContainer .LyricsContent")?.classList.remove("HiddenTransitioned");
      }, 60);
    }
  }
};

const queueProcessingSettingsRefresh = (): void => {
  if (!PageContainer || !PageView.IsOpened) return;
  processingSettingsRevision += 1;
  void runQueuedProcessingSettingsRefresh();
};

$simpleLyricsMode.listen((v) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("SimpleLyricsMode", v);
  const uri = SpotifyPlayer.GetUri();
  $currentLyricsData.set("");
  if (uri) fetchLyrics(uri).then(ApplyLyrics);
});

$minimalLyricsMode.listen((v) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("MinimalLyricsMode", v);
  const uri = SpotifyPlayer.GetUri();
  $currentLyricsData.set("");
  if (uri) fetchLyrics(uri).then(ApplyLyrics);
});

// Pure CSS toggles; no lyrics reprocessing required.
$lineHoverBackground.listen((v) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("NoLineHoverBackground", !v);
});

$showVolumeSlider.listen((v) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("ShowVolumeSlider", v);
});

onExperimentChange(() => {
  if (!PageContainer) return;
  ApplyExperimentClasses(PageContainer);
  AppendViewControls(true);
});

$meaningBackend.listen(() => {
  syncAIRefinementBackends();
  queueProcessingSettingsRefresh();
  if (PageContainer) AppendViewControls(true);
});

$soundBackend.listen(() => {
  syncAIRefinementBackends();
  if (PageContainer) AppendViewControls(true);
});

$soundTargetOrthography.listen(() => aiSoundCoordinator.notifyConfigChanged());

$lyricsSourceOrder.listen(queueProcessingSettingsRefresh);
$lyricsSelectionMode.listen(queueProcessingSettingsRefresh);

$skipSpicyFont.listen((v) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("UseSpicyFont", !v);
  applySystemFontStack();
});

$systemFontStack.listen(() => applySystemFontStack());

$viewControlsPosition.listen((v) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("ViewControlsPosition_Top", v === "Top");
  PageContainer.classList.toggle("ViewControlsPosition_Bottom", v === "Bottom");
  AppendViewControls(true);
});

$flatViewControls.listen((v) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("FlatViewControls", v);
});

$showChineseTranslitButton.listen(() => {
  if (!PageContainer) return;
  AppendViewControls(true);
});

$chineseCharacterForm.listen(queueProcessingSettingsRefresh);
$chineseTranslitMode.listen(queueProcessingSettingsRefresh);
$chineseTones.listen(queueProcessingSettingsRefresh);
$joinMandarinWords.listen(queueProcessingSettingsRefresh);
$translationTargetLang.listen(() => {
  aiRefinementCoordinator.notifyConfigChanged();
  queueProcessingSettingsRefresh();
});

const rerenderCurrentLyrics = async () => {
  if (!PageContainer) return;
  const raw = $currentLyricsData.get();
  if (raw && !raw.startsWith("NO_LYRICS:")) {
    try {
      await ApplyLyrics([JSON.parse(raw), 200]);
      setTimeout(() => triggerRemeasureLV(), 60);
      return;
    } catch (error) {
      pageLogger.warn("Failed to rerender cached lyrics", error);
    }
  }

  const uri = SpotifyPlayer.GetUri();
  if (uri) fetchLyrics(uri).then(async (lyrics) => {
    await ApplyLyrics(lyrics);
    setTimeout(() => triggerRemeasureLV(), 60);
  });
};

$japaneseReadingMode.listen(() => {
  rerenderCurrentLyrics();
});

$fixHanGlyphVariants.listen((enabled) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("FixHanGlyphVariants", enabled);
  applySystemFontStack();
  rerenderCurrentLyrics();
});

$adaptiveSectioning.listen((enabled) => {
  if (!PageContainer) return;
  PageContainer.classList.toggle("AdaptiveSectioning", enabled);
  rerenderCurrentLyrics();
});

window.addEventListener("spicy-lyrics:processing-ready", ((event: CustomEvent) => {
  const trackId = event.detail?.trackId;
  if (trackId && trackId !== SpotifyPlayer.GetId()) return;
  ApplyLyrics([event.detail.lyrics, 200]).then(() => {
    AppendViewControls(true);
    setTimeout(() => triggerRemeasureLV(), 60);
  });
}) as EventListener);

aiRefinementCoordinator.subscribe((trackUri) => {
  if (trackUri === SpotifyPlayer.GetUri() && PageContainer) AppendViewControls(true);
});

aiSoundCoordinator.subscribe((trackUri) => {
  if (trackUri === SpotifyPlayer.GetUri() && PageContainer) AppendViewControls(true);
});

$ttmlMakerMode.listen(() => {
  if (!PageContainer) return;
  AppendViewControls(true);
})

export default PageView;
