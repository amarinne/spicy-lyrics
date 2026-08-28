import { useStore } from "@nanostores/react";
import React from "react";
import {
  $fixHanGlyphVariants,
  $skipSpicyFont,
  $systemFontStack,
} from "../../../utils/stores.ts";
import { matches, Row, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Appearance";

interface Props {
  query: string;
  sectionFilter: string;
}

export default function AppearanceSection({ query, sectionFilter }: Props) {
  const skipSpicyFont = useStore($skipSpicyFont);
  const systemFontStack = useStore($systemFontStack);
  const fixHanGlyphVariants = useStore($fixHanGlyphVariants);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(query, "Use Default Font", "Disable the custom Spicy Lyrics font and fall back to your root font.");
  const r2 = matches(query, "Font Family Stack", "Choose installed fonts in fallback order.");
  const r3 = matches(query, "Fix Han Glyph Variants", "Prefer language-appropriate Japanese and Chinese glyph forms.");

  if (!r1 && !r2 && !r3) return null;

  return (
    <>
      <SectionTitle>Appearance</SectionTitle>

      {r1 && (
        <Row label="Use System Font" description="Disable the custom Spicy Lyrics font and fall back to your system font.">
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
    </>
  );
}
