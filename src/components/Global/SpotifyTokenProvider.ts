/**
 * Pure Spotify access-token provider.
 *
 * This module owns no environment access: no `window`, `globalThis`, `Spicetify`,
 * DOM, timers, or console. All source reads go through the injected
 * `TokenSourceReaders`, and all time comes from the injected `now` clock, so the
 * provider is fully deterministic and testable without Spotify globals.
 *
 * Source preference:
 *   1. `Spicetify.Platform.AuthorizationAPI.getState()` (modern clients).
 *   2. The legacy Cosmos oauth resolver (`sp://oauth/v2/token`).
 *   3. `Spicetify.Platform.Session` (clients where the resolver is gone).
 *
 * Privacy: token text never appears in error messages, error types, diagnostic
 * helpers, or invalidation results. Only `getToken()` resolves with the token.
 */

/** A cached token is reusable until it is within this margin of expiring. */
export const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 30_000;

/** Shape returned by `Spicetify.Platform.AuthorizationAPI.getState()`. */
export type AuthorizationApiTokenState = {
  isAuthorized?: boolean;
  token?:
    | {
        accessToken?: string;
        accessTokenExpirationTimestampMs?: number;
        tokenType?: string;
        isAnonymous?: boolean;
      }
    | null
    | undefined;
};

/** Shape returned by the legacy Cosmos resolver at `sp://oauth/v2/token`. */
export type CosmosTokenResponse = {
  accessToken?: string;
  expiresAtTime?: number;
  tokenType?: string;
};

/** Shape of the token-bearing fields on `Spicetify.Platform.Session`. */
export type SessionTokenState = {
  accessToken?: string;
  accessTokenExpirationTimestampMs?: number;
};

/** Readers are injected; each may be synchronous or asynchronous. */
export type TokenSourceReaders = {
  readAuthorizationApiState?:
    | (() => AuthorizationApiTokenState | undefined | Promise<AuthorizationApiTokenState | undefined>)
    | undefined;
  readLegacyCosmosToken?:
    | (() => CosmosTokenResponse | undefined | Promise<CosmosTokenResponse | undefined>)
    | undefined;
  readSessionTokenState?:
    | (() => SessionTokenState | undefined | Promise<SessionTokenState | undefined>)
    | undefined;
};

export type TokenProviderDependencies = {
  /** Spotify token source readers, in preference order. */
  sources: TokenSourceReaders;
  /** Injected clock returning the current time in milliseconds since the epoch. */
  now: () => number;
};

/** Cache metadata that never includes token text. */
export type CachedTokenDescription = {
  hasToken: boolean;
  /** Milliseconds from `now` until expiry; `undefined` when unknown or uncached. */
  msUntilExpiry: number | undefined;
};

export type SpotifyTokenProvider = {
  /**
   * Resolve a usable Spotify access token. Valid cached state is returned
   * directly; otherwise concurrent callers share a single in-flight refresh.
   * Rejects with `SpotifyTokenAcquisitionError` when every source fails.
   */
  getToken: () => Promise<string>;
  /**
   * Drop the cached token and the in-flight refresh handle. Later callers force
   * a fresh read from the sources. Returns nothing and exposes no token text.
   */
  invalidate: () => void;
  /** Inspect cached-token presence and expiry without ever seeing token text. */
  describeCachedToken: () => CachedTokenDescription;
};

/** Raised when no token source yields a usable token. Never carries token text. */
export class SpotifyTokenAcquisitionError extends Error {
  constructor() {
    super("Unable to obtain a Spotify access token from any source");
    this.name = "SpotifyTokenAcquisitionError";
  }
}

/** A validated token candidate. Never leaves this module except via `getToken`. */
type NormalizedToken = {
  accessToken: string;
  /** `undefined` when a source reports no finite expiry; treated as usable. */
  expiresAtTime: number | undefined;
};

