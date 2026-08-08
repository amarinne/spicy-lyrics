import { $currentLyricsData, $aiConsentVersion, $aiOpenAIBaseUrl, $aiSelectedModelDescriptorsByProvider, $aiSelectedProvider, $aiSteeringInstructions, $meaningBackend, $soundBackend, $soundSteeringInstructions, $soundTargetOrthography } from "../../stores.ts";
import { SpotifyPlayer } from "../../../components/Global/SpotifyPlayer.ts";
import { AI_CONSENT_VERSION, loadProviderCredential } from "./Credentials.ts";
import { AIRefinementCoordinator } from "./Coordinator.ts";
import { IndexedDBRefinementCache } from "./IndexedDBCache.ts";
import { ensurePersistence } from "../../db.ts";
import { GeminiRefinementProvider } from "./GeminiProvider.ts";
import { AIDerivedLayerComposer } from "./LayerComposer.ts";
import { normalizeOpenAIBaseUrl, OpenAIRefinementProvider } from "./OpenAIProvider.ts";
import type { CanonicalOriginalSnapshot, DerivedLayer, ProviderId, RefinementProvider } from "./types.ts";

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

function publishCurrent(trackUri: string, document: any, origin: "baseline" | "overlay"): void {
  if (SpotifyPlayer.GetUri() !== trackUri) return;
  $currentLyricsData.set(JSON.stringify(document));
  window.dispatchEvent(new CustomEvent("spicy-lyrics:processing-ready", { detail: { trackUri, trackId: trackUri.split(":")[2], lyrics: document, origin } }));
}

const cache = new IndexedDBRefinementCache();
const composer = new AIDerivedLayerComposer(publishCurrent);
let publicationRevision = 0;

async function getConfig(layer: DerivedLayer) {
  const providerId = selectedProvider();
  const model = selectedDescriptor(providerId);
  if (!model?.name || !model?.inputTokenLimit || !model?.outputTokenLimit) return null;
  let endpoint: string | undefined;
  if (providerId === "openai") {
    try { endpoint = normalizeOpenAIBaseUrl($aiOpenAIBaseUrl.get()); } catch { return null; }
    openAIRefinementProvider.setBaseUrl(endpoint);
  }
  return {
    providerId,
    providerVersion: providerId === "gemini" ? "v1beta" : "openai-compatible-v1",
    endpoint,
    model,
    targetLang: layer === "sound" ? $soundTargetOrthography.get() : (await import("../lyrics.ts")).translationTargetLang,
    instructions: layer === "sound" ? $soundSteeringInstructions.get() : $aiSteeringInstructions.get(),
  };
}

async function getCredential(providerId?: string) {
  if ($aiConsentVersion.get() !== AI_CONSENT_VERSION) return null;
  const id: ProviderId = providerId === "openai" ? "openai" : "gemini";
  const secret = await loadProviderCredential(id);
  return secret ? { secret } : null;
}

function coordinator(layer: DerivedLayer): AIRefinementCoordinator {
  return new AIRefinementCoordinator({
    layer,
    cache,
    getProvider: providerFor,
    getTrackLabel: (trackUri) => {
      if (SpotifyPlayer.GetUri() !== trackUri) return undefined;
      const name = SpotifyPlayer.GetName();
      const artists = SpotifyPlayer.GetArtists()?.map((artist) => artist.name).filter(Boolean).join(", ");
      return [name, artists].filter(Boolean).join(" — ") || undefined;
    },
    getConfig: () => getConfig(layer),
    getCredential,
    publish: (trackUri, document, origin, revision) => { composer.acceptLayerPublication(trackUri, layer, revision, document, origin); },
    ensurePersistence,
  });
}

export const aiRefinementCoordinator = coordinator("meaning");
export const aiSoundCoordinator = coordinator("sound");

export function acceptAIRefinementBaseline(trackUri: string, document: any, stage: "intermediate" | "final", snapshot: CanonicalOriginalSnapshot): void {
  const revision = ++publicationRevision;
  composer.acceptBaseline(trackUri, revision, document);
  aiRefinementCoordinator.acceptBaseline(trackUri, document, stage, snapshot, revision);
  aiSoundCoordinator.acceptBaseline(trackUri, document, stage, snapshot, revision);
}

export function onAIRefinementTrackChanged(trackUri: string | null): void {
  aiRefinementCoordinator.onTrackChanged(trackUri);
  aiSoundCoordinator.onTrackChanged(trackUri);
}

export function invalidateAIRefinementBaseline(trackUri: string): void {
  aiRefinementCoordinator.invalidateBaseline(trackUri);
  aiSoundCoordinator.invalidateBaseline(trackUri);
  composer.invalidate(trackUri);
}

export function getAIRefinementBaseline(trackUri: string): any | undefined { return composer.getBaseline(trackUri); }

export function notifyAIRefinementConfigChanged(): void {
  aiRefinementCoordinator.notifyConfigChanged();
  aiSoundCoordinator.notifyConfigChanged();
}

export function notifyAIRefinementCredentialChanged(): void {
  aiRefinementCoordinator.notifyCredentialChanged();
  aiSoundCoordinator.notifyCredentialChanged();
}

export async function clearAIRefinementTrack(trackUri: string): Promise<void> {
  await aiRefinementCoordinator.clearTrack(trackUri);
  await aiSoundCoordinator.clearTrack(trackUri);
}

export async function clearAllAIRefinements(): Promise<void> {
  await aiRefinementCoordinator.clearAll();
  await aiSoundCoordinator.clearAll();
}

export function syncAIRefinementBackends(): void {
  aiRefinementCoordinator.setMode($meaningBackend.get() === "ai_auto" ? "auto" : "on_demand");
  aiRefinementCoordinator.setEnabled($meaningBackend.get() !== "google");
  aiSoundCoordinator.setMode($soundBackend.get() === "ai_auto" ? "auto" : "on_demand");
  aiSoundCoordinator.setEnabled($soundBackend.get() !== "deterministic");
}

syncAIRefinementBackends();
