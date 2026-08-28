import { openLyricsSourcePicker } from "../../../openLyricsSourcePicker.tsx";
import { resolveLyricsSourceLabel } from "../../LyricsSourcePreferences.ts";

export function ApplyLyricsProvider(data: any, LyricsContainer: HTMLElement): void {
  if (!data?.source || !LyricsContainer) return;

  const isLocal = data.source === "ldb";
  const ProviderElement = document.createElement(isLocal ? "div" : "button");
  ProviderElement.classList.add("LyricsProvider");
  const providerLabel = resolveLyricsSourceLabel(data.source, data.sourceDisplayName, data.fetchProvider) ?? "Unknown";
  ProviderElement.textContent = `Source: ${providerLabel}`;
  if (!isLocal) {
    const button = ProviderElement as HTMLButtonElement;
    button.type = "button";
    button.title = "Change lyrics source";
    button.addEventListener("click", () => openLyricsSourcePicker());
  }
  LyricsContainer.appendChild(ProviderElement);
}
