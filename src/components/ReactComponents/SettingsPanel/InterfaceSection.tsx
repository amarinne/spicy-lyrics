import { useStore } from "@nanostores/react";
import {
  $lockedMediaBox,
  $popupLyricsAllowed,
  $timelineOutsideMediaContent,
  $viewControlsPosition,
} from "../../../utils/stores.ts";
import { $flatViewControls, $isGlobalNav, $prefetchNextLyrics } from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Interface";
const vcPositionOptions = ["Top", "Bottom"];

interface Props {
  query: string;
  sectionFilter: string;
}

export default function InterfaceSection({ query, sectionFilter }: Props) {
  const lockedMediaBox = useStore($lockedMediaBox);
  const popupLyricsAllowed = useStore($popupLyricsAllowed);
  const viewControlsPosition = useStore($viewControlsPosition);
  const timelineOutsideMediaContent = useStore($timelineOutsideMediaContent);
  const isGlobalNav = useStore($isGlobalNav);
  const flatViewControls = useStore($flatViewControls);
  const prefetchNextLyrics = useStore($prefetchNextLyrics);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r2 = matches(query, "Lock Media Box Size in Compact Mode", "Prevent the media box from resizing when Forced Compact Mode is active.");
  const r3 = matches(query, "Disable Popup Lyrics Window", "Prevent lyrics from opening in a floating popup window.");
  const r4 = matches(query, "Lyrics Controls Position", "Where the lyrics view controls (play, scroll, etc.) appear.");
  const r5 = matches(query, "Timeline Outside Media Box", "Display the playback timeline outside the media box, in the NowBar header. Stays inside the media box in Compact Mode or PIP.");
  const r6 = matches(query, "Flat Controls (No Liquid Glass)", "Use flat lyrics control buttons instead of liquid-glass buttons.");
  const r7 = matches(query, "Prefetch Next Lyrics", "Fetch and process upcoming track lyrics before the song changes.");

  if (!r2 && !r3 && !r4 && !r5 && !r6 && !r7) return null;

  return (
    <>
      <SectionTitle>Interface</SectionTitle>

      {r2 && (
        <Row
          label="Lock Media Box Size in Compact Mode"
          description="Prevent the media box from resizing when Forced Compact Mode is active."
        >
          <Toggle checked={lockedMediaBox} onChange={(v) => $lockedMediaBox.set(v)} />
        </Row>
      )}

      {r3 && (
        <Row label="Disable Popup Lyrics Window" description="Prevent lyrics from opening in a floating popup window.">
          <Toggle
            checked={!popupLyricsAllowed}
            onChange={(v) => $popupLyricsAllowed.set(!v)}
          />
        </Row>
      )}

      {r4 && (
        <Row
          label="View Controls Position"
          description="Where the view controls (play, scroll, etc.) appear."
          disabled={!isGlobalNav}
          disabledReason="Only available in Spotify's new navigation layout"
        >
          <Select
            value={viewControlsPosition}
            options={vcPositionOptions}
            onChange={(v) => $viewControlsPosition.set(v)}
          />
        </Row>
      )}

      {r5 && (
        <Row
          label="Timeline Outside Media Box"
          description="Display the playback timeline outside the media box, in the NowBar header. Stays inside the media box in Compact Mode or PIP."
        >
          <Toggle
            checked={timelineOutsideMediaContent}
            onChange={(v) => $timelineOutsideMediaContent.set(v)}
          />
        </Row>
      )}

      {r6 && (
        <Row label="Flat Controls (No Liquid Glass)" description="Use flat lyrics control buttons instead of liquid-glass buttons.">
          <Toggle checked={flatViewControls} onChange={(v) => $flatViewControls.set(v)} />
        </Row>
      )}

      {r7 && (
        <Row label="Prefetch Next Lyrics" description="Fetch and process upcoming track lyrics before the song changes.">
          <Toggle checked={prefetchNextLyrics} onChange={(v) => $prefetchNextLyrics.set(v)} />
        </Row>
      )}
    </>
  );
}
