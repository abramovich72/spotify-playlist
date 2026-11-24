import { NextResponse } from "next/server";

import {
  getSpotifySession,
  getValidAccessToken,
  readSpotifyConfiguration,
  SpotifyApiError,
  SpotifyAuthError,
  spotifyApiRequest,
} from "@/lib/spotify-session";

type ImportRequest = {
  playlist:
    | { type: "new"; name: string }
    | { type: "existing"; id: string };
  trackUris: string[];
};

function isImportRequest(value: unknown): value is ImportRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const body = value as Record<string, unknown>;

  if (!Array.isArray(body.trackUris) || body.trackUris.length === 0 || body.trackUris.length > 1000) {
    return false;
  }

  if (
    !body.trackUris.every(
      (uri) => typeof uri === "string" && /^spotify:track:[A-Za-z0-9]+$/.test(uri),
    )
  ) {
    return false;
  }

  if (typeof body.playlist !== "object" || body.playlist === null) {
    return false;
  }

  const playlist = body.playlist as Record<string, unknown>;

  return (
    (playlist.type === "new" &&
      typeof playlist.name === "string" &&
      playlist.name.trim().length > 0 &&
      playlist.name.trim().length <= 100) ||
    (playlist.type === "existing" &&
      typeof playlist.id === "string" &&
      /^[A-Za-z0-9]+$/.test(playlist.id))
  );
}

function spotifyErrorResponse(error: unknown) {
  if (error instanceof SpotifyAuthError || error instanceof SpotifyApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  throw error;
}

export async function POST(request: Request) {
  const result = readSpotifyConfiguration();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const session = await getSpotifySession(result.config);

  try {
    const accessToken = await getValidAccessToken(session, result.config);

    if (!accessToken) {
      return NextResponse.json({ error: "Connect Spotify before importing songs." }, { status: 401 });
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: "The import request is not valid JSON." }, { status: 400 });
      }

      throw error;
    }

    if (!isImportRequest(body)) {
      return NextResponse.json(
        { error: "Choose a playlist and at least one valid Spotify track." },
        { status: 400 },
      );
    }

    let playlistId: string;
    let playlistName: string;

    if (body.playlist.type === "new") {
      const createdPlaylist = await spotifyApiRequest("/me/playlists", accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: body.playlist.name.trim(),
          public: false,
          description: "Created with Spotify Playlist Importer",
        }),
      });

      if (
        typeof createdPlaylist !== "object" ||
        createdPlaylist === null ||
        typeof (createdPlaylist as Record<string, unknown>).id !== "string"
      ) {
        throw new SpotifyApiError("Spotify returned an invalid playlist response.", 502);
      }

      playlistId = (createdPlaylist as { id: string }).id;
      playlistName = body.playlist.name.trim();
    } else {
      playlistId = body.playlist.id;
      playlistName = "Selected playlist";
    }

    let added = 0;

    try {
      for (let index = 0; index < body.trackUris.length; index += 100) {
        const batch = body.trackUris.slice(index, index + 100);
        await spotifyApiRequest(`/playlists/${playlistId}/items`, accessToken, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uris: batch }),
        });
        added += batch.length;
      }
    } catch (error) {
      if (error instanceof SpotifyApiError) {
        return NextResponse.json(
          {
            error: `Spotify added ${added} of ${body.trackUris.length} songs. The playlist may contain a partial import.`,
            playlistId,
            added,
            total: body.trackUris.length,
          },
          { status: error.status },
        );
      }

      throw error;
    }

    return NextResponse.json({
      playlistId,
      playlistName,
      added,
    });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
