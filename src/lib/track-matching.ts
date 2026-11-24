import type { TrackInput } from "@/lib/import-file";
import type { SpotifyTrackSummary, TrackMatch } from "@/lib/spotify-types";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function baseTrackTitle(value: string) {
  return normalize(value)
    .replace(/\s*(?:[-–—]\s*|\(\s*|\[\s*)(?:live\b|unplugged\b|in concert\b).*$/, "")
    .trim();
}

function isLiveVersion(candidate: SpotifyTrackSummary) {
  const title = normalize(candidate.name);
  const album = normalize(candidate.album?.name ?? "");

  return (
    /(?:[-–—]\s*live\b|[([]\s*live\b|\blive\s+(?:at|from|in|on)\b|\bunplugged\b|\bin concert\b)/.test(title) ||
    /\b(?:live|unplugged|concert)\b/.test(album)
  );
}

function hasRequestedArtist(candidate: SpotifyTrackSummary, artist: string) {
  return candidate.artists.some(
    (candidateArtist) => normalize(candidateArtist.name) === normalize(artist),
  );
}

function matchesRequestedTitle(candidate: SpotifyTrackSummary, track: string) {
  const requestedTitle = normalize(track);
  return (
    normalize(candidate.name) === requestedTitle ||
    (isLiveVersion(candidate) && baseTrackTitle(candidate.name) === requestedTitle)
  );
}

function candidateScore(
  candidate: SpotifyTrackSummary,
  requested: TrackInput,
) {
  const normalizedTitle = normalize(candidate.name);
  const requestedTitle = normalize(requested.track);
  let score = hasRequestedArtist(candidate, requested.artist) ? 20 : 0;

  if (matchesRequestedTitle(candidate, requested.track)) {
    score += 100;
  } else if (
    normalizedTitle.includes(requestedTitle) ||
    requestedTitle.includes(normalizedTitle)
  ) {
    score += 30;
  }

  if (isLiveVersion(candidate)) {
    score += 10;
  }

  return score;
}

function prioritizeCandidates(
  candidates: SpotifyTrackSummary[],
  requested: TrackInput,
) {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        candidateScore(right.candidate, requested) -
          candidateScore(left.candidate, requested) ||
        left.index - right.index,
    )
    .map(({ candidate }) => candidate);
}

export function classifyTrackCandidates(
  requested: TrackInput,
  rowNumber: number,
  candidates: SpotifyTrackSummary[],
): TrackMatch {
  const prioritizedCandidates = prioritizeCandidates(candidates, requested);
  const exactMatches = prioritizedCandidates.filter(
    (candidate) =>
      matchesRequestedTitle(candidate, requested.track) &&
      hasRequestedArtist(candidate, requested.artist),
  );

  if (exactMatches.length === 1) {
    return {
      rowNumber,
      requested,
      status: "matched",
      match: exactMatches[0],
    };
  }

  if (exactMatches.length > 1) {
    return {
      rowNumber,
      requested,
      status: "ambiguous",
      candidateKind: "exact",
      candidates: exactMatches.slice(0, 5),
    };
  }

  if (candidates.length > 0) {
    return {
      rowNumber,
      requested,
      status: "ambiguous",
      candidateKind: "suggestions",
      candidates: prioritizedCandidates.slice(0, 5),
    };
  }

  return { rowNumber, requested, status: "not_found" };
}

export function getRecommendedTrackSelections(matches: TrackMatch[]) {
  return Object.fromEntries(
    matches.flatMap((match) =>
      match.status === "ambiguous" && match.candidates.length > 0
        ? [[match.rowNumber, match.candidates[0].uri]]
        : [],
    ),
  );
}
