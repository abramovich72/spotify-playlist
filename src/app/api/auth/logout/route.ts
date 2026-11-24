import { NextResponse } from "next/server";

import {
  getSpotifySession,
  readSpotifyConfiguration,
} from "@/lib/spotify-session";

export async function POST() {
  const result = readSpotifyConfiguration();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const session = await getSpotifySession(result.config);
  session.destroy();
  return NextResponse.json({ connected: false });
}