function normalizeExpiry(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createSpotifyTokenProvider(dependencies: TokenProviderDependencies): SpotifyTokenProvider {
  const { sources, now } = dependencies;

  let cachedToken: NormalizedToken | undefined;
  let inFlight: Promise<string> | undefined;
  /** Bumped by `invalidate` so pre-invalidation refreshes cannot repopulate the cache. */
  let cacheEpoch = 0;

  const isUsable = (token: NormalizedToken | undefined): token is NormalizedToken => {
    if (!token || !isNonEmptyString(token.accessToken)) return false;
    // Sources without a finite expiry stay usable; a later 401 drives refresh.
    if (token.expiresAtTime === undefined) return true;
    return token.expiresAtTime - now() > TOKEN_EXPIRY_SAFETY_MARGIN_MS;
  };

  /** Modern clients: the platform's own authorization store. */
  const readAuthorizationApi = async (): Promise<NormalizedToken | undefined> => {
    const reader = sources.readAuthorizationApiState;
    if (!reader) return undefined;

    const state = await reader();
    if (!state) return undefined;
    // Reject an explicitly unauthorized or anonymous state.
    if (state.isAuthorized === false) return undefined;
    if (state.token?.isAnonymous === true) return undefined;

    const accessToken = state.token?.accessToken;
    if (!isNonEmptyString(accessToken)) return undefined;

    // The modern state always carries an expiry; require a finite one that
    // clears the safety margin, otherwise treat the state as unusable.
    const expiresAtTime = normalizeExpiry(state.token?.accessTokenExpirationTimestampMs);
    if (expiresAtTime === undefined) return undefined;
    if (expiresAtTime - now() <= TOKEN_EXPIRY_SAFETY_MARGIN_MS) return undefined;

    return { accessToken, expiresAtTime };
  };

  /** Legacy clients: the Cosmos oauth resolver. */
  const readLegacyCosmos = async (): Promise<NormalizedToken | undefined> => {
    const reader = sources.readLegacyCosmosToken;
    if (!reader) return undefined;

    const response = await reader();
    const accessToken = response?.accessToken;
    if (!isNonEmptyString(accessToken)) return undefined;

    const expiresAtTime = normalizeExpiry(response?.expiresAtTime);
    if (expiresAtTime !== undefined && expiresAtTime - now() <= TOKEN_EXPIRY_SAFETY_MARGIN_MS) {
      return undefined;
    }

    return { accessToken, expiresAtTime };
  };

  /** Last resort: the session state, for clients without the oauth resolver. */
  const readSessionState = async (): Promise<NormalizedToken | undefined> => {
    const reader = sources.readSessionTokenState;
    if (!reader) return undefined;

    const session = await reader();
    const accessToken = session?.accessToken;
    if (!isNonEmptyString(accessToken)) return undefined;

    const expiresAtTime = normalizeExpiry(session?.accessTokenExpirationTimestampMs);
    if (expiresAtTime !== undefined && expiresAtTime - now() <= TOKEN_EXPIRY_SAFETY_MARGIN_MS) {
      return undefined;
    }

    return { accessToken, expiresAtTime };
  };

  const readSource = async (read: () => Promise<NormalizedToken | undefined>): Promise<NormalizedToken | undefined> => {
    // Source rejection is a fallback condition, never a hard failure.
    try {
      return await read();
    } catch {
      return undefined;
    }
  };

  const refresh = async (epochAtStart: number): Promise<string> => {
    const sourceReads = [readAuthorizationApi, readLegacyCosmos, readSessionState];

    for (const read of sourceReads) {
      const candidate = await readSource(read);
      if (candidate) {
        // Only a refresh that started at the current epoch may repopulate the
        // cache; an invalidation during flight must not be silently undone.
        if (epochAtStart === cacheEpoch) {
          cachedToken = candidate;
        }
        return candidate.accessToken;
      }
    }

    throw new SpotifyTokenAcquisitionError();
  };

  const getToken = (): Promise<string> => {
    if (isUsable(cachedToken)) {
      return Promise.resolve(cachedToken.accessToken);
    }
    // Drop expired state so a failed refresh cannot hand it back out.
    cachedToken = undefined;

    if (inFlight) {
      return inFlight;
    }

    const pending = refresh(cacheEpoch).finally(() => {
      // Clear the in-flight promise after success and after failure, so one
      // rejection can never poison later calls.
      if (inFlight === pending) {
        inFlight = undefined;
      }
    });
    inFlight = pending;
    return pending;
  };

  const invalidate = (): void => {
    cacheEpoch += 1;
    cachedToken = undefined;
    // New callers must not latch onto a pre-invalidation refresh.
    inFlight = undefined;
  };

  const describeCachedToken = (): CachedTokenDescription => {
    if (!cachedToken) {
      return { hasToken: false, msUntilExpiry: undefined };
    }
    return {
      hasToken: true,
      msUntilExpiry:
        cachedToken.expiresAtTime === undefined ? undefined : cachedToken.expiresAtTime - now(),
    };
  };

  return { getToken, invalidate, describeCachedToken };
}
