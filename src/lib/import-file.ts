import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";

export type TrackInput = {
  artist: string;
  track: string;
};

export class ImportFileError extends Error {}

export const MAX_IMPORT_TRACKS = 1000;
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

function findColumns(headers: string[]): { artist: number; track: number } {
  const normalized = headers.map((header) => (header ?? "").trim().toLowerCase());
  const artist = normalized.indexOf("artist");
  const track = normalized.indexOf("track");

  if (artist < 0 || track < 0) {
    throw new ImportFileError("CSV and Excel files need Artist and Track columns.");
  }

  return { artist, track };
}

function validateTracks(tracks: TrackInput[]): TrackInput[] {
  if (tracks.length === 0) {
    throw new ImportFileError("The file does not contain any songs.");
  }

  if (tracks.length > MAX_IMPORT_TRACKS) {
    throw new ImportFileError(`A file can contain at most ${MAX_IMPORT_TRACKS} songs.`);
  }

  return tracks;
}

function parseDelimitedRows(contents: string): TrackInput[] {
  let rows: string[][];

  try {
    rows = parseCsv(contents, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new ImportFileError(`The CSV file could not be read: ${error.message}`);
    }

    throw error;
  }

  if (rows.length < 2) {
    throw new ImportFileError("CSV files need a header row and at least one song.");
  }

  const columns = findColumns(rows[0]);
  const tracks: TrackInput[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const artist = row[columns.artist]?.trim() ?? "";
    const track = row[columns.track]?.trim() ?? "";

    if (!artist && !track) {
      continue;
    }

    if (!artist || !track) {
      throw new ImportFileError(`CSV row ${index + 1} needs both an artist and a track.`);
    }

    tracks.push({ artist, track });
  }

  return validateTracks(tracks);
}

function parseTextRows(contents: string): TrackInput[] {
  const tracks: TrackInput[] = [];
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line) {
      continue;
    }

    const separator = line.indexOf(" - ");

    if (separator < 1) {
      throw new ImportFileError(`TXT line ${index + 1} must use the format Artist - Track.`);
    }

    const artist = line.slice(0, separator).trim();
    const track = line.slice(separator + 3).trim();

    if (!artist || !track) {
      throw new ImportFileError(`TXT line ${index + 1} needs both an artist and a track.`);
    }

    tracks.push({ artist, track });
  }

  return validateTracks(tracks);
}

async function parseExcelRows(contents: Uint8Array): Promise<TrackInput[]> {
  const workbook = new ExcelJS.Workbook();
  const workbookData = new ArrayBuffer(contents.byteLength);
  new Uint8Array(workbookData).set(contents);

  try {
    await workbook.xlsx.load(workbookData);
  } catch (error) {
    if (error instanceof Error) {
      throw new ImportFileError(`The Excel file could not be read: ${error.message}`);
    }

    throw error;
  }

  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new ImportFileError("The Excel file does not contain a worksheet.");
  }

  const headers: string[] = [];
  worksheet.getRow(1).eachCell((cell, column) => {
    headers[column - 1] = cell.text;
  });
  const columns = findColumns(headers);
  const tracks: TrackInput[] = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const artist = row.getCell(columns.artist + 1).text.trim();
    const track = row.getCell(columns.track + 1).text.trim();

    if (!artist && !track) {
      continue;
    }

    if (!artist || !track) {
      throw new ImportFileError(`Excel row ${rowNumber} needs both an artist and a track.`);
    }

    tracks.push({ artist, track });
  }

  return validateTracks(tracks);
}

export async function parseImportFile(
  filename: string,
  contents: Uint8Array,
): Promise<TrackInput[]> {
  const extension = filename.toLowerCase().split(".").pop();

  if (extension === "csv") {
    return parseDelimitedRows(new TextDecoder().decode(contents));
  }

  if (extension === "txt") {
    return parseTextRows(new TextDecoder().decode(contents));
  }

  if (extension === "xlsx") {
    return parseExcelRows(contents);
  }

  throw new ImportFileError("Choose an Excel (.xlsx), CSV, or TXT file.");
}
