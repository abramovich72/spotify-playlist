"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import type {
  SpotifyPlaylistSummary,
  TrackMatch,
} from "@/lib/spotify-types";
import { getRecommendedTrackSelections } from "@/lib/track-matching";

type PlaylistPage = {
  items: SpotifyPlaylistSummary[];
  total: number;
  offset: number;
  nextOffset: number;
};

type ImportResult = {
  playlistId: string;
  playlistName: string;
  added: number;
};

type EditablePlaylistTrack = {
  key: string;
  uri: string | null;
  name: string;
  artists: string[];
};

type PlaylistItemsPage = {
  playlistId: string;
  playlistName: string;
  snapshotId: string;
  items: Omit<EditablePlaylistTrack, "key">[];
  total: number;
  offset: number;
  nextOffset: number;
};

type PlaylistUpdateResult = {
  playlistId: string;
  playlistName: string;
  updated: number;
};

type CandidateOptionsProps = {
  match: Extract<TrackMatch, { status: "ambiguous" }>;
  selectedUri?: string;
  onChoose: (uri: string) => void;
  onSkip: () => void;
};

function CandidateOptions({
  match,
  selectedUri,
  onChoose,
  onSkip,
}: CandidateOptionsProps) {
  return (
    <div className="candidate-options" role="radiogroup" aria-label={`בחירת גרסה עבור ${match.requested.track}`}>
      <p className="candidate-prompt">
        {match.candidateKind === "exact"
          ? "נמצאו כמה גרסאות. בחרו את הגרסה הרצויה:"
          : "לא נמצאה התאמה מדויקת. בחרו הצעה או דלגו:"}
      </p>
      {match.candidates.map((candidate) => {
        const album = candidate.album?.name;
        const year = candidate.album?.release_date?.slice(0, 4);
        const details = [
          candidate.artists.map((artist) => artist.name).join(", "),
          album,
          year,
        ].filter(Boolean).join(" · ");

        return (
          <label
            className={`candidate-option ${selectedUri === candidate.uri ? "selected" : ""}`}
            key={candidate.uri}
          >
            <input
              type="radio"
              name={`candidate-${match.rowNumber}`}
              value={candidate.uri}
              checked={selectedUri === candidate.uri}
              onChange={() => onChoose(candidate.uri)}
            />
            <span className="candidate-radio" />
            <span className="candidate-copy">
              <strong>{candidate.name}</strong>
              <small>{details}</small>
            </span>
          </label>
        );
      })}
      <label className={`candidate-option candidate-skip ${!selectedUri ? "selected" : ""}`}>
        <input
          type="radio"
          name={`candidate-${match.rowNumber}`}
          value=""
          checked={!selectedUri}
          onChange={onSkip}
        />
        <span className="candidate-radio" />
        <span className="candidate-copy">
          <strong>דלג על השיר הזה</strong>
        </span>
      </label>
    </div>
  );
}

function errorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).error === "string"
  ) {
    return (payload as { error: string }).error;
  }

  return fallback;
}

function connectionErrorMessage(message: string) {
  if (message.includes("SPOTIFY_CLIENT_ID")) {
    return "כדי לחבר Spotify, הגדירו בקובץ .env.local את SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET ו-SPOTIFY_REDIRECT_URI. לאחר מכן הפעילו מחדש את השרת. הוראות מפורטות נמצאות ב-README.md.";
  }

  if (message.includes("SESSION_PASSWORD")) {
    return "חסר SESSION_PASSWORD תקין בקובץ .env.local. הגדירו מפתח אקראי באורך 32 תווים לפחות והפעילו מחדש את השרת.";
  }

  return message;
}

function isPlaylistPage(payload: unknown): payload is PlaylistPage {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    Array.isArray(value.items) &&
    typeof value.total === "number" &&
    typeof value.offset === "number" &&
    typeof value.nextOffset === "number"
  );
}

function isTrackMatch(value: unknown): value is TrackMatch {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const match = value as Record<string, unknown>;
  return (
    typeof match.rowNumber === "number" &&
    typeof match.requested === "object" &&
    match.requested !== null &&
    (match.status === "matched" ||
      match.status === "not_found" ||
      (match.status === "ambiguous" &&
        (match.candidateKind === "exact" || match.candidateKind === "suggestions") &&
        Array.isArray(match.candidates)))
  );
}

function isImportResult(payload: unknown): payload is ImportResult {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.playlistId === "string" &&
    typeof value.playlistName === "string" &&
    typeof value.added === "number"
  );
}

function isPlaylistItemsPage(payload: unknown): payload is PlaylistItemsPage {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.playlistId === "string" &&
    typeof value.playlistName === "string" &&
    typeof value.snapshotId === "string" &&
    typeof value.total === "number" &&
    typeof value.offset === "number" &&
    typeof value.nextOffset === "number" &&
    Array.isArray(value.items) &&
    value.items.every((item: unknown) => {
      if (typeof item !== "object" || item === null) {
        return false;
      }

      const track = item as Record<string, unknown>;
      return (
        (typeof track.uri === "string" || track.uri === null) &&
        typeof track.name === "string" &&
        Array.isArray(track.artists) &&
        track.artists.every((artist: unknown) => typeof artist === "string")
      );
    })
  );
}

