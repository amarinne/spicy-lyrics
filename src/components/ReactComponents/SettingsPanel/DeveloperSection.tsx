import { useStore } from "@nanostores/react";
import React from "react";
import { $developerMode } from "../../../utils/stores.ts";
import { SPICY_LYRICS_BUILD_MARKER } from "../../../utils/buildMarker.ts";
import { matches, Row, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Developer";

interface Props {
  query: string;
  sectionFilter: string;
}

export default function DeveloperSection({ query, sectionFilter }: Props) {
  const developerMode = useStore($developerMode);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(query, "Developer Mode", "Enable extra logging and debug utilities.");
  const r2 = matches(query, "Build Marker", SPICY_LYRICS_BUILD_MARKER);

  if (!r1 && !r2) return null;

  return (
    <>
      <SectionTitle>Developer</SectionTitle>

      {r1 && (
        <Row label="Developer Mode" description="Enable extra logging and debug utilities.">
          <Toggle checked={developerMode} onChange={(v) => $developerMode.set(v)} />
        </Row>
      )}

      {r2 && (
        <Row label="Build Marker" description={SPICY_LYRICS_BUILD_MARKER}>
          <code>{SPICY_LYRICS_BUILD_MARKER}</code>
        </Row>
      )}
    </>
  );
}
