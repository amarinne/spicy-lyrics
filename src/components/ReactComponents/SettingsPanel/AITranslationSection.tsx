import AIRefinementSettings from "./AIRefinementSettings.tsx";
import { matches, SectionTitle } from "./components.tsx";

const SECTION_NAME = "AI Features";

export default function AITranslationSection({ query, sectionFilter }: { query: string; sectionFilter: string }) {
  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;
  const visible = matches(query, "AI Features", "Enable AI translation and pronunciation, configure providers, and choose button behavior.")
    || matches(query, "Provider")
    || matches(query, "API key")
    || matches(query, "API base URL")
    || matches(query, "Model")
    || matches(query, "Test connection")
    || matches(query, "Always use AI", "AI on demand")
    || matches(query, "Use existing pronunciation as AI baseline", "raw lyrics")
    || matches(query, "Translation & transliteration buttons", "Generate AI output, then toggle", "Toggle display only");
  if (!visible) return null;
  return (
    <>
      <SectionTitle>AI Features</SectionTitle>
      <AIRefinementSettings />
    </>
  );
}
