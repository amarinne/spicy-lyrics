import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { SpotifyPlayer } from "../components/Global/SpotifyPlayer.ts";
import { PopupModal } from "../components/Modal.ts";
import { getTrackSourceOverride, serializeLyricsSourceOverrides, setTrackSourceOverride } from "./Lyrics/LyricsSourceOverrides.ts";
import type { TrackSourceOverride } from "./Lyrics/LyricsSourcePreferences.ts";
import { $currentLyricsData, $lyricsSourceOverrides } from "./stores.ts";

const choices: Array<{ value: TrackSourceOverride; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "spicy", label: "Spicy Lyrics" },
  { value: "spotify", label: "Spotify" },
  { value: "lrclib", label: "LRCLIB" },
];

export async function applyTrackSourceOverride(trackUri: string, override: TrackSourceOverride): Promise<void> {
  if (getTrackSourceOverride($lyricsSourceOverrides.get(), trackUri) === override) return;
  const updated = setTrackSourceOverride($lyricsSourceOverrides.get(), trackUri, override);
  $lyricsSourceOverrides.set(serializeLyricsSourceOverrides(updated));
  if (SpotifyPlayer.GetUri() !== trackUri) return;

  const [{ default: fetchLyrics, invalidateLyricsPipeline, LyricsStore }, { invalidateAIRefinementBaseline }, { default: ApplyLyrics }] = await Promise.all([
    import("./Lyrics/fetchLyrics.ts"),
    import("./Lyrics/AIRefinement/singleton.ts"),
    import("./Lyrics/Global/Applyer.ts"),
  ]);
  invalidateLyricsPipeline();
  invalidateAIRefinementBaseline(trackUri);
  $currentLyricsData.set("");
  const trackId = trackUri.split(":")[2];
  if (trackId) await LyricsStore.RemoveItem(trackId).catch(() => undefined);
  await ApplyLyrics(await fetchLyrics(trackUri));
}

function Picker({ trackUri }: { trackUri: string }) {
  const override = getTrackSourceOverride($lyricsSourceOverrides.get(), trackUri);
  let diagnostics: any = null;
  try {
    const current = JSON.parse($currentLyricsData.get());
    if (SpotifyPlayer.GetUri() === trackUri && current?.uri === trackUri) diagnostics = current?.SelectionDiagnostics ?? null;
  } catch {}
  return <div className="sl-lyrics-source-picker">
    <div className="sl-lyrics-source-options">
      {choices.map((choice) => <button
        type="button"
        className={override === choice.value ? "active" : ""}
        aria-pressed={override === choice.value}
        key={choice.value}
        onClick={() => {
          PopupModal.hide();
          void applyTrackSourceOverride(trackUri, choice.value);
        }}
      >{choice.label}</button>)}
    </div>
    {!!diagnostics?.candidates?.length && <div className="sl-lyrics-source-diagnostics">
      {diagnostics.candidates.map((candidate: any) => <div key={candidate.provider}>
        <span>{choices.find((choice) => choice.value === candidate.provider)?.label ?? candidate.provider}</span>
        <small>{candidate.rejected ? "Rejected" : `${candidate.selectionScore} score`} · {candidate.reasons?.join(" · ")}</small>
      </div>)}
    </div>}
  </div>;
}

export function openLyricsSourcePicker(): void {
  const trackUri = SpotifyPlayer.GetUri();
  if (!trackUri?.startsWith("spotify:track:")) return;
  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(<Picker trackUri={trackUri} />));
  PopupModal.display({ title: "Lyrics Source", content: container, onClose: () => root.unmount() });
}
