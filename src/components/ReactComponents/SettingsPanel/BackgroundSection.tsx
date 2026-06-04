import { useStore } from "@nanostores/react";
import React from "react";
import { $showNpvDynamicBg, $staticBackgroundMode } from "../../../utils/stores.ts";
import { $forceDarkBackground } from "../../../utils/uiState.ts";
import { matches, Row, Select, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Background";
const bgModeOptions = ["off", "auto", "artistHeader", "coverArt", "color"];
const bgModeLabels = ["Off", "Auto", "Artist Header", "Cover Art", "Color"];

interface Props {
  query: string;
  sectionFilter: string;
}

export default function BackgroundSection({ query, sectionFilter }: Props) {
  const staticBackgroundMode = useStore($staticBackgroundMode);
  const showNpvDynamicBg = useStore($showNpvDynamicBg);
  const forceDarkBackground = useStore($forceDarkBackground);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(query, "Static Background", "Pin the background to a fixed image or color instead of animating it.");
  const r2 = matches(query, "Display Dynamic Background in Now Playing View", "Show the animated background in the Now Playing panel.");
  const r3 = matches(query, "Force Dark Background", "Darken and desaturate bright dynamic background colors.");

  if (!r1 && !r2 && !r3) return null;

  return (
    <>
      <SectionTitle>Background</SectionTitle>

      {r1 && (
        <Row label="Static Background" description="Pin the background to a fixed image or color instead of animating it.">
          <Select
            value={staticBackgroundMode}
            options={bgModeOptions}
            labels={bgModeLabels}
            onChange={(v) => $staticBackgroundMode.set(v)}
          />
        </Row>
      )}

      {r2 && (
        <Row
          label="Display Dynamic Background in Now Playing View"
          description="Show the animated background in the Now Playing panel."
        >
          <Toggle checked={showNpvDynamicBg} onChange={(v) => $showNpvDynamicBg.set(v)} />
        </Row>
      )}

      {r3 && (
        <Row
          label="Force Dark Background"
          description="Darken and desaturate bright dynamic background colors."
        >
          <Toggle checked={forceDarkBackground} onChange={(v) => $forceDarkBackground.set(v)} />
        </Row>
      )}
    </>
  );
}
