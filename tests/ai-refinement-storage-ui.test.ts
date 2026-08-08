import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("IndexedDB v4 has isolated refinement, credential, and durable capture stores", () => {
  const source = read("src/utils/db.ts");
  assert.match(source, /openDB\("spicylyrics", 4/);
  assert.match(source, /AIRefinements: "aiRefinements"/);
  assert.match(source, /AICredentials: "aiCredentials"/);
  assert.match(source, /AICaptures: "aiCaptures"/);
  assert.match(source, /createIndex\("byTrackConfig", \["trackUri", "configId"\]\)/);
  assert.match(source, /createIndex\("byLastAccessedAt", "lastAccessedAt"\)/);
  assert.match(source, /createIndex\("byUpdatedAt", "updatedAt"\)/);
  assert.match(source, /createIndex\("byTrackUri", "trackUri"\)/);
});

test("credential UI edits in plaintext, confirms with a partial mask, and keeps provider keys separate", () => {
  const ui = read("src/components/ReactComponents/SettingsPanel/AIRefinementSettings.tsx");
  const credentials = read("src/utils/Lyrics/AIRefinement/Credentials.ts");
  assert.match(ui, /type="text"/);
  assert.match(ui, /slice\(0, 4\).*slice\(-4\)/s);
  assert.match(ui, /sl-ai-saved-key/);
  assert.match(ui, /autoComplete="off"/);
  assert.match(ui, /autoCorrect="off"/);
  assert.match(ui, /autoCapitalize="off"/);
  assert.match(ui, /spellCheck=\{false\}/);
  assert.match(ui, />Save<|>Save<\/button>/);
  assert.match(ui, /Test connection/);
  assert.match(ui, />Edit<\/button>/);
  assert.match(ui, /Delete/);
  assert.match(credentials, /utf8Bytes\(secret\) > 512/);
  assert.match(credentials, /providerId !== "gemini" && providerId !== "openai"/);
  assert.match(credentials, /ObjectStores\.AICredentials, providerId/);
  assert.match(ui, /OpenAI-compatible/);
  assert.match(ui, /API base URL/);
  assert.doesNotMatch(ui, /Start capture|Stop capture/);
  assert.match(ui, /Every paid refinement is saved locally, including lyric text/);
  assert.match(ui, /Save capture/);
  assert.match(ui, /Save all/);
  assert.match(ui, /downloadAllProviderCaptures/);
  assert.match(ui, /Choose where to save/);
  assert.match(read("src/utils/Lyrics/AIRefinement/DebugCapture.ts"), /showSaveFilePicker/);
  assert.match(ui, /View comparison/);
  assert.match(ui, /Saved comparisons/);
  assert.match(ui, /listProviderCaptures/);
  assert.match(ui, /selectProviderCapture/);
  assert.match(ui, /Delete selected/);
  assert.match(ui, /Delete all/);
  assert.match(ui, /trackLabel \?\? item\.trackUri/);
  assert.match(ui, /item\.model/);
  assert.match(ui, /item\.attempts/);
  assert.match(ui, /Google baseline/);
  assert.match(ui, /AI candidate/);
  assert.match(ui, /including lyric text/);
  assert.match(ui, /until explicitly deleted/);
  assert.match(ui, /System prompt/);
  assert.match(ui, /Saved AI results/);
  assert.match(ui, /probeControllerRef/);
  assert.match(ui, /configuration_changed/);
  assert.match(ui, /notifyCredentialChanged/);
  assert.match(ui, /HTTPS required/);
  assert.match(ui, /loadProviderCredential\(providerId\)/);
  const changeHandler = ui.match(/onChange=\{\(event\) => setDraft\(event\.currentTarget\.value\)\}/g) ?? [];
  assert.equal(changeHandler.length, 1);
  assert.doesNotMatch(ui, /onChange=.*saveProviderCredential/);
});

test("AI translation is a first-class settings section, not hidden in Experiments", () => {
  const panel = read("src/components/ReactComponents/SettingsPanel/ExperimentsPanel.tsx");
  const settings = read("src/components/ReactComponents/SettingsPanel/index.tsx");
  const experiments = read("src/utils/experiments.ts");
  assert.doesNotMatch(panel, /AIRefinementSettings/);
  assert.doesNotMatch(experiments, /aiRefinement/);
  assert.match(settings, /AITranslationSection/);
  assert.match(settings, /"AI translation"/);
});

test("key storage and cache clearing remain separated from normal settings and credentials", () => {
  const credentials = read("src/utils/Lyrics/AIRefinement/Credentials.ts");
  const cacheTools = read("src/utils/LyricsCacheTools.ts");
  assert.doesNotMatch(credentials, /LocalStorage|SL:settings|SL:uiState/);
  assert.match(credentials, /ObjectStores\.AICredentials/);
  assert.match(cacheTools, /aiRefinementCoordinator\.clearAll/);
  assert.doesNotMatch(cacheTools, /deleteGeminiCredential|AICredentials/);
});
