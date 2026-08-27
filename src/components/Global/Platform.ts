import {
  createSpotifyTokenProvider,
  type AuthorizationApiTokenState,
  type CosmosTokenResponse,
  type SessionTokenState,
} from "./SpotifyTokenProvider.ts";

// Spotify Types
/**
 * Shape of the modern authorization state exposed by
 * `Spicetify.Platform.AuthorizationAPI.getState()` on current clients.
 */
type AuthorizationApiHost = {
  AuthorizationAPI?: {
    getState?: () => unknown;
  } | undefined;
};

/**
 * Shape of the token-bearing fields on `Spicetify.Platform.Session`, used as
 * the last-resort fallback on clients without the oauth resolver.
 */
type SessionHost = {
  Session?: {
    accessToken?: string;
    accessTokenExpirationTimestampMs?: number;
  } | undefined;
};

// Store all our Spotify Services
const Spotify: typeof Spicetify = (globalThis as any).Spicetify;
let SpotifyPlatform: typeof Spicetify.Platform | undefined;
let SpotifyInternalFetch: typeof Spicetify.CosmosAsync | undefined;

const GetPlatformHost = (): (AuthorizationApiHost & SessionHost) | undefined => {
  return SpotifyPlatform as unknown as (AuthorizationApiHost & SessionHost) | undefined;
};

// Spotify Ready Promise
//
// Resolves once the Spotify platform object exists and at least one token
// source API is usable. The legacy Cosmos oauth resolver is never required
// when either the modern AuthorizationAPI or the Session fallback is
// available on the client.
const OnSpotifyReady = new Promise<void>((resolve) => {
  const CheckForServices = () => {
    SpotifyPlatform = Spotify.Platform;
    SpotifyInternalFetch = Spotify.CosmosAsync;

    if (!SpotifyPlatform) {
      requestAnimationFrame(() => setTimeout(CheckForServices, 0));
      return;
    }

    const host = GetPlatformHost();
    const hasAuthorizationApi = typeof host?.AuthorizationAPI?.getState === "function";
    const hasSession = Boolean(host?.Session);

    if (!hasAuthorizationApi && !SpotifyInternalFetch && !hasSession) {
      requestAnimationFrame(() => setTimeout(CheckForServices, 0));
      return;
    }

    resolve();
  };

  CheckForServices();
});

// Token source readers injected into the pure provider. Each reader returns
// `undefined` when its API is unavailable; the provider itself owns source
// preference, fallbacks, caching, single-flight refreshes and recovery after
// a failed lookup.
const ReadAuthorizationApiState = (): AuthorizationApiTokenState | undefined => {
  const authorizationApi = GetPlatformHost()?.AuthorizationAPI;
  if (typeof authorizationApi?.getState !== "function") {
    return undefined;
  }
  return authorizationApi.getState() as AuthorizationApiTokenState;
};

const ReadLegacyCosmosToken = (): CosmosTokenResponse | undefined | Promise<CosmosTokenResponse | undefined> => {
  return SpotifyInternalFetch?.get("sp://oauth/v2/token") as Promise<CosmosTokenResponse> | undefined;
};

const ReadSessionTokenState = (): SessionTokenState | undefined => {
  return GetPlatformHost()?.Session;
};

// Pure Spotify token provider wired over the live Spicetify services.
const TokenProvider = createSpotifyTokenProvider({
  now: Date.now,
  sources: {
    readAuthorizationApiState: ReadAuthorizationApiState,
    readLegacyCosmosToken: ReadLegacyCosmosToken,
    readSessionTokenState: ReadSessionTokenState,
  },
});

// Get Spotify Access Token Function
const GetSpotifyAccessToken = (): Promise<string> => TokenProvider.getToken();

// Drop the cached token and any in-flight refresh. Returns nothing and never
// exposes token text; the next call performs a fresh source read.
const InvalidateSpotifyAccessToken = (): void => TokenProvider.invalidate();

const Platform = {
  OnSpotifyReady,
  GetSpotifyAccessToken,
  InvalidateSpotifyAccessToken,
  get SpotifyVersion(): number[] {
    return Spicetify.Platform.version.split(".").map((i) => Number.parseInt(i, 10));
  }
};

export default Platform;
