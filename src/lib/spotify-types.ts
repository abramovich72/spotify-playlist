import type { TrackInput } from "@/lib/import-file";

export type SpotifyTrackSummary = {
  name: string;
  uri: string;
  artists: { name: string }[];
  album?: {
    name: string;
    release_date?: string;
  };
};

type TrackMatchBase = {
  rowNumber: number;
  requested: TrackInput;
};

export type TrackMatch =
  | (TrackMatchBase & {
      status: "matched";
      match: SpotifyTrackSummary;
    })
  | (TrackMatchBase & {
      status: "not_found";
    })
  | (TrackMatchBase & {
      status: "ambiguous";
      candidateKind: "exact" | "suggestions";
      candidates: SpotifyTrackSummary[];
    });

export type SpotifyPlaylistSummary = {
  id: string;
  name: string;
  owner: string;
  public: boolean | null;
};
