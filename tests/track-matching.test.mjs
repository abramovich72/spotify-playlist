import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTrackCandidates,
  getRecommendedTrackSelections,
} from "../src/lib/track-matching.ts";

const requested = { artist: "The Cure", track: "Friday I'm in Love" };

function candidate(uri, name, artist, album) {
  return {
    name,
    uri,
    artists: [{ name: artist }],
    album: { name: album, release_date: "1992-01-01" },
  };
}

test("marks one exact title and artist as a safe match", () => {
  const exact = candidate("spotify:track:one", "Friday I'm in Love", "The Cure", "Wish");

  assert.deepEqual(classifyTrackCandidates(requested, 1, [exact]), {
    rowNumber: 1,
    requested,
    status: "matched",
    match: exact,
  });
});

test("returns exact duplicate versions for user review", () => {
  const versions = [
    candidate("spotify:track:studio", "Friday I'm in Love", "The Cure", "Wish"),
    candidate(
      "spotify:track:live",
      "Friday I'm in Love",
      "The Cure",
      "Show - Live at Wembley",
    ),
  ];

  assert.deepEqual(classifyTrackCandidates(requested, 2, versions), {
    rowNumber: 2,
    requested,
    status: "ambiguous",
    candidateKind: "exact",
    candidates: [versions[1], versions[0]],
  });
});

test("uses a single live version as a safe match when it is the only result", () => {
  const live = candidate(
    "spotify:track:live",
    "Friday I'm in Love (Live)",
    "The Cure",
    "Show",
  );

  assert.deepEqual(classifyTrackCandidates(requested, 3, [live]), {
    rowNumber: 3,
    requested,
    status: "matched",
    match: live,
  });
});

test("offers search suggestions when none exactly match", () => {
  const studio = candidate("spotify:track:suggestion", "Lovesong", "The Cure", "Disintegration");
  const live = candidate(
    "spotify:track:live-suggestion",
    "Lovesong - Live",
    "The Cure",
    "Live in Paris",
  );

  assert.deepEqual(classifyTrackCandidates(requested, 3, [studio]), {
    rowNumber: 3,
    requested,
    status: "ambiguous",
    candidateKind: "suggestions",
    candidates: [studio],
  });

  assert.deepEqual(
    classifyTrackCandidates(requested, 4, [studio, live]).candidates,
    [live, studio],
  );
});

test("marks a song not found when Spotify returns no candidates", () => {
  assert.deepEqual(classifyTrackCandidates(requested, 5, []), {
    rowNumber: 5,
    requested,
    status: "not_found",
  });
});

test("preselects the first recommended option for ambiguous songs", () => {
  const live = candidate("spotify:track:live", "Friday I'm in Love (Live)", "The Cure", "Live");
  const studio = candidate("spotify:track:studio", "Friday I'm in Love", "The Cure", "Wish");
  const ambiguous = classifyTrackCandidates(requested, 8, [studio, live]);

  assert.deepEqual(getRecommendedTrackSelections([ambiguous]), {
    8: "spotify:track:live",
  });
});
