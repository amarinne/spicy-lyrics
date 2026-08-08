import { useStore } from "@nanostores/react";
import { $aiRefinementEnabled } from "../../../utils/stores.ts";
import AIRefinementSettings from "./AIRefinementSettings.tsx";
import { matches, Row, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "AI translation";

export default function AITranslationSection({ query, sectionFilter }: { query: string; sectionFilter: string }) {
  const enabled = useStore($aiRefinementEnabled);
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;
  const visible = matches(query, "AI translation", "Refine existing translations with AI.")
    || matches(query, "Provider")
    || matches(query, "API key")
    || matches(query, "API base URL")
    || matches(query, "Model")
    || matches(query, "Test connection");
  if (!visible) return null;
  return (
    <>
      <SectionTitle>AI translation</SectionTitle>
      <Row label="Refine translations with AI">
        <Toggle checked={enabled} onChange={(value) => $aiRefinementEnabled.set(value)} />
      </Row>
      <AIRefinementSettings />
    </>
  );
}
