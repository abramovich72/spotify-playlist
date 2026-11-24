import { NextResponse } from "next/server";

import {
  exchangeSpotifyCode,
  getSpotifySession,
  readSpotifyConfiguration,
  SpotifyAuthError,
} from "@/lib/spotify-session";

function homeWithAuthResult(request: Request, result: string, reason?: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("auth", result);

  if (reason) {
    url.searchParams.set("reason", reason);
  }

  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const result = readSpotifyConfiguration();

  if (!result.ok) {
    return homeWithAuthResult(request, "configuration-error");
  }

  const { config } = result;
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const session = await getSpotifySession(config);

  if (providerError) {
    session.oauthState = undefined;
    await session.save();
    return homeWithAuthResult(request, "denied");
  }

  if (!code || !state || !session.oauthState || state !== session.oauthState) {
    session.oauthState = undefined;
    await session.save();
    return homeWithAuthResult(request, "invalid-state");
  }

  session.oauthState = undefined;

  try {
    const token = await exchangeSpotifyCode(code, config);
    session.accessToken = token.access_token;
    session.refreshToken = token.refresh_token;
    session.expiresAt = Date.now() + token.expires_in * 1000;
    await session.save();
    return homeWithAuthResult(request, "connected");
  } catch (error) {
    if (error instanceof SpotifyAuthError) {
      await session.save();
      return homeWithAuthResult(
        request,
        "failed",
        error.code ?? String(error.status),
      );
    }

    throw error;
  }
}
