import { NextResponse } from "next/server";

import {
  getSpotifySession,
  getValidAccessToken,
  readSpotifyConfiguration,
  SpotifyApiError,
  SpotifyAuthError,
  spotifyApiRequest,
} from "@/lib/spotify-session";

const trackUriPattern = /^spotify:track:[A-Za-z0-9]+$/;

type SpotifyPlaylist = {
  id: string;
  name: string;
  snapshot_id: string;
  owner: { id: string };
};

function isSpotifyProfile(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string"
  );
}

function isSpotifyPlaylist(value: unknown): value is SpotifyPlaylist {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const playlist = value as Record<string, unknown>;
  const owner = playlist.owner;

  return (
    typeof playlist.id === "string" &&
    typeof playlist.name === "string" &&
    typeof playlist.snapshot_id === "string" &&
    typeof owner === "object" &&
    owner !== null &&
    typeof (owner as Record<string, unknown>).id === "string"
  );
}

function isPlaylistItemsPage(
  value: unknown,
): value is { items: unknown[]; total: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).items) &&
    typeof (value as Record<string, unknown>).total === "number"
  );
}

function spotifyErrorResponse(error: unknown) {
  if (error instanceof SpotifyAuthError || error instanceof SpotifyApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  throw error;
}

async function getOwnedPlaylist(accessToken: string, playlistId: string) {
  let profile: unknown;

  try {
    profile = await spotifyApiRequest("/me", accessToken);
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 403) {
      throw new SpotifyApiError(
        "יש לאשר גישה לפרופיל Spotify. נתקו את החשבון וחברו אותו מחדש.",
        403,
      );
    }

    throw error;
  }

  if (!isSpotifyProfile(profile)) {
    throw new SpotifyApiError("Spotify returned an invalid user profile.", 502);
  }

  const playlist = await spotifyApiRequest(
    `/playlists/${playlistId}?fields=id,name,snapshot_id,owner(id)`,
    accessToken,
  );

  if (!isSpotifyPlaylist(playlist)) {
    throw new SpotifyApiError("Spotify returned invalid playlist details.", 502);
  }

  if (playlist.owner.id !== profile.id) {
    throw new SpotifyApiError("ניתן לערוך רק פלייליסטים שבבעלות החשבון המחובר.", 403);
  }

  return playlist;
}

function parsePlaylistItem(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return { uri: null, name: "פריט לא זמין", artists: [] as string[] };
  }

  const itemRecord = value as Record<string, unknown>;
  const item = itemRecord.item ?? itemRecord.track;

  if (typeof item !== "object" || item === null) {
    return { uri: null, name: "פריט לא זמין", artists: [] as string[] };
  }

  const track = item as Record<string, unknown>;
  const artists = Array.isArray(track.artists)
    ? track.artists.flatMap((artist) => {
        if (
          typeof artist === "object" &&
          artist !== null &&
          typeof (artist as Record<string, unknown>).name === "string"
        ) {
          return [(artist as { name: string }).name];
        }

        return [];
      })
    : [];

  return {
    uri:
      typeof track.uri === "string" && trackUriPattern.test(track.uri)
        ? track.uri
        : null,
    name: typeof track.name === "string" ? track.name : "פריט לא זמין",
    artists,
  };
}

async function getAccessToken() {
  const result = readSpotifyConfiguration();

  if (!result.ok) {
    return { response: NextResponse.json({ error: result.error }, { status: 500 }) };
  }

  const session = await getSpotifySession(result.config);
  const accessToken = await getValidAccessToken(session, result.config);

  if (!accessToken) {
    return {
      response: NextResponse.json(
        { error: "Connect Spotify before editing playlists." },
        { status: 401 },
      ),
    };
  }

  return { accessToken };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playlistId = url.searchParams.get("id") ?? "";
  const offsetValue = url.searchParams.get("offset") ?? "0";
  const offset = Number(offsetValue);

  if (
    !/^[A-Za-z0-9]+$/.test(playlistId) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10_000
  ) {
    return NextResponse.json({ error: "Playlist ID or offset is invalid." }, { status: 400 });
  }

  const context = await getAccessToken();

  if ("response" in context) {
    return context.response;
  }

  try {
    const playlist = await getOwnedPlaylist(context.accessToken, playlistId);
    const payload = await spotifyApiRequest(
      `/playlists/${playlistId}/items?limit=50&offset=${offset}`,
      context.accessToken,
    );

    if (!isPlaylistItemsPage(payload)) {
      throw new SpotifyApiError("Spotify returned an invalid playlist item list.", 502);
    }

    return NextResponse.json({
      playlistId: playlist.id,
      playlistName: playlist.name,
      snapshotId: playlist.snapshot_id,
      items: payload.items.map(parsePlaylistItem),
      total: payload.total,
      offset,
      nextOffset: offset + payload.items.length,
    });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "The edit request is not valid JSON." }, { status: 400 });
    }

    throw error;
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Playlist edit request is invalid." }, { status: 400 });
  }

  const requestBody = body as Record<string, unknown>;
  const playlistId = requestBody.playlistId;
  const snapshotId = requestBody.snapshotId;
  const trackUris = requestBody.trackUris;

  if (
    typeof playlistId !== "string" ||
    !/^[A-Za-z0-9]+$/.test(playlistId) ||
    typeof snapshotId !== "string" ||
    snapshotId.length === 0 ||
    !Array.isArray(trackUris) ||
    trackUris.length === 0 ||
    trackUris.length > 10_000 ||
    !trackUris.every((uri) => typeof uri === "string" && trackUriPattern.test(uri))
  ) {
    return NextResponse.json(
      { error: "Keep at least one valid Spotify track in the playlist before saving." },
      { status: 400 },
    );
  }

  const context = await getAccessToken();

  if ("response" in context) {
    return context.response;
  }

  try {
    const playlist = await getOwnedPlaylist(context.accessToken, playlistId);

    if (playlist.snapshot_id !== snapshotId) {
      return NextResponse.json(
        { error: "הפלייליסט השתנה ב-Spotify מאז שנטען. טענו אותו מחדש לפני השמירה." },
        { status: 409 },
      );
    }

    let updated = 0;

    try {
      for (let index = 0; index < trackUris.length; index += 100) {
        const batch = trackUris.slice(index, index + 100);
        const method = index === 0 ? "PUT" : "POST";
        await spotifyApiRequest(`/playlists/${playlistId}/items`, context.accessToken, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uris: batch }),
        });
        updated += batch.length;
      }
    } catch (error) {
      if (error instanceof SpotifyApiError) {
        return NextResponse.json(
          {
            error: `Spotify updated ${updated} of ${trackUris.length} tracks. The playlist may contain a partial update.`,
            playlistId,
            updated,
            total: trackUris.length,
          },
          { status: error.status },
        );
      }

      throw error;
    }

    return NextResponse.json({
      playlistId,
      playlistName: playlist.name,
      updated,
    });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