function isPlaylistUpdateResult(payload: unknown): payload is PlaylistUpdateResult {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.playlistId === "string" &&
    typeof value.playlistName === "string" &&
    typeof value.updated === "number"
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("השרת החזיר תשובה לא תקינה.");
    }

    throw error;
  }
}

export default function Home() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [configurationReady, setConfigurationReady] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [inputSource, setInputSource] = useState<"file" | "paste">("file");
  const [pastedText, setPastedText] = useState("");
  const [pastedFormat, setPastedFormat] = useState<"txt" | "csv">("txt");
  const [matches, setMatches] = useState<TrackMatch[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<Record<number, boolean>>({});
  const [selectedCandidates, setSelectedCandidates] = useState<Record<number, string>>({});
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [playlistTotal, setPlaylistTotal] = useState(0);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [editingPlaylistId, setEditingPlaylistId] = useState("");
  const [editingPlaylistName, setEditingPlaylistName] = useState("");
  const [playlistSnapshotId, setPlaylistSnapshotId] = useState("");
  const [editablePlaylistTracks, setEditablePlaylistTracks] = useState<EditablePlaylistTrack[]>([]);
  const [loadingPlaylistTracks, setLoadingPlaylistTracks] = useState(false);
  const [loadedPlaylistTrackCount, setLoadedPlaylistTrackCount] = useState(0);
  const [playlistTrackTotal, setPlaylistTrackTotal] = useState(0);
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [draggedPlaylistTrackKey, setDraggedPlaylistTrackKey] = useState("");
  const [dragOverPlaylistTrackKey, setDragOverPlaylistTrackKey] = useState("");
  const [destination, setDestination] = useState<"new" | "existing">("new");
  const [playlistName, setPlaylistName] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [playlistUpdateResult, setPlaylistUpdateResult] = useState<PlaylistUpdateResult | null>(null);
  const nextTrackKey = useRef(0);
  const suggestedPlaylistName = useRef("");

  const matchedCount = useMemo(
    () => matches.filter((item) => item.status === "matched").length,
    [matches],
  );
  const reviewCount = useMemo(
    () => matches.filter((item) => item.status === "ambiguous").length,
    [matches],
  );
  const notFoundCount = useMemo(
    () => matches.filter((item) => item.status === "not_found").length,
    [matches],
  );
  const selectedCount = useMemo(
    () =>
      matches.filter(
        (item) =>
          (item.status === "matched" && selectedTracks[item.rowNumber]) ||
          (item.status === "ambiguous" && Boolean(selectedCandidates[item.rowNumber])),
      ).length,
    [matches, selectedTracks, selectedCandidates],
  );
  const canImport =
    connected === true &&
    selectedCount > 0 &&
    !importing &&
    !loadingPlaylistTracks &&
    (destination === "new"
      ? playlistName.trim().length > 0
      : selectedPlaylistId.length > 0);
  const hasUnsupportedPlaylistTracks = editablePlaylistTracks.some((track) => !track.uri);
  const canSavePlaylist =
    connected === true &&
    destination === "existing" &&
    editingPlaylistId === selectedPlaylistId &&
    Boolean(playlistSnapshotId) &&
    editablePlaylistTracks.length > 0 &&
    !hasUnsupportedPlaylistTracks &&
    !savingPlaylist &&
    !loadingPlaylistTracks;

  useEffect(() => {
    let active = true;

    async function initialize() {
      if (window.location.hostname === "localhost") {
        const canonicalUrl = new URL(window.location.href);
        canonicalUrl.hostname = "127.0.0.1";
        window.location.replace(canonicalUrl.toString());
        return;
      }

      const authResult = new URLSearchParams(window.location.search).get("auth");

      if (authResult === "connected") {
        setNotice("חשבון Spotify חובר בהצלחה.");
        window.history.replaceState({}, "", "/");
      } else if (authResult === "failed") {
        const reason = new URLSearchParams(window.location.search).get("reason");

        if (reason === "invalid_client") {
          setError("Spotify דחה את פרטי האפליקציה. בדקו שה-Client ID וה-Client Secret הועתקו נכון ל-.env.local.");
        } else if (reason === "invalid_grant") {
          setError("Spotify דחה את קוד ההרשאה. ודאו שה-Redirect URI זהה בדיוק ב-Dashboard וב-.env.local, ואז נסו שוב.");
        } else {
          setError("Spotify לא השלים את ההתחברות. בדקו את פרטי האפליקציה וה-Redirect URI ונסו שוב.");
        }

        window.history.replaceState({}, "", "/");
      } else if (authResult && authResult !== "configuration-error") {
        setError("התחברות Spotify לא הושלמה. אפשר לנסות שוב.");
        window.history.replaceState({}, "", "/");
      }

      try {
        const response = await fetch("/api/auth/status");
        const payload = await readJson(response);

        if (!response.ok) {
          throw new Error(errorMessage(payload, "לא ניתן לבדוק את חיבור Spotify."));
        }

        if (
          typeof payload !== "object" ||
          payload === null ||
          typeof (payload as Record<string, unknown>).connected !== "boolean"
        ) {
          throw new Error("השרת החזיר מצב התחברות לא תקין.");
        }

        const isConnected = (payload as { connected: boolean }).connected;

        if (!active) {
          return;
        }

        setConfigurationReady(true);
        setConnected(isConnected);

        if (isConnected) {
          await loadPlaylistPage(0, true, active);
        }
      } catch (loadError) {
        if (active) {
          const message =
            loadError instanceof Error ? loadError.message : "לא ניתן להתחבר לשירות.";
          setError(connectionErrorMessage(message));
          setConfigurationReady(false);
          setConnected(false);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    async function loadPlaylistPage(offset: number, reset: boolean, stillActive: boolean) {
      const response = await fetch(`/api/spotify/playlists?offset=${offset}`);
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "לא ניתן לטעון פלייליסטים."));
      }

      if (!isPlaylistPage(payload)) {
        throw new Error("השרת החזיר רשימת פלייליסטים לא תקינה.");
      }

      if (stillActive) {
        setPlaylists((current) => (reset ? payload.items : [...current, ...payload.items]));
        setPlaylistTotal(payload.total);
        setPlaylistOffset(payload.nextOffset);
        setSelectedPlaylistId((current) => current || payload.items[0]?.id || "");
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  async function loadMorePlaylists() {
    setLoadingPlaylists(true);
    setError("");

    try {
      const response = await fetch(`/api/spotify/playlists?offset=${playlistOffset}`);
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "לא ניתן לטעון פלייליסטים."));
      }

      if (!isPlaylistPage(payload)) {
        throw new Error("השרת החזיר רשימת פלייליסטים לא תקינה.");
      }

      setPlaylists((current) => [...current, ...payload.items]);
      setPlaylistTotal(payload.total);
      setPlaylistOffset(payload.nextOffset);
      setSelectedPlaylistId((current) => current || payload.items[0]?.id || "");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "לא ניתן לטעון פלייליסטים.",
      );
    } finally {
      setLoadingPlaylists(false);
    }
  }

  function cancelPlaylistEditing() {
    setEditingPlaylistId("");
    setEditingPlaylistName("");
    setPlaylistSnapshotId("");
    setEditablePlaylistTracks([]);
    setLoadedPlaylistTrackCount(0);
    setPlaylistTrackTotal(0);
  }

  async function loadPlaylistForEditing() {
    if (!selectedPlaylistId) {
      return;
    }

    setError("");
    setNotice("");
    setImportResult(null);
    setPlaylistUpdateResult(null);
    cancelPlaylistEditing();
    setLoadingPlaylistTracks(true);

    let offset = 0;
    let total = 0;
    let snapshotId = "";
    let playlistName = "";
    let firstPage = true;
    const loadedTracks: EditablePlaylistTrack[] = [];

    try {
      while (firstPage || offset < total) {
        const response = await fetch(
          `/api/spotify/playlist-items?id=${encodeURIComponent(selectedPlaylistId)}&offset=${offset}`,
        );
        const payload = await readJson(response);

        if (!response.ok) {
          throw new Error(errorMessage(payload, "לא ניתן לטעון את שירי הפלייליסט."));
        }

        if (!isPlaylistItemsPage(payload)) {
          throw new Error("Spotify החזיר רשימת שירים לא תקינה.");
        }

        if (payload.offset !== offset) {
          throw new Error("השרת החזיר עמוד לא צפוי של שירי הפלייליסט.");
        }

        if (firstPage) {
          snapshotId = payload.snapshotId;
          playlistName = payload.playlistName;
          total = payload.total;
          setPlaylistTrackTotal(total);
          firstPage = false;
        } else if (
          payload.snapshotId !== snapshotId ||
          payload.total !== total ||
          payload.playlistName !== playlistName
        ) {
          throw new Error("הפלייליסט השתנה בזמן הטעינה. נסו לטעון אותו מחדש.");
        }

        loadedTracks.push(
          ...payload.items.map((track, index) => ({
            ...track,
            key: `existing-${offset + index}`,
          })),
        );
        setLoadedPlaylistTrackCount(loadedTracks.length);

        if (payload.nextOffset <= offset && offset < total) {
          throw new Error("לא ניתן להמשיך לטעון את שירי הפלייליסט.");
        }

        offset = payload.nextOffset;
      }

      if (loadedTracks.length !== total) {
        throw new Error("לא כל שירי הפלייליסט נטענו. נסו שוב לפני העריכה.");
      }

      setEditingPlaylistId(selectedPlaylistId);
      setEditingPlaylistName(playlistName);
      setPlaylistSnapshotId(snapshotId);
      setEditablePlaylistTracks(loadedTracks);
      setNotice(`נטענו ${loadedTracks.length} שירים לעריכה. השינויים יישלחו ל-Spotify רק לאחר שמירה.`);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "לא ניתן לטעון את שירי הפלייליסט.",
      );
      setPlaylistTrackTotal(0);
    } finally {
      setLoadingPlaylistTracks(false);
    }
  }

  function addSelectedTracksToDraft() {
    const additions = matches.flatMap((item) => {
      if (item.status === "matched" && selectedTracks[item.rowNumber]) {
        return [{
          uri: item.match.uri,
          name: item.match.name,
          artists: item.match.artists.map((artist) => artist.name),
        }];
      }

      if (item.status === "ambiguous" && selectedCandidates[item.rowNumber]) {
        const candidate = item.candidates.find(
          (track) => track.uri === selectedCandidates[item.rowNumber],
        );

        if (candidate) {
          return [{
            uri: candidate.uri,
            name: candidate.name,
            artists: candidate.artists.map((artist) => artist.name),
          }];
        }
      }

      return [];
    });

    const seenUris = new Set(
      editablePlaylistTracks.flatMap((track) => track.uri ? [track.uri] : []),
    );
    const uniqueAdditions = additions.filter((track) => {
      if (seenUris.has(track.uri)) {
        return false;
      }

      seenUris.add(track.uri);
      return true;
    });

    if (uniqueAdditions.length === 0) {
      setNotice("כל השירים שנבחרו כבר נמצאים בפלייליסט.");
      return;
    }

    setEditablePlaylistTracks((current) => [
      ...current,
      ...uniqueAdditions.map((track) => ({
        ...track,
        key: `added-${nextTrackKey.current++}`,
      })),
    ]);
    setMatches([]);
    setSelectedTracks({});
    setSelectedCandidates({});
    setPlaylistUpdateResult(null);
    setNotice(`נוספו ${uniqueAdditions.length} שירים לרשימת העריכה. שמרו כדי לעדכן את Spotify.`);
  }

  function removePlaylistTrack(key: string) {
    setEditablePlaylistTracks((current) => current.filter((track) => track.key !== key));
    setPlaylistUpdateResult(null);
  }

  function reorderPlaylistTrack(draggedKey: string, targetKey: string, insertAfter: boolean) {
    if (draggedKey === targetKey) {
      return;
    }

    setEditablePlaylistTracks((current) => {
      const fromIndex = current.findIndex((track) => track.key === draggedKey);

      if (fromIndex < 0 || !current.some((track) => track.key === targetKey)) {
        return current;
      }

      const updated = [...current];
      const [draggedTrack] = updated.splice(fromIndex, 1);
      const targetIndex = updated.findIndex((track) => track.key === targetKey);

      if (targetIndex < 0) {
        return current;
      }

      updated.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedTrack);
      return updated;
    });
    setPlaylistUpdateResult(null);
  }

  async function savePlaylistEdits() {
    if (!canSavePlaylist) {
      return;
    }

    setError("");
    setNotice("");
    setSavingPlaylist(true);

    try {
      const response = await fetch("/api/spotify/playlist-items", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistId: editingPlaylistId,
          snapshotId: playlistSnapshotId,
          trackUris: editablePlaylistTracks
            .map((track) => track.uri)
            .filter((uri): uri is string => uri !== null),
        }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "לא ניתן לעדכן את הפלייליסט ב-Spotify."));
      }

      if (!isPlaylistUpdateResult(payload)) {
        throw new Error("Spotify החזיר אישור עדכון לא תקין.");
      }

      setPlaylistUpdateResult(payload);
      setNotice("הפלייליסט עודכן ב-Spotify.");
      cancelPlaylistEditing();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "לא ניתן לעדכן את הפלייליסט ב-Spotify.",
      );
    } finally {
      setSavingPlaylist(false);
    }
  }

  async function resolveTracks(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearImportResults();

    if (inputSource === "file" && !file) {
      setError("צריך לבחור קובץ לפני חיפוש השירים.");
      return;
    }

    if (inputSource === "paste" && !pastedText.trim()) {
      setError("צריך להדביק רשימת שירים לפני החיפוש.");
      return;
    }

    if (!connected) {
      setError("יש לחבר חשבון Spotify לפני חיפוש השירים.");
      return;
    }

    setResolving(true);

    try {
      const formData = new FormData();
      if (inputSource === "paste") {
        formData.append("file", new File([pastedText], `songs.${pastedFormat}`, { type: "text/plain" }));
      } else if (file) {
        formData.append("file", file);
      }
      const response = await fetch("/api/spotify/resolve", {
        method: "POST",
        body: formData,
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "לא ניתן לחפש את השירים."));
      }

      if (
        typeof payload !== "object" ||
        payload === null ||
        !Array.isArray((payload as Record<string, unknown>).matches) ||
        !(payload as { matches: unknown[] }).matches.every(isTrackMatch)
      ) {
        throw new Error("השרת החזיר תוצאות חיפוש לא תקינות.");
      }

      const resolved = (payload as { matches: TrackMatch[] }).matches;
      setMatches(resolved);
      setSelectedCandidates(getRecommendedTrackSelections(resolved));
      setSelectedTracks(
        Object.fromEntries(
          resolved
            .filter((item) => item.status === "matched")
            .map((item) => [item.rowNumber, true]),
        ),
      );
      setNotice(`נבדקו ${resolved.length} שירים. נא לעבור על התוצאות לפני הייבוא.`);
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : "לא ניתן לחפש את השירים.",
      );
    } finally {
      setResolving(false);
    }
  }

  async function importTracks() {
    if (!canImport) {
      return;
    }

    setError("");
    setNotice("");
    setImporting(true);

    try {
      const trackUris = matches.flatMap((item) => {
        if (item.status === "matched" && selectedTracks[item.rowNumber]) {
          return [item.match.uri];
        }

        if (item.status === "ambiguous" && selectedCandidates[item.rowNumber]) {
          return [selectedCandidates[item.rowNumber]];
        }

        return [];
      });
      const playlist =
        destination === "new"
          ? { type: "new" as const, name: playlistName.trim() }
          : { type: "existing" as const, id: selectedPlaylistId };
      const response = await fetch("/api/spotify/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlist, trackUris }),
      });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "Spotify לא הצליח להשלים את הייבוא."));
      }

      if (!isImportResult(payload)) {
        throw new Error("Spotify החזיר אישור ייבוא לא תקין.");
      }

      setImportResult(payload);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Spotify לא הצליח להשלים את הייבוא.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function disconnectSpotify() {
    setError("");

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const payload = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(payload, "לא ניתן לנתק את חשבון Spotify."));
      }

      setConnected(false);
      setPlaylists([]);
      setMatches([]);
      setSelectedTracks({});
      setSelectedCandidates({});
      setSelectedPlaylistId("");
      setPlaylistUpdateResult(null);
      cancelPlaylistEditing();
      setNotice("נותקת מחשבון Spotify.");
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : "לא ניתן לנתק את חשבון Spotify.",
      );
    }
  }

  function toggleTrack(rowNumber: number) {
    setSelectedTracks((current) => ({
      ...current,
      [rowNumber]: !current[rowNumber],
    }));
  }

  function chooseCandidate(rowNumber: number, uri: string) {
    setSelectedCandidates((current) => ({ ...current, [rowNumber]: uri }));
  }

  function skipCandidate(rowNumber: number) {
    setSelectedCandidates((current) => {
      const updated = { ...current };
      delete updated[rowNumber];
      return updated;
    });
  }

  function clearImportResults() {
    setMatches([]);
    setSelectedTracks({});
    setSelectedCandidates({});
    setImportResult(null);
    setPlaylistUpdateResult(null);
    setError("");
    setNotice("");
  }

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    if (nextFile) {
      const suggestion = nextFile.name
        .replace(/\.(xlsx|csv|txt)$/i, "")
        .replace(/[-_]+/g, " ")
        .trim()
        .slice(0, 100);

      if (suggestion && (!playlistName.trim() || playlistName === suggestedPlaylistName.current)) {
        setPlaylistName(suggestion);
        suggestedPlaylistName.current = suggestion;
      }
    }
    clearImportResults();
  }

  const hasMorePlaylists = playlistOffset < playlistTotal;
  const hasInput = inputSource === "file" ? Boolean(file) : Boolean(pastedText.trim());

  return (
    <main className="page-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Playlist Studio - דף הבית">
          <span className="brand-mark" aria-hidden="true">♫</span>
          <span>Playlist Studio</span>
        </Link>
        <span className="topbar-note">ייבוא פשוט. מוזיקה מוכנה.</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="live-dot" /> SPOTIFY PLAYLIST IMPORTER</span>
          <h1>הרשימה שלך.<br /><span>הפלייליסט שלך.</span></h1>
          <p>
            טוענים קובץ או מדביקים רשימת שירים, בודקים את ההתאמות, ובאישור אחד מעבירים אותם
            ל-Spotify.
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="hero-disc disc-one" />
          <span className="hero-disc disc-two" />
          <span className="hero-note">♫</span>
          <span className="hero-orbit" />
        </div>
      </section>

      <section className="workspace" aria-label="ייבוא שירים">
        <div className="workflow-heading">
          <div>
            <span className="section-kicker">מתחילים כאן</span>
            <h2>מייבאים את המוזיקה שלך</h2>
          </div>
          <div className={`connection-pill ${connected ? "is-connected" : ""}`}>
            <span className="connection-dot" />
            {loading ? "בודק חיבור" : connected ? "Spotify מחובר" : "Spotify לא מחובר"}
          </div>
        </div>

        {error && <div className="message message-error" role="alert">{error}</div>}
        {notice && <div className="message message-success" role="status">{notice}</div>}

        <div className="workflow-grid">
          <article className="panel import-panel">
            <div className="step-heading">
              <span className="step-number">01</span>
              <div>
                <h3>בחירת שירים</h3>
                <p>קובץ או רשימה מודבקת — עד 1,000 שירים</p>
              </div>
            </div>

            <form onSubmit={resolveTracks}>
              <fieldset className="source-options" disabled={resolving}>
                <legend>מקור השירים</legend>
                <label>
                  <input
                    type="radio"
                    name="input-source"
                    checked={inputSource === "file"}
                    onChange={() => {
                      setInputSource("file");
                      clearImportResults();
                    }}
                  />
                  טעינת קובץ
                </label>
                <label>
                  <input
                    type="radio"
                    name="input-source"
                    checked={inputSource === "paste"}
                    onChange={() => {
                      setInputSource("paste");
                      clearImportResults();
                    }}
                  />
                  הדבקת רשימה
                </label>
              </fieldset>

              {inputSource === "file" ? (
                <label
                  className="file-drop"
                  htmlFor="song-file"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!resolving) selectFile(event.dataTransfer.files[0] ?? null);
                  }}
                >
                  <span className="upload-icon" aria-hidden="true">↑</span>
                  <strong>{file ? file.name : "בוחרים קובץ או גוררים לכאן"}</strong>
                  <span>{file ? "אפשר לבחור קובץ אחר" : "XLSX, CSV או TXT · עד 10 MB"}</span>
                  <input
                    id="song-file"
                    type="file"
                    accept=".xlsx,.csv,.txt"
                    disabled={resolving}
                    onChange={(event) => {
                      selectFile(event.target.files?.[0] ?? null);
                    }}
                  />
                </label>
              ) : (
                <div className="paste-input">
                  <label className="field-label" htmlFor="paste-format">
                    פורמט הרשימה
                    <select
                      id="paste-format"
                      className="text-input"
                      value={pastedFormat}
                      disabled={resolving}
                      onChange={(event) => {
                        setPastedFormat(event.target.value === "csv" ? "csv" : "txt");
                        clearImportResults();
                      }}
                    >
                      <option value="txt">טקסט: Artist - Track</option>
                      <option value="csv">CSV: Artist,Track</option>
                    </select>
                  </label>
                  <label className="field-label" htmlFor="pasted-songs">
                    הדביקו כאן את רשימת השירים
                    <textarea
                      id="pasted-songs"
                      className="text-input"
                      rows={8}
                      dir="auto"
                      placeholder={pastedFormat === "txt" ? "Artist - Track" : "Artist,Track"}
                      value={pastedText}
                      disabled={resolving}
                      onChange={(event) => {
                        setPastedText(event.target.value);
                        clearImportResults();
                      }}
                    />
                  </label>
                </div>
              )}

              <div className="format-hint">
                <span className="format-tag">XLSX / CSV</span>
                <span>עמודות בשם Artist ו-Track</span>
              </div>
              <div className="format-hint">
                <span className="format-tag">TXT</span>
                <span>שורה לכל שיר: Artist - Track</span>
              </div>

              <div className="file-guide">
                <label htmlFor="song-file-prompt">איך יוצרים קובץ שירים?</label>
                <p>
                  העתיקו את הפרומפט לכלי AI, הוסיפו את בקשתכם, והדביקו את התוצאה
                  בתיבת ההדבקה למעלה, או בפנקס הרשימות ושמרו כקובץ TXT בקידוד UTF-8.
                </p>
                <textarea
                  id="song-file-prompt"
                  readOnly
                  rows={6}
                  dir="auto"
                  value={"צור רשימת שירים כטקסט פשוט, ללא כותרת או הסברים. כל שורה תכיל שם אמן ושם שיר, מופרדים ברווח, מקף ורווח, כך:\nArcade Fire - The Suburbs\nFoo Fighters - Everlong\nודא ששמות האמנים והשירים מדויקים ואל תוסיף כפילויות.\nהבקשה שלי: [כתבו כאן אילו שירים או אמנים לכלול]"}
                />
              </div>

              {connected ? (
                <button className="button button-primary full-button" type="submit" disabled={resolving || !hasInput}>
                  {resolving ? <><span className="spinner" /> מחפשים התאמות...</> : "חיפוש שירים ב-Spotify"}
                </button>
              ) : configurationReady ? (
                <a className="button button-primary full-button" href="/api/auth/login">
                  חיבור חשבון Spotify
                </a>
              ) : (
                <>
                  <button className="button button-primary full-button" type="button" disabled>
                    {loading ? "בודקים הגדרות..." : "נדרשת הגדרת Spotify"}
                  </button>
                  {!loading && (
                    <p className="setup-hint">
                      הגדירו את פרטי האפליקציה בקובץ <code>.env.local</code> והפעילו מחדש את השרת.
                    </p>
                  )}
                </>
              )}
            </form>

            <div className="privacy-note">
              <span aria-hidden="true">⌑</span>
              הקובץ או הרשימה מעובדים לצורך הייבוא ואינם נשמרים באפליקציה.
            </div>
          </article>

          <article className="panel destination-panel">
            <div className="step-heading">
              <span className="step-number">02</span>
              <div>
                <h3>בחירת יעד</h3>
                <p>פלייליסט חדש או פלייליסט בבעלותך</p>
              </div>
            </div>

            <div className="destination-options">
              <label className={`destination-option ${destination === "new" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="destination"
                  value="new"
                  checked={destination === "new"}
                  onChange={() => {
                    setDestination("new");
                    cancelPlaylistEditing();
                  }}
                />
                <span className="radio-mark" />
                <span>
                  <strong>פלייליסט חדש</strong>
                  <small>פרטי כברירת מחדל</small>
                </span>
                <span className="option-symbol" aria-hidden="true">＋</span>
              </label>
              {destination === "new" && (
                <label className="field-label" htmlFor="playlist-name">
                  שם הפלייליסט
                  <input
                    id="playlist-name"
                    className="text-input"
                    type="text"
                    maxLength={100}
                    placeholder="למשל: המועדפים שלי"
                    value={playlistName}
                    onChange={(event) => setPlaylistName(event.target.value)}
                  />
                  <small>השם מוצע לפי שם הקובץ ואפשר לשנות אותו.</small>
                </label>
              )}

              <label className={`destination-option ${destination === "existing" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="destination"
                  value="existing"
                  checked={destination === "existing"}
                  onChange={() => setDestination("existing")}
                />
                <span className="radio-mark" />
                <span>
                  <strong>פלייליסט קיים</strong>
                  <small>{connected ? `${playlists.length} בבעלותך` : "נדרשת התחברות ל-Spotify"}</small>
                </span>
                <span className="option-symbol" aria-hidden="true">↗</span>
              </label>
              {destination === "existing" && (
                <div className="field-label">
                  בחירת פלייליסט
                  {playlists.length > 0 ? (
                    <select
                      className="text-input"
                      value={selectedPlaylistId}
                      disabled={loadingPlaylistTracks}
                      onChange={(event) => {
                        setSelectedPlaylistId(event.target.value);
                        cancelPlaylistEditing();
                        setPlaylistUpdateResult(null);
                      }}
                    >
                      {playlists.map((playlist) => (
                        <option key={playlist.id} value={playlist.id}>
                          {playlist.name} · {playlist.owner}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="empty-playlists">
                      {connected ? "לא נמצאו פלייליסטים בבעלותך בעמודים שנטענו." : "חברו את Spotify כדי לטעון פלייליסטים."}
                    </p>
                  )}
                  {hasMorePlaylists && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={loadMorePlaylists}
                      disabled={loadingPlaylists}
                    >
                      {loadingPlaylists ? "טוענים..." : "טעינת פלייליסטים נוספים"}
                    </button>
                  )}
                  {selectedPlaylistId && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={
                        editingPlaylistId === selectedPlaylistId
                          ? cancelPlaylistEditing
                          : loadPlaylistForEditing
                      }
                      disabled={loadingPlaylistTracks}
                    >
                      {loadingPlaylistTracks
                        ? `טוענים שירים (${loadedPlaylistTrackCount}${playlistTrackTotal ? ` מתוך ${playlistTrackTotal}` : ""})...`
                        : editingPlaylistId === selectedPlaylistId
                          ? "ביטול עריכה"
                          : "עריכת שירי הפלייליסט"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {connected && (
              <button className="disconnect-button" type="button" onClick={disconnectSpotify}>
                ניתוק חשבון Spotify
              </button>
            )}
          </article>
        </div>

        {editingPlaylistId === selectedPlaylistId && editingPlaylistId && (
          <section className="panel playlist-editor" aria-labelledby="playlist-editor-title">
            <div className="results-heading">
              <div className="step-heading">
                <span className="step-number">✎</span>
                <div>
                  <h3 id="playlist-editor-title">עריכת {editingPlaylistName}</h3>
                  <p>{editablePlaylistTracks.length} שירים · השינויים עדיין לא נשמרו ב-Spotify</p>
                </div>
              </div>
              <span className="result-count">{editablePlaylistTracks.length} ברשימה</span>
            </div>

            {hasUnsupportedPlaylistTracks && (
              <p className="editor-warning" role="status">
                יש ברשימה פריטים שאינם שירי Spotify רגילים. צריך להסיר אותם לפני השמירה כדי שלא ייעלמו בעדכון.
              </p>
            )}

            <p className="editor-drag-hint">גררו שיר באמצעות הידית שלצדו כדי לשנות את הסדר.</p>

            {editablePlaylistTracks.length > 0 ? (
              <ol className="editable-track-list">
                {editablePlaylistTracks.map((track, index) => (
                  <li
                    className={`editable-track ${draggedPlaylistTrackKey === track.key ? "is-dragging" : ""} ${dragOverPlaylistTrackKey === track.key ? "is-drop-target" : ""}`}
                    key={track.key}
                    draggable={!savingPlaylist}
                    onDragStart={(event) => {
                      setDraggedPlaylistTrackKey(track.key);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", track.key);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverPlaylistTrackKey((current) =>
                        current === track.key ? current : track.key,
                      );
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedKey =
                        event.dataTransfer.getData("text/plain") || draggedPlaylistTrackKey;
                      const bounds = event.currentTarget.getBoundingClientRect();
                      reorderPlaylistTrack(
                        draggedKey,
                        track.key,
                        event.clientY >= bounds.top + bounds.height / 2,
                      );
                      setDraggedPlaylistTrackKey("");
                      setDragOverPlaylistTrackKey("");
                    }}
                    onDragEnd={() => {
                      setDraggedPlaylistTrackKey("");
                      setDragOverPlaylistTrackKey("");
                    }}
                  >
                    <span className="drag-handle" aria-hidden="true" title="גרירה לשינוי הסדר">⠿</span>
                    <span className="editable-track-number">{index + 1}</span>
                    <span className="editable-track-info">
                      <strong>{track.name}</strong>
                      <small>
                        {track.artists.length > 0
                          ? track.artists.join(", ")
                          : track.uri
                            ? "אמן לא זמין"
                            : "לא ניתן לשמור פריט זה"}
                      </small>
                    </span>
                    <span className="editable-track-actions">
                      <button
                        type="button"
                        aria-label={`הסר את ${track.name} מהפלייליסט`}
                        title="הסרה מהפלייליסט"
                        onClick={() => removePlaylistTrack(track.key)}
                        disabled={savingPlaylist}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty-playlists">
                הפלייליסט ריק. אפשר להוסיף שירים מקובץ דרך חיפוש השירים למעלה.
              </p>
            )}

            <div className="editor-footer">
              <span>
                סדר השירים והבחירות יישלחו כעדכון מלא. לפחות שיר אחד נדרש לשמירה.
              </span>
              <button
                className="button button-primary"
                type="button"
                onClick={savePlaylistEdits}
                disabled={!canSavePlaylist}
              >
                {savingPlaylist
                  ? <><span className="spinner" /> מעדכנים...</>
                  : `שמירה ועדכון ${editablePlaylistTracks.length} שירים ב-Spotify`}
              </button>
            </div>
          </section>
        )}

        {matches.length > 0 && (
          <section className="panel results-panel" aria-labelledby="results-title">
            <div className="results-heading">
              <div className="step-heading">
                <span className="step-number">03</span>
                <div>
                  <h3 id="results-title">בדיקת התאמות</h3>
                  <p>
                    {matchedCount} התאמות ודאיות · {reviewCount} דורשות בחירה · {notFoundCount} לא נמצאו
                  </p>
                </div>
              </div>
              <span className="result-count">{selectedCount} נבחרו</span>
            </div>

            <div className="track-list">
              {matches.map((item) => {
                const selectedCandidate =
                  item.status === "ambiguous"
                    ? selectedCandidates[item.rowNumber]
                    : undefined;

                return (
                  <div className="track-row" key={`${item.rowNumber}-${item.requested.artist}-${item.requested.track}`}>
                    <div className="track-check">
                      {item.status === "matched" ? (
                        <input
                          type="checkbox"
                          aria-label={`ייבוא ${item.requested.track}`}
                          checked={Boolean(selectedTracks[item.rowNumber])}
                          onChange={() => toggleTrack(item.rowNumber)}
                        />
                      ) : (
                        <span className="status-icon" aria-hidden="true">
                          {item.status === "ambiguous" ? "?" : "–"}
                        </span>
                      )}
                    </div>
                    <div className="track-main">
                      <strong>{item.requested.track}</strong>
                      <span>{item.requested.artist}</span>
                    </div>
                    <div className={`track-result ${item.status === "ambiguous" ? "needs-choice" : ""}`}>
                      {item.status === "matched" ? (
                        <>
                          <span className="match-indicator" />
                          <span>{item.match.name} · {item.match.artists.map((artist) => artist.name).join(", ")}</span>
                        </>
                      ) : item.status === "ambiguous" ? (
                        <CandidateOptions
                          match={item}
                          selectedUri={selectedCandidate}
                          onChoose={(uri) => chooseCandidate(item.rowNumber, uri)}
                          onSkip={() => skipCandidate(item.rowNumber)}
                        />
                      ) : (
                        <span className="skip-label">לא נמצאה התאמה · ידולג</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="results-footer">
              <span>
                {editingPlaylistId === selectedPlaylistId
                  ? "שירים שנבחרו יתווספו לרשימת העריכה בלבד. יש לשמור את הרשימה כדי לעדכן את Spotify."
                  : "רק שירים שנבחרו יתווספו. שירים חסרים ושירים ללא בחירת התאמה ידולגו."}
              </span>
              <button
                className="button button-primary"
                type="button"
                onClick={
                  editingPlaylistId === selectedPlaylistId
                    ? addSelectedTracksToDraft
                    : importTracks
                }
                disabled={!canImport}
              >
                {importing
                  ? <><span className="spinner" /> מייבאים...</>
                  : editingPlaylistId === selectedPlaylistId
                    ? `הוספה לעריכה (${selectedCount})`
                    : `אישור והוספת ${selectedCount} שירים`}
              </button>
            </div>
          </section>
        )}

        {importResult && (
          <div className="message message-success import-complete" role="status">
            הושלם! נוספו {importResult.added} שירים לפלייליסט
            <strong> {importResult.playlistName}</strong>.
            <a
              href={`https://open.spotify.com/playlist/${encodeURIComponent(importResult.playlistId)}`}
              target="_blank"
              rel="noreferrer"
            >
              פתיחה ב-Spotify ↗
            </a>
          </div>
        )}
        {playlistUpdateResult && (
          <div className="message message-success import-complete" role="status">
            הפלייליסט עודכן. נשמרו {playlistUpdateResult.updated} שירים ב-
            <strong> {playlistUpdateResult.playlistName}</strong>.
            <a
              href={`https://open.spotify.com/playlist/${encodeURIComponent(playlistUpdateResult.playlistId)}`}
              target="_blank"
              rel="noreferrer"
            >
              פתיחה ב-Spotify ↗
            </a>
          </div>
        )}
      </section>

      <footer className="footer">
        <span>נבנה לאנשים שאוהבים לארגן את המוזיקה שלהם.</span>
        {connected && <button className="footer-disconnect" type="button" onClick={disconnectSpotify}>ניתוק</button>}
      </footer>

      {loading && <div className="loading-indicator" aria-hidden="true" />}
    </main>
  );
}
