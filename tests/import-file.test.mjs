import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";
import { ImportFileError, parseImportFile } from "../src/lib/import-file.ts";

test("parses TXT rows and keeps later separators in the track name", async () => {
  const tracks = await parseImportFile(
    "songs.txt",
    Buffer.from("Foo Fighters - Everlong\nThe Cure - Friday - I'm in Love\n"),
  );

  assert.deepEqual(tracks, [
    { artist: "Foo Fighters", track: "Everlong" },
    { artist: "The Cure", track: "Friday - I'm in Love" },
  ]);
});

test("parses CSV headers without case sensitivity and honors quoted commas", async () => {
  const tracks = await parseImportFile(
    "songs.csv",
    Buffer.from('artist,track\n"AC/DC","Thunderstruck, Live"\n'),
  );

  assert.deepEqual(tracks, [
    { artist: "AC/DC", track: "Thunderstruck, Live" },
  ]);
});

test("rejects incomplete rows and malformed TXT lines with a useful file error", async () => {
  await assert.rejects(
    parseImportFile("songs.csv", Buffer.from("Artist,Track\nFoo Fighters,\n")),
    (error) =>
      error instanceof ImportFileError &&
      error.message.includes("row 2"),
  );
  await assert.rejects(
    parseImportFile("songs.txt", Buffer.from("Everlong")),
    (error) =>
      error instanceof ImportFileError &&
      error.message.includes("Artist - Track"),
  );
});

test("parses the first Excel worksheet using Artist and Track columns", async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Songs");
  worksheet.addRow(["Track", "Artist"]);
  worksheet.addRow(["Schism", "Tool"]);
  const contents = Buffer.from(await workbook.xlsx.writeBuffer());

  const tracks = await parseImportFile("songs.xlsx", contents);

  assert.deepEqual(tracks, [{ artist: "Tool", track: "Schism" }]);
});
