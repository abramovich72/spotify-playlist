import { NextResponse } from "next/server";

import {
  ImportFileError,
  MAX_IMPORT_FILE_BYTES,
  parseImportFile,
} from "@/lib/import-file";
import {
  getSpotifySession,
  getValidAccessToken,
  readSpotifyConfiguration,
  SpotifyApiError,
  SpotifyAuthError,
  spotifyApiRequest,
} from "@/lib/spotify-session";
import { classifyTrackCandidates } from "@/lib/track-matching";
import type { SpotifyTrackSummary, TrackMatch } from "@/lib/spotify-types";

type SpotifySearchResponse = {
  tracks: {
    items: SpotifyTrackSummary[];
  };
};

function isTrackSummary(value: unknown): value is SpotifyTrackSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const track = value as Record<string, unknown>;
  const album = track.album;

  return (
    typeof track.name === "string" &&
    typeof track.uri === "string" &&
    Array.isArray(track.artists) &&
    track.artists.every(
      (artist) =>
        typeof artist === "object" &&
        artist !== null &&
        typeof (artist as Record<string, unknown>).name === "string",
    ) &&
    (album === undefined ||
      (typeof album === "object" &&
        album !== null &&
        typeof (album as Record<string, unknown>).name === "string" &&
        ((album as Record<string, unknown>).release_date === undefined ||
          typeof (album as Record<string, unknown>).release_date === "string")))
  );
}

function isSearchResponse(value: unknown): value is SpotifySearchResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const tracks = (value as Record<string, unknown>).tracks;
  return (
    typeof tracks === "object" &&
    tracks !== null &&
    Array.isArray((tracks as Record<string, unknown>).items) &&
    (tracks as { items: unknown[] }).items.every(isTrackSummary)
  );
}

async function findMatch(
  requested: { artist: string; track: string },
  rowNumber: number,
  accessToken: string,
): Promise<TrackMatch> {
  async function searchTracks(queryText: string) {
    const query = new URLSearchParams({
      q: queryText,
      type: "track",
      limit: "10",
    });
    const payload = await spotifyApiRequest(`/search?${query}`, accessToken);

    if (!isSearchResponse(payload)) {
      throw new SpotifyApiError("Spotify returned an invalid track search response.", 502);
    }

    return payload.tracks.items;
  }

  let candidates = await searchTracks(
    `track:${requested.track} artist:${requested.artist}`,
  );

  if (candidates.length === 0) {
    candidates = await searchTracks(`track:${requested.track}`);
  }

  return classifyTrackCandidates(requested, rowNumber, candidates);
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
      return NextResponse.json({ error: "Connect Spotify before searching for songs." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose an Excel, CSV, or TXT file." }, { status: 400 });
    }

    if (file.size === 0 || file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: "Choose a non-empty file smaller than 10 MB." },
        { status: 400 },
      );
    }

    let tracks;

    try {
      tracks = await parseImportFile(file.name, Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof ImportFileError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }

    const matches: TrackMatch[] = new Array(tracks.length);
    let nextIndex = 0;
    const workerCount = Math.min(4, tracks.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < tracks.length) {
          const index = nextIndex;
          nextIndex += 1;
          matches[index] = await findMatch(tracks[index], index + 1, accessToken);
        }
      }),
    );

    return NextResponse.json({ matches });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
