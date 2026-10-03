import { useStore } from "@nanostores/react";
import React from "react";
import {
  $animationFpsCap,
  $animationFpsCapEnabled,
  $fixHanGlyphVariants,
  $skipSpicyFont,
  $systemFontStack,
} from "../../../utils/stores.ts";
import { matches, Row, SectionTitle, Slider, Toggle } from "./components.tsx";

const SECTION_NAME = "Appearance";

const FPS_CAP_DESCRIPTION =
  "Limit how often the lyrics, the animated background and the scroll glide are redrawn. Lower values use less CPU, especially on high refresh rate displays. Turn off to redraw on every display refresh.";
const FPS_SLIDER_DESCRIPTION = "Frames per second while the cap is on.";

interface Props {
  query: string;
  sectionFilter: string;
}

export default function AppearanceSection({ query, sectionFilter }: Props) {
  const fpsCapEnabled = useStore($animationFpsCapEnabled);
  const fpsCap = useStore($animationFpsCap);
  const skipSpicyFont = useStore($skipSpicyFont);
  const systemFontStack = useStore($systemFontStack);
  const fixHanGlyphVariants = useStore($fixHanGlyphVariants);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(query, "Use Default Font", "Disable the custom Spicy Lyrics font and fall back to your root font.");
  const r2 = matches(query, "Font Family Stack", "Choose installed fonts in fallback order.");
  const r3 = matches(query, "Fix Han Glyph Variants", "Prefer language-appropriate Japanese and Chinese glyph forms.");

  const r4 = matches(query, "Limit Animation Frame Rate", FPS_CAP_DESCRIPTION);
  const r5 = fpsCapEnabled && matches(query, "Animation Frame Rate", FPS_SLIDER_DESCRIPTION);

  if (!r1 && !r2 && !r3 && !r4 && !r5) return null;

  return (
    <>
      <SectionTitle>Appearance</SectionTitle>

      {r1 && (
        <Row
          label="Use System Font"
          description="Disable the custom Spicy Lyrics font and fall back to your system font."
        >
          <Toggle checked={skipSpicyFont} onChange={(v) => $skipSpicyFont.set(v)} />
        </Row>
      )}

      {r2 && (
        <Row
          label="Font Family Stack"
          description="Comma-separated installed fonts, tried from left to right."
          disabled={!skipSpicyFont}
          disabledReason="Enable Use System Font first."
        >
          <input
            className="sl-sp-text-input"
            value={systemFontStack}
            onChange={(event) => $systemFontStack.set(event.currentTarget.value)}
            placeholder={'"Inter", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", sans-serif'}
            spellCheck={false}
            disabled={!skipSpicyFont}
          />
        </Row>
      )}

      {r3 && (
        <Row
          label="Fix Han Glyph Variants"
          description="Prefer Noto Sans JP, SC, or TC according to each lyric line."
        >
          <Toggle
            checked={fixHanGlyphVariants}
            onChange={(value) => $fixHanGlyphVariants.set(value)}
          />
        </Row>
      )}
      {r4 && (
        <Row label="Limit Animation Frame Rate" description={FPS_CAP_DESCRIPTION}>
          <Toggle checked={fpsCapEnabled} onChange={(v) => $animationFpsCapEnabled.set(v)} />
        </Row>
      )}

      {r5 && (
        <Row
          label="Animation Frame Rate"
          description={FPS_SLIDER_DESCRIPTION}
          stacked
        >
          <Slider
            value={fpsCap}
            min={15}
            max={240}
            step={5}
            defaultValue={60}
            unit="FPS"
            onChange={(v) => $animationFpsCap.set(v)}
          />
        </Row>
      )}
    </>
  );
}
