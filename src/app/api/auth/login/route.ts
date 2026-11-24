import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import {
  getSpotifySession,
  readSpotifyConfiguration,
} from "@/lib/spotify-session";

const scopes = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-private",
];

export async function GET() {
  const result = readSpotifyConfiguration();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const { config } = result;
  const session = await getSpotifySession(config);
  const state = randomBytes(32).toString("hex");
  session.oauthState = state;
  await session.save();

  const authorizationUrl = new URL("https://accounts.spotify.com/authorize");
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: scopes.join(" "),
    state,
  }).toString();

  return NextResponse.redirect(authorizationUrl);
}
