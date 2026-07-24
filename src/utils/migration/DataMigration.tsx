import React from "react";
import { flushSync } from "react-dom";
import ReactDOM from "react-dom/client";
import { PopupModal } from "../../components/Modal.ts";
import { SETTINGS_KEY } from "../stores.ts";
import { UI_STATE_KEY } from "../uiState.ts";

const OLD_PREFIX = "SpicyLyrics-";

const OLD_SETTINGS_KEYS = [
  "simpleLyricsMode",
  "simpleLyricsModeRenderingType",
  "minimalLyricsMode",
  "lockedMediaBox",
  "viewControlsPosition",
  "settingsOnTop",
  "developerMode",
];

const OLD_SETTINGS_KEY_RENAMES: Record<string, string> = {
  "skip-spicy-font": "skipSpicyFont",
};

const OLD_UI_STATE_KEYS = [
  "IsNowBarOpen",
  "NowBarSide",
  "ForceCompactMode",
  "romanization",
  "fromVersion",
  "lastFetchedUri",
  "previous-version",
];

const OLD_UI_STATE_KEY_RENAMES: Record<string, string> = {
  "IsNowBarOpen": "isNowBarOpen",
  "NowBarSide": "nowBarSide",
  "ForceCompactMode": "forceCompactMode",
  "previous-version": "previousVersion",
};

