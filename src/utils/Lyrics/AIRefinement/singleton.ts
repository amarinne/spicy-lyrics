import { $currentLyricsData, $aiConsentVersion, $aiRefinementEnabled, $aiOpenAIBaseUrl, $aiSelectedModelDescriptorsByProvider, $aiSelectedProvider, $aiSteeringInstructions, $meaningBackend } from "../../stores.ts";
import { SpotifyPlayer } from "../../../components/Global/SpotifyPlayer.ts";
import { AI_CONSENT_VERSION, loadProviderCredential } from "./Credentials.ts";
import { AIRefinementCoordinator } from "./Coordinator.ts";
import { IndexedDBRefinementCache } from "./IndexedDBCache.ts";
import { ensurePersistence } from "../../db.ts";
import { GeminiRefinementProvider } from "./GeminiProvider.ts";
import { normalizeOpenAIBaseUrl, OpenAIRefinementProvider } from "./OpenAIProvider.ts";
import type { ProviderId, RefinementProvider } from "./types.ts";

export const geminiRefinementProvider = new GeminiRefinementProvider();
export const openAIRefinementProvider = new OpenAIRefinementProvider();

function selectedProvider(): ProviderId { return $aiSelectedProvider.get() === "openai" ? "openai" : "gemini"; }
function providerFor(providerId: string): RefinementProvider | null {
  if (providerId === "gemini") return geminiRefinementProvider;
  if (providerId === "openai") return openAIRefinementProvider;
  return null;
}
function selectedDescriptor(providerId: ProviderId): any | null {
  try {
    const byProvider = JSON.parse($aiSelectedModelDescriptorsByProvider.get());
    return JSON.parse(byProvider?.[providerId] ?? "");
  } catch { return null; }
}

export const aiRefinementCoordinator = new AIRefinementCoordinator({
  cache: new IndexedDBRefinementCache(),
  getProvider: providerFor,
  getTrackLabel: (trackUri) => {
    if (SpotifyPlayer.GetUri() !== trackUri) return undefined;
    const name = SpotifyPlayer.GetName();
    const artists = SpotifyPlayer.GetArtists()?.map((artist) => artist.name).filter(Boolean).join(", ");
    return [name, artists].filter(Boolean).join(" — ") || undefined;
  },
  getConfig: async () => {
    const providerId = selectedProvider();
    const model = selectedDescriptor(providerId);
    if (!model?.name || !model?.inputTokenLimit || !model?.outputTokenLimit) return null;
    const secret = $aiConsentVersion.get() === AI_CONSENT_VERSION ? await loadProviderCredential(providerId) : null;
    let endpoint: string | undefined;
    if (providerId === "openai") {
      try { endpoint = normalizeOpenAIBaseUrl($aiOpenAIBaseUrl.get()); } catch { return null; }
      openAIRefinementProvider.setBaseUrl(endpoint);
    }
    return { providerId, providerVersion: providerId === "gemini" ? "v1beta" : "openai-compatible-v1", endpoint, model, targetLang: (await import("../lyrics.ts")).translationTargetLang, instructions: $aiSteeringInstructions.get(), credential: secret ? { secret } : null };
  },
  publish: (trackUri, document, origin) => {
    if (SpotifyPlayer.GetUri() !== trackUri) return;
    $currentLyricsData.set(JSON.stringify(document));
    window.dispatchEvent(new CustomEvent("spicy-lyrics:processing-ready", { detail: { trackUri, trackId: trackUri.split(":")[2], lyrics: document, origin } }));
  },
  ensurePersistence,
});

aiRefinementCoordinator.setMode($meaningBackend.get() === "ai_auto" ? "auto" : "on_demand");
aiRefinementCoordinator.setEnabled($meaningBackend.get() !== "google" && $aiRefinementEnabled.get());
