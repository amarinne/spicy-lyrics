import { toast } from "sonner";
import { dbPromise } from "./db";
import { LocalLyricsManager } from "./Lyrics/manager";
import { openSettingsPanel } from "./settings";
import { OpenLyricsDBPanel } from "./openLyricsDBPanel";
import { DeepFreeze } from "./utils";
import { triggerSpicyLyricsFakeUpdate } from "./version/CheckForUpdates";
import { SPICY_LYRICS_BUILD_MARKER } from "./buildMarker";

export function exposeToWindow() {
    (window as any).__spicyLyricsBuildMarker = SPICY_LYRICS_BUILD_MARKER;
    const api = {
        buildMarker: SPICY_LYRICS_BUILD_MARKER,
        panels: {
            settings: {
                open: () => openSettingsPanel(),
            },
            lyricsDB: {
                open: () => OpenLyricsDBPanel(),
            },
        },
        db: {
            dbPromise: dbPromise,
            objectStores: {
                lyricsStore: {
                    manager: LocalLyricsManager,
                }
            }
        },
        testing: {
            autoUpdate: {
                triggerFakeUpdate: triggerSpicyLyricsFakeUpdate,
            },
            toaster: toast,
        }
    };

    (window as any).SpicyLyrics = DeepFreeze(api);
}
