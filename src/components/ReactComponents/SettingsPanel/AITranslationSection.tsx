import AIRefinementSettings from "./AIRefinementSettings.tsx";
import { matches, SectionTitle } from "./components.tsx";

const SECTION_NAME = "AI translation";

export default function AITranslationSection({ query, sectionFilter }: { query: string; sectionFilter: string }) {
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
      <AIRefinementSettings />
    </>
  );
}
