import "server-only";

import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

export type SpotifySessionData = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  oauthState?: string;
};

export type SpotifyConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionPassword: string;
};

export type ConfigurationResult =
  | { ok: true; config: SpotifyConfiguration }
  | { ok: false; error: string };

export function readSpotifyConfiguration(): ConfigurationResult {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  const sessionPassword = process.env.SESSION_PASSWORD;

  if (!clientId || !clientSecret || !redirectUri) {
    return {
      ok: false,
      error: "Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI.",
    };
  }

  if (/^(your-|replace-with-|paste-)/i.test(clientId) || /^(your-|replace-with-|paste-)/i.test(clientSecret)) {
    return {
      ok: false,
      error: "Replace the sample Spotify Client ID and Client Secret in .env.local.",
    };
  }

  if (redirectUri.startsWith("http://localhost")) {
    return {
      ok: false,
      error: "Spotify requires the loopback address http://127.0.0.1 for local redirects.",
    };
  }

  if (
    !sessionPassword ||
    sessionPassword.length < 32 ||
    /^(your-|replace-with-|paste-)/i.test(sessionPassword)
  ) {
    return {
      ok: false,
      error: "SESSION_PASSWORD must be set to a random value of at least 32 characters.",
    };
  }

  return {
    ok: true,
    config: { clientId, clientSecret, redirectUri, sessionPassword },
  };
}

export async function getSpotifySession(
  config: SpotifyConfiguration,
): Promise<IronSession<SpotifySessionData>> {
  return getIronSession<SpotifySessionData>(await cookies(), {
    cookieName: "spotify-playlist-session",
    password: config.sessionPassword,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  });
}

export class SpotifyAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type SpotifyTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

function isTokenResponse(value: unknown): value is SpotifyTokenResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const token = value as Record<string, unknown>;

  return (
    typeof token.access_token === "string" &&
    typeof token.expires_in === "number" &&
    (token.refresh_token === undefined || typeof token.refresh_token === "string")
  );
}

export async function exchangeSpotifyCode(
  code: string,
  config: SpotifyConfiguration,
): Promise<SpotifyTokenResponse> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await response.text();
    let spotifyErrorCode: string | undefined;

    try {
      const errorPayload: unknown = JSON.parse(responseText);

      if (
        typeof errorPayload === "object" &&
        errorPayload !== null &&
        typeof (errorPayload as Record<string, unknown>).error === "string"
      ) {
        spotifyErrorCode = (errorPayload as { error: string }).error;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }

    throw new SpotifyAuthError(
      "Spotify authorization failed. Please check the app settings and try again.",
      response.status,
      spotifyErrorCode,
    );
  }

  const payload: unknown = await response.json();

  if (!isTokenResponse(payload)) {
    throw new SpotifyAuthError("Spotify returned an invalid token response.", 502);
  }

  return payload;
}

export async function getValidAccessToken(
  session: IronSession<SpotifySessionData>,
  config: SpotifyConfiguration,
): Promise<string | null> {
  if (
    session.accessToken &&
    session.expiresAt &&
    session.expiresAt > Date.now() + 60_000
  ) {
    return session.accessToken;
  }

  if (!session.refreshToken) {
    return null;
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    session.accessToken = undefined;
    session.refreshToken = undefined;
    session.expiresAt = undefined;
    await session.save();
    throw new SpotifyAuthError("Spotify session expired. Connect your account again.", 401);
  }

  const payload: unknown = await response.json();

  if (!isTokenResponse(payload)) {
    throw new SpotifyAuthError("Spotify returned an invalid token response.", 502);
  }

  session.accessToken = payload.access_token;
  session.refreshToken = payload.refresh_token ?? session.refreshToken;
  session.expiresAt = Date.now() + payload.expires_in * 1000;
  await session.save();

  return session.accessToken;
}

export async function spotifyApiRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new SpotifyApiError(
      `Spotify API request failed (${response.status}).`,
      response.status,
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}
