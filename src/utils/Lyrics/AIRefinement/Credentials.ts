import { dbPromise, ObjectStores } from "../../db.ts";
import { utf8Bytes } from "./identity.ts";

export const AI_CONSENT_VERSION = 2;
export type CredentialProviderId = "gemini" | "openai";

function assertProviderId(providerId: string): asserts providerId is CredentialProviderId {
  if (providerId !== "gemini" && providerId !== "openai") throw new TypeError("invalid_provider");
}

export async function loadProviderCredential(providerId: CredentialProviderId): Promise<string | null> {
  assertProviderId(providerId);
  const value = await (await dbPromise).get(ObjectStores.AICredentials, providerId);
  return typeof value?.secret === "string" ? value.secret : null;
}
export async function saveProviderCredential(providerId: CredentialProviderId, secret: string): Promise<void> {
  assertProviderId(providerId);
  if (!secret || utf8Bytes(secret) > 512) throw new RangeError("credential_too_large");
  await (await dbPromise).put(ObjectStores.AICredentials, { secret }, providerId);
}
export async function deleteProviderCredential(providerId: CredentialProviderId): Promise<void> {
  assertProviderId(providerId);
  await (await dbPromise).delete(ObjectStores.AICredentials, providerId);
}

export const loadGeminiCredential = () => loadProviderCredential("gemini");
export const saveGeminiCredential = (secret: string) => saveProviderCredential("gemini", secret);
export const deleteGeminiCredential = () => deleteProviderCredential("gemini");
