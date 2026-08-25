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
import zlib from 'node:zlib';
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
/** CRC-32 over `buf[start, end)`. */
export function crc32(buf, start = 0, end = buf.length) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++)
        c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
/**
 * Parse a ZIP archive (single-disk, methods 0/store and 8/deflate) into entries.
 * Directory entries (name ending '/') are kept with empty data. Throws on
 * structural damage, size or CRC mismatch.
 */
export function readZip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('ZIP: EOCD signature not found');
    const totalEntries = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50)
            throw new Error(`ZIP: central dir entry ${i} signature mismatch`);
        const flags = buf.readUInt16LE(p + 8);
        const method = buf.readUInt16LE(p + 10);
        const crc = buf.readUInt32LE(p + 16);
        const compSize = buf.readUInt32LE(p + 20);
        const uncompSize = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOffset = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        const localNameLen = buf.readUInt16LE(localOffset + 26);
        const localExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const raw = buf.subarray(dataStart, dataStart + compSize);
        let data;
        if (method === 0)
            data = Buffer.from(raw);
        else if (method === 8)
            data = zlib.inflateRawSync(raw);
        else
            throw new Error(`ZIP: unsupported compression method ${method} for "${name}"`);
        if (data.length !== uncompSize)
            throw new Error(`ZIP: size mismatch for "${name}"`);
        if (crc32(data) !== crc)
            throw new Error(`ZIP: CRC mismatch for "${name}"`);
        entries.push({ name, data, method, crc, flags });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}
/**
 * Build a ZIP archive (deflate when smaller, else store; fixed DOS epoch
 * 1980-01-01 timestamps) from `[{ name, data }]`.
 */
export function writeZip(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const { name, data } of entries) {
        const crc = crc32(data);
        const compressed = zlib.deflateRawSync(data, { level: 6 });
        const method = compressed.length < data.length ? 8 : 0;
        const body = method === 8 ? compressed : data;
        const nameBuf = Buffer.from(name, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0x21, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        chunks.push(local, nameBuf, body);
        central.push({ nameBuf, crc, method, compSize: body.length, uncompSize: data.length, offset });
        offset += 30 + nameBuf.length + body.length;
    }
    const cdStart = offset;
    let cdSize = 0;
    for (const c of central) {
        const h = Buffer.alloc(46);
        h.writeUInt32LE(0x02014b50, 0);
        h.writeUInt16LE(20, 4);
        h.writeUInt16LE(20, 6);
        h.writeUInt16LE(0, 8);
        h.writeUInt16LE(c.method, 10);
        h.writeUInt16LE(0, 12);
        h.writeUInt16LE(0x21, 14);
        h.writeUInt32LE(c.crc, 16);
        h.writeUInt32LE(c.compSize, 20);
        h.writeUInt32LE(c.uncompSize, 24);
        h.writeUInt16LE(c.nameBuf.length, 28);
        h.writeUInt16LE(0, 30);
        h.writeUInt16LE(0, 32);
        h.writeUInt16LE(0, 34);
        h.writeUInt16LE(0, 36);
        h.writeUInt32LE(0, 38);
        h.writeUInt32LE(c.offset, 42);
        chunks.push(h, c.nameBuf);
        cdSize += 46 + c.nameBuf.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...chunks, eocd]);
}
/** Extensions the engine embeds into mscs (XmlFileWriter::supportedExts). */
export const MSCS_EXTS = new Set(['mscx', 'json', 'mss']);
/** Lower-cased extension of an entry name ('' when none). */
export function extOf(name) {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}
/** Entries the engine would embed into an mscs container. */
export function filterMscsEntries(entries) {
    return entries.filter(entry => MSCS_EXTS.has(extOf(entry.name)));
}
/**
 * Encode entries into an mscs buffer, byte-exact with XmlFileWriter:
 * header, then per file `<file name="X">\n<![CDATA[` + data + `]]>\n</file>\n`, then `</files>\n`.
 */
export function encodeMscs(entries) {
    const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<files>\n'];
    for (const entry of entries) {
        parts.push(`<file name="${entry.name}">\n<![CDATA[`);
        parts.push(entry.data);
        parts.push(']]>\n</file>\n');
    }
    parts.push('</files>\n');
    return Buffer.concat(parts.map(part => (Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8'))));
}
/** Trim both ends like Qt QString::trimmed (JS `\s` covers the same code points). */
export function qtTrim(buf) {
    return Buffer.from(buf.toString('utf8').replace(/^\s+|\s+$/g, ''), 'utf8');
}
/**
 * Decode an mscs buffer/string into `[{ name, data }]`, matching XmlFileReader:
 * CDATA payloads are Qt-trimmed. Tolerates any prelude before `<files>`; rejects
 * a missing footer or trailing garbage.
 */
export function decodeMscs(text) {
    const s = Buffer.isBuffer(text) ? text.toString('utf8') : text;
    const filesStart = s.indexOf('<files>');
    if (filesStart < 0)
        throw new Error('mscs: no <files> element');
    const re = /<file name="([^"]+)">\n<!\[CDATA\[([\s\S]*?)\]\]>\n<\/file>\n/g;
    re.lastIndex = filesStart + '<files>'.length;
    const entries = [];
    let match;
    let last = re.lastIndex;
    while ((match = re.exec(s)) !== null) {
        // The pattern guarantees both capture groups on every exec; `?? ''` is the
        // noUncheckedIndexedAccess accommodation, never a behavioural fallback.
        entries.push({ name: match[1] ?? '', data: qtTrim(Buffer.from(match[2] ?? '', 'utf8')) });
        last = re.lastIndex;
    }
    if (entries.length === 0)
        throw new Error('mscs: no <file> entries found');
    const tail = s.slice(last);
    if (tail !== '</files>\n')
        throw new Error('mscs: unexpected trailing content after </files>');
    return entries;
}
//# sourceMappingURL=container.js.map