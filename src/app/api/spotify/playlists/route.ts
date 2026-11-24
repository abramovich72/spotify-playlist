import { NextResponse } from "next/server";

import {
  getSpotifySession,
  getValidAccessToken,
  readSpotifyConfiguration,
  SpotifyApiError,
  SpotifyAuthError,
  spotifyApiRequest,
} from "@/lib/spotify-session";
import type { SpotifyPlaylistSummary } from "@/lib/spotify-types";

type SpotifyPlaylistPage = {
  items: {
    id: string;
    name: string;
    public: boolean | null;
    owner: { id: string; display_name: string | null };
  }[];
  total: number;
};

type SpotifyProfile = {
  id: string;
};

function isPlaylistPage(value: unknown): value is SpotifyPlaylistPage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    typeof page.total === "number" &&
    page.items.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).name === "string" &&
        typeof (item as Record<string, unknown>).owner === "object" &&
        (item as { owner: Record<string, unknown> }).owner !== null &&
        typeof (item as { owner: Record<string, unknown> }).owner.id === "string",
    )
  );
}

function isSpotifyProfile(value: unknown): value is SpotifyProfile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string"
  );
}

function spotifyErrorResponse(error: unknown) {
  if (error instanceof SpotifyAuthError || error instanceof SpotifyApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  throw error;
}

export async function GET(request: Request) {
  const result = readSpotifyConfiguration();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const session = await getSpotifySession(result.config);

  try {
    const accessToken = await getValidAccessToken(session, result.config);

    if (!accessToken) {
      return NextResponse.json({ error: "Connect Spotify to load playlists." }, { status: 401 });
    }

    const offsetValue = new URL(request.url).searchParams.get("offset") ?? "0";
    const offset = Number(offsetValue);

    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
      return NextResponse.json({ error: "Playlist offset is invalid." }, { status: 400 });
    }

    let profilePayload: unknown;

    try {
      profilePayload = await spotifyApiRequest("/me", accessToken);
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 403) {
        throw new SpotifyApiError(
          "כדי לסנן לפלייליסטים שבבעלותך, נתקו את חשבון Spotify וחברו אותו מחדש כדי לאשר גישה לפרופיל.",
          403,
        );
      }

      throw error;
    }

    if (!isSpotifyProfile(profilePayload)) {
      throw new SpotifyApiError("Spotify returned an invalid user profile.", 502);
    }

    const payload = await spotifyApiRequest(
      `/me/playlists?limit=50&offset=${offset}`,
      accessToken,
    );

    if (!isPlaylistPage(payload)) {
      throw new SpotifyApiError("Spotify returned an invalid playlist list.", 502);
    }

    const playlists: SpotifyPlaylistSummary[] = payload.items
      .filter((playlist) => playlist.owner.id === profilePayload.id)
      .map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        owner: playlist.owner.display_name ?? "Spotify user",
        public: playlist.public,
      }));

    return NextResponse.json({
      items: playlists,
      total: payload.total,
      offset,
      nextOffset: offset + payload.items.length,
    });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