function readOld(key: string): any {
  const raw = Spicetify.LocalStorage.get(`${OLD_PREFIX}${key}`);
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function hasAnyOldKey(): boolean {
  for (const key of OLD_SETTINGS_KEYS) {
    if (Spicetify.LocalStorage.get(`${OLD_PREFIX}${key}`) !== null) return true;
  }
  for (const key of Object.keys(OLD_SETTINGS_KEY_RENAMES)) {
    if (Spicetify.LocalStorage.get(`${OLD_PREFIX}${key}`) !== null) return true;
  }
  for (const key of OLD_UI_STATE_KEYS) {
    if (Spicetify.LocalStorage.get(`${OLD_PREFIX}${key}`) !== null) return true;
  }
  if (
    Spicetify.LocalStorage.get(`${OLD_PREFIX}disablePopupLyrics`) !== null ||
    Spicetify.LocalStorage.get(`${OLD_PREFIX}devMode`) !== null ||
    Spicetify.LocalStorage.get(`${OLD_PREFIX}staticBackground`) !== null ||
    Spicetify.LocalStorage.get(`${OLD_PREFIX}staticBackgroundType`) !== null
  ) return true;
  return false;
}

/**
 * Local fork migration policy: discard obsolete 5.x settings instead of
 * blocking startup behind an interactive migration prompt. Only legacy
 * SpicyLyrics-prefixed values are removed; Spotify and current SL:* data stay.
 */
function clearLegacy5xData(): void {
  const keys = new Set([
    ...OLD_SETTINGS_KEYS,
    ...Object.keys(OLD_SETTINGS_KEY_RENAMES),
    ...OLD_UI_STATE_KEYS,
    "disablePopupLyrics",
    "devMode",
    "staticBackground",
    "staticBackgroundType",
    "hide_npv_bg",
  ]);
  for (const key of keys) Spicetify.LocalStorage.remove(`${OLD_PREFIX}${key}`);
}

function initializeEmptyState(): void {
  Spicetify.LocalStorage.set(SETTINGS_KEY, JSON.stringify({}));
  Spicetify.LocalStorage.set(UI_STATE_KEY, JSON.stringify({}));
}

function migrateData() {
  const settings: Record<string, any> = {};
  for (const key of OLD_SETTINGS_KEYS) {
    const val = readOld(key);
    if (val !== undefined) settings[key] = val;
  }
  for (const [oldKey, newKey] of Object.entries(OLD_SETTINGS_KEY_RENAMES)) {
    const val = readOld(oldKey);
    if (val !== undefined) settings[newKey] = val;
  }
  // Merge old staticBackground (bool) + staticBackgroundType (string) into staticBackgroundMode
  const oldStaticBg = readOld("staticBackground");
  const oldStaticBgType = readOld("staticBackgroundType");
  if (oldStaticBg !== undefined || oldStaticBgType !== undefined) {
    if (!oldStaticBg) {
      settings["staticBackgroundMode"] = "off";
    } else {
      const typeMap: Record<string, string> = {
        "Auto": "auto",
        "Artist Header Visual": "artistHeader",
        "Cover Art": "coverArt",
        "Color": "color",
      };
      settings["staticBackgroundMode"] = typeMap[oldStaticBgType] ?? "auto";
    }
  }

  // showNpvDynamicBg is the inverse of the old hide_npv_bg key
  const oldHideNpvBg = readOld("hide_npv_bg");
  if (oldHideNpvBg !== undefined) {
    settings["showNpvDynamicBg"] = !oldHideNpvBg;
  }

  // popupLyricsAllowed is the inverse of the old disablePopupLyrics key
  const disablePopup = readOld("disablePopupLyrics");
  if (disablePopup !== undefined) {
    settings["popupLyricsAllowed"] = !disablePopup;
  }

  // ttmlMakerMode is on by default and no longer user-toggleable, so the old
  // "devMode" key is intentionally not migrated into it.

  const uiState: Record<string, any> = {};
  for (const key of OLD_UI_STATE_KEYS) {
    const val = readOld(key);
    if (val !== undefined) uiState[OLD_UI_STATE_KEY_RENAMES[key] ?? key] = val;
  }

  Spicetify.LocalStorage.set(SETTINGS_KEY, JSON.stringify(settings));
  Spicetify.LocalStorage.set(UI_STATE_KEY, JSON.stringify(uiState));
}

/**
 * Initialize current storage. Legacy 5.x values are deliberately discarded for
 * this local fork so redeploys cannot block on a stale migration prompt.
 */
export function needsMigration(): boolean {
  const hasNewKey = Spicetify.LocalStorage.get(SETTINGS_KEY) !== null;
  if (hasNewKey) return false;

  if (hasAnyOldKey()) clearLegacy5xData();
  initializeEmptyState();
  return false;
}

export function showMigrationModal() {
  const div = document.createElement("div");
  const reactRoot = ReactDOM.createRoot(div);

  function renderMigrate() {
    flushSync(() => {
      reactRoot.render(
        <div className="update-card-wrapper migration-card">
          <div className="udc-icon-wrap">
            <svg className="udc-migrate-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <ellipse cx="12" cy="5" rx="8" ry="3" stroke="currentColor" strokeWidth="1.75"/>
              <path d="M4 5v5c0 1.657 3.582 3 8 3s8-1.343 8-3V5" stroke="currentColor" strokeWidth="1.75"/>
              <path d="M4 10v5c0 1.657 3.582 3 8 3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
              <path d="M16 17l2.5 2.5L22 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <h2 className="uc-title">Settings Migration Required</h2>
          <p className="uc-subtitle udc-desc">
            Spicy Lyrics has updated its storage format. Your existing settings need to be migrated before you can continue. This only happens once.
          </p>

          <div className="uc-divider" />

          <button
            className="btn-update"
            onClick={() => {
              migrateData();
              renderSuccess();
              setTimeout(() => location.reload(), 1000);
            }}
          >
            Migrate Settings
          </button>
        </div>
      );
    });
  }

  function renderSuccess() {
    flushSync(() => {
      reactRoot.render(
        <div className="update-card-wrapper migration-card">
          <div className="udc-icon-wrap">
            <svg className="udc-migrate-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ color: "#1db954" }}>
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <h2 className="uc-title">Migration Complete</h2>
          <p className="uc-subtitle udc-desc">
            Your settings have been migrated successfully. Reloading Spotify...
          </p>
        </div>
      );
    });
  }

  renderMigrate();

  PopupModal.display({
    title: "Spicy Lyrics",
    content: div,
    onClose: () => reactRoot.unmount(),
    closeBtn: false,
    closeOnOutsideClick: false,
  });
}
