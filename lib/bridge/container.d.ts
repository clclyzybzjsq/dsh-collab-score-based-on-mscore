/**
 * mscs container codec, byte-matched to the MuseScore 4 engine — ported from
 * the verified `mscs-bridge-prototype` (624/625 real mscz round-trip, 1 EMPTY).
 *
 * - mscs:  MscWriter::XmlFileWriter / MscReader::XmlFileReader
 * - mscz:  MscWriter::ZipFileWriter / MscReader::ZipFileReader
 *   (src/engraving/infrastructure/mscwriter.cpp, mscreader.cpp)
 *
 * Engine-fidelity rules:
 *   1. mscs embeds ONLY {mscx, json, mss} files; others are skipped on write.
 *   2. mscs wrapper is byte-exact:
 *      `<?xml version="1.0" encoding="UTF-8"?>\n<files>\n<file name="N">\n<![CDATA[DATA]]>\n</file>\n…</files>\n`
 *   3. On read, CDATA payloads are Qt-trimmed before UTF-8 conversion
 *      (XmlFileReader::fileData: cdata.trimmed().toUtf8()).
 * @module @local/dsh-collab-score/bridge/container
 */
/** CRC-32 over `buf[start, end)`. */
export declare function crc32(buf: Buffer, start?: number, end?: number): number;
/** One parsed ZIP entry. */
export interface ZipEntry {
    name: string;
    data: Buffer;
    method: number;
    crc: number;
    flags: number;
}
/**
 * Parse a ZIP archive (single-disk, methods 0/store and 8/deflate) into entries.
 * Directory entries (name ending '/') are kept with empty data. Throws on
 * structural damage, size or CRC mismatch.
 */
export declare function readZip(buf: Buffer): ZipEntry[];
/**
 * Build a ZIP archive (deflate when smaller, else store; fixed DOS epoch
 * 1980-01-01 timestamps) from `[{ name, data }]`.
 */
export declare function writeZip(entries: Array<{
    name: string;
    data: Buffer;
}>): Buffer;
/** Extensions the engine embeds into mscs (XmlFileWriter::supportedExts). */
export declare const MSCS_EXTS: Set<string>;
/** Lower-cased extension of an entry name ('' when none). */
export declare function extOf(name: string): string;
/** Entries the engine would embed into an mscs container. */
export declare function filterMscsEntries(entries: ZipEntry[]): ZipEntry[];
/**
 * Encode entries into an mscs buffer, byte-exact with XmlFileWriter:
 * header, then per file `<file name="X">\n<![CDATA[` + data + `]]>\n</file>\n`, then `</files>\n`.
 */
export declare function encodeMscs(entries: Array<{
    name: string;
    data: Buffer | string;
}>): Buffer;
/** Trim both ends like Qt QString::trimmed (JS `\s` covers the same code points). */
export declare function qtTrim(buf: Buffer): Buffer;
/**
 * Decode an mscs buffer/string into `[{ name, data }]`, matching XmlFileReader:
 * CDATA payloads are Qt-trimmed. Tolerates any prelude before `<files>`; rejects
 * a missing footer or trailing garbage.
 */
export declare function decodeMscs(text: Buffer | string): Array<{
    name: string;
    data: Buffer;
}>;
