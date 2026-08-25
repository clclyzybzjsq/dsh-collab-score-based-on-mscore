/**
 * Lightweight mscx (score) parsing for the M1 validation chain: well-formedness,
 * the smoke counters, and the view projections (summary / notes / diff) that the
 * design protocol §6 defines. Not a general XML parser — MuseScore score XML is
 * a flat tag stream, and the only readers here are our own projections, so a
 * tag-stack scanner suffices and keeps the payload dependency-free.
 * @module @local/dsh-collab-score/bridge/mscx
 */
/**
 * Scan one XML document as a flat event stream, enforcing tag-stack matching.
 * Handles comments, CDATA, processing instructions, self-closing tags, and
 * quoted attributes (single or double). Text events are emitted trimmed.
 * @param source - the XML text.
 * @param onEvent - receives each event in document order (caller filters).
 * @returns the scan outcome; events still stream on malformed documents.
 */
export function scanXml(source, onEvent) {
    const stack = [];
    let root = null;
    let error;
    let i = 0;
    let textStart = 0;
    const emitText = (end) => {
        if (end <= textStart)
            return;
        const text = source.slice(textStart, end).replace(/\s+/g, ' ').trim();
        if (text !== '')
            onEvent({ type: 'text', text });
    };
    while (i < source.length) {
        const lt = source.indexOf('<', i);
        if (lt < 0)
            break;
        emitText(lt);
        if (source.startsWith('<!--', lt)) {
            const end = source.indexOf('-->', lt + 4);
            if (end < 0) {
                error ??= 'unterminated comment';
                break;
            }
            i = end + 3;
            textStart = i;
            continue;
        }
        if (source.startsWith('<![CDATA[', lt)) {
            const end = source.indexOf(']]>', lt + 9);
            if (end < 0) {
                error ??= 'unterminated CDATA';
                break;
            }
            i = end + 3;
            textStart = i;
            continue;
        }
        if (source.startsWith('<?', lt)) {
            const end = source.indexOf('?>', lt + 2);
            if (end < 0) {
                error ??= 'unterminated processing instruction';
                break;
            }
            i = end + 2;
            textStart = i;
            continue;
        }
        if (source.startsWith('<!', lt)) {
            // DOCTYPE and other declarations: skip to the closing '>'.
            const end = source.indexOf('>', lt + 2);
            if (end < 0) {
                error ??= 'unterminated declaration';
                break;
            }
            i = end + 1;
            textStart = i;
            continue;
        }
        // Closing tag.
        if (source[lt + 1] === '/') {
            const gt = source.indexOf('>', lt + 2);
            if (gt < 0) {
                error ??= 'unterminated close tag';
                break;
            }
            const name = source.slice(lt + 2, gt).trim().split(/\s+/, 1)[0] ?? '';
            const open = stack.pop();
            if (open === undefined) {
                error ??= `close tag </${name}> with no open element`;
            }
            else if (open !== name) {
                error ??= `close tag </${name}> mismatches open <${open}>`;
            }
            onEvent({ type: 'close', name });
            i = gt + 1;
            textStart = i;
            continue;
        }
        // Open tag (possibly self-closing).
        const gt = source.indexOf('>', lt + 1);
        if (gt < 0) {
            error ??= 'unterminated open tag';
            break;
        }
        const raw = source.slice(lt + 1, gt);
        const selfClosing = raw.endsWith('/');
        const body = selfClosing ? raw.slice(0, -1) : raw;
        const nameMatch = /^([A-Za-z_][A-Za-z0-9_.-]*)/.exec(body);
        if (nameMatch === null) {
            error ??= `malformed tag <${raw}>`;
            break;
        }
        // The pattern guarantees capture group 1; `?? ''` is the noUncheckedIndexedAccess
        // accommodation, never a behavioural fallback.
        const name = nameMatch[1] ?? '';
        const attrs = {};
        const attrRe = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let attrMatch;
        while ((attrMatch = attrRe.exec(body)) !== null) {
            const key = attrMatch[1];
            if (key !== undefined)
                attrs[key] = attrMatch[3] ?? attrMatch[4] ?? '';
        }
        if (root === null)
            root = name;
        if (!selfClosing)
            stack.push(name);
        onEvent({ type: 'open', name, attrs });
        i = gt + 1;
        textStart = i;
    }
    emitText(source.length);
    if (error === undefined && stack.length > 0) {
        error = `unclosed element(s): ${stack.join(', ')}`;
    }
    if (error !== undefined)
        return { root, wellFormed: false, error };
    if (root === null)
        return { root: null, wellFormed: false, error: 'document has no root element' };
    return { root, wellFormed: true };
}
/**
 * Compute the smoke counters and check well-formedness in ONE scan.
 * @param mscx - the score text (the mscx file's contents).
 * @returns smoke counters plus the structural verdict.
 */
export function smokeCounts(mscx) {
    const counts = {
        measures: 0, notes: 0, chords: 0, parts: 0, staffs: 0,
        keysigs: 0, timesigs: 0, tempos: 0, rehearsalMarks: 0,
        tickSum: 0, pitchRange: null,
    };
    let inNote = false;
    let pending = null;
    let minPitch = Number.POSITIVE_INFINITY;
    let maxPitch = Number.NEGATIVE_INFINITY;
    const result = scanXml(mscx, (event) => {
        if (event.type === 'open') {
            switch (event.name) {
                case 'Measure':
                    counts.measures += 1;
                    break;
                case 'Note':
                    counts.notes += 1;
                    inNote = true;
                    break;
                case 'Chord':
                    counts.chords += 1;
                    break;
                case 'Part':
                    counts.parts += 1;
                    break;
                case 'Staff':
                    counts.staffs += 1;
                    break;
                case 'KeySig':
                    counts.keysigs += 1;
                    break;
                case 'TimeSig':
                    counts.timesigs += 1;
                    break;
                case 'Tempo':
                    counts.tempos += 1;
                    break;
                case 'RehearsalMark':
                    counts.rehearsalMarks += 1;
                    break;
                case 'tick':
                    if (inNote)
                        pending = 'tick';
                    break;
                case 'pitch':
                    if (inNote)
                        pending = 'pitch';
                    break;
            }
            return;
        }
        if (event.type === 'text' && pending !== null) {
            const value = Number.parseInt(event.text, 10);
            if (Number.isFinite(value)) {
                if (pending === 'tick')
                    counts.tickSum += value;
                else {
                    minPitch = Math.min(minPitch, value);
                    maxPitch = Math.max(maxPitch, value);
                }
            }
            return;
        }
        if (event.type === 'close') {
            if (event.name === 'Note')
                inNote = false;
            if (event.name === 'tick' || event.name === 'pitch')
                pending = null;
        }
    });
    if (Number.isFinite(minPitch))
        counts.pitchRange = [minPitch, maxPitch];
    return {
        ...counts,
        wellFormed: result.wellFormed,
        ...result.error === undefined ? {} : { error: result.error },
    };
}
/**
 * Project the summary vocabulary of one score (design §6: instruments /
 * measures / time / key / tempo / rehearsal marks). One pass with a small
 * state machine: only the tags named below are observed.
 * @param mscx - the score text.
 * @returns the summary projection.
 */
export function projectSummary(mscx) {
    const parts = [];
    const tempos = [];
    const timeSignatures = [];
    const keySignatures = [];
    let rehearsalMarks = 0;
    let measureIndex = 0;
    let partIndex = 0;
    let inPart = false;
    let trackNamePending = false;
    let partNameTaken = false;
    let tickValue = 0;
    let tickPending = false;
    let inTempo = false;
    let tempoValue = 0;
    let tempoPending = false;
    let inTimeSig = false;
    let sigN = 0;
    let sigD = 0;
    let readingSigN = false;
    let readingSigD = false;
    let inKeySig = false;
    let keyAccidentals = 0;
    const currentPart = () => {
        let part = parts[partIndex];
        if (part === undefined) {
            part = { index: partIndex, trackName: '' };
            parts.push(part);
        }
        return part;
    };
    scanXml(mscx, (event) => {
        if (event.type === 'open') {
            switch (event.name) {
                case 'Part':
                    inPart = true;
                    partNameTaken = false;
                    break;
                case 'trackName':
                    if (inPart && !partNameTaken)
                        trackNamePending = true;
                    break;
                case 'Measure':
                    measureIndex += 1;
                    break;
                case 'tick':
                    tickPending = true;
                    break;
                case 'Tempo':
                    inTempo = true;
                    break;
                case 'tempo':
                    if (inTempo)
                        tempoPending = true;
                    break;
                case 'TimeSig':
                    inTimeSig = true;
                    sigN = 0;
                    sigD = 0;
                    break;
                case 'sigN':
                    if (inTimeSig)
                        readingSigN = true;
                    break;
                case 'sigD':
                    if (inTimeSig)
                        readingSigD = true;
                    break;
                case 'KeySig':
                    inKeySig = true;
                    keyAccidentals = 0;
                    break;
                case 'accidental':
                    if (inKeySig)
                        keyAccidentals += 1;
                    break;
                case 'RehearsalMark':
                    rehearsalMarks += 1;
                    break;
            }
            return;
        }
        if (event.type === 'text') {
            const text = event.text;
            if (trackNamePending) {
                currentPart().trackName += text;
                return;
            }
            if (tickPending) {
                const parsed = Number.parseInt(text, 10);
                if (Number.isFinite(parsed))
                    tickValue = parsed;
                return;
            }
            if (tempoPending) {
                const parsed = Number.parseFloat(text);
                if (Number.isFinite(parsed))
                    tempoValue = parsed;
                return;
            }
            if (readingSigN) {
                const parsed = Number.parseInt(text, 10);
                if (Number.isFinite(parsed))
                    sigN = parsed;
                return;
            }
            if (readingSigD) {
                const parsed = Number.parseInt(text, 10);
                if (Number.isFinite(parsed))
                    sigD = parsed;
                return;
            }
            return;
        }
        if (event.type === 'close') {
            switch (event.name) {
                case 'Part':
                    currentPart();
                    partIndex += 1;
                    inPart = false;
                    break;
                case 'trackName':
                    // A Part carries its own trackName and an Instrument-level one; the
                    // Part's own value is the naming authority (first element wins).
                    trackNamePending = false;
                    partNameTaken = true;
                    break;
                case 'tick':
                    tickPending = false;
                    break;
                case 'Tempo':
                    tempos.push({ tick: tickValue, tempo: tempoValue });
                    inTempo = false;
                    break;
                case 'tempo':
                    tempoPending = false;
                    break;
                case 'TimeSig':
                    timeSignatures.push({ measure: measureIndex, sigN: sigN || 4, sigD: sigD || 4 });
                    inTimeSig = false;
                    break;
                case 'sigN':
                    readingSigN = false;
                    break;
                case 'sigD':
                    readingSigD = false;
                    break;
                case 'KeySig':
                    keySignatures.push({ measure: measureIndex, accidentals: keyAccidentals });
                    inKeySig = false;
                    break;
                case 'accidental':
                    readingSigN = false;
                    break;
            }
        }
    });
    return {
        parts,
        measureCount: measureIndex,
        tempos,
        timeSignatures,
        keySignatures,
        rehearsalMarks,
    };
}
/** One compact note line of the diff vocabulary. */
const noteLine = (note) => `m${note.loc.measureIdx}:s${note.loc.staffIdx}:v${note.loc.voiceIdx} p${note.pitch}@${note.duration}${note.dots > 0 ? `.${note.dots}` : ''}`;
/**
 * Project every note with its locator (design §6): staff/measure/voice indexes,
 * pitch, tpc, duration type, dots, and tick.
 * @param mscx - the score text.
 * @returns the notes projection plus the line vocabulary for diffing.
 */
export function projectNotes(mscx) {
    const notes = [];
    let staffIdx = 0;
    let measureIdx = 0;
    let voiceIdx = 0;
    let currentStaff = -1;
    let currentMeasure = -1;
    let currentVoice = -1;
    let inNote = false;
    let note = null;
    let pending = null;
    // MuseScore 4 often publishes durationType on the Chord, not on every Note;
    // the last seen value is the note's inherited duration.
    let lastDuration = '';
    scanXml(mscx, (event) => {
        if (event.type === 'open') {
            switch (event.name) {
                case 'Staff':
                    currentStaff = staffIdx;
                    staffIdx += 1;
                    break;
                case 'Measure':
                    currentMeasure = measureIdx;
                    measureIdx += 1;
                    break;
                case 'voice':
                    currentVoice = voiceIdx;
                    voiceIdx += 1;
                    break;
                case 'Note':
                    inNote = true;
                    note = { pitch: 0, tpc: 0, duration: '', dots: 0, tick: 0 };
                    break;
                case 'pitch':
                    if (inNote)
                        pending = 'pitch';
                    break;
                case 'tpc':
                    if (inNote)
                        pending = 'tpc';
                    break;
                case 'durationType':
                    pending = 'duration';
                    break;
                case 'dots':
                    if (inNote)
                        pending = 'dots';
                    break;
                case 'tick':
                    if (inNote)
                        pending = 'tick';
                    break;
            }
            return;
        }
        if (event.type === 'text') {
            if (pending === null || note === null)
                return;
            const value = Number.parseInt(event.text, 10);
            switch (pending) {
                case 'pitch':
                    if (Number.isFinite(value))
                        note.pitch = value;
                    break;
                case 'tpc':
                    if (Number.isFinite(value))
                        note.tpc = value;
                    break;
                case 'duration':
                    lastDuration = event.text;
                    note.duration = event.text;
                    break;
                case 'dots':
                    if (Number.isFinite(value))
                        note.dots = value;
                    break;
                case 'tick':
                    if (Number.isFinite(value))
                        note.tick = value;
                    break;
            }
            return;
        }
        if (event.type === 'close') {
            switch (event.name) {
                case 'Note':
                    if (inNote && note !== null) {
                        notes.push({
                            loc: {
                                staffIdx: Math.max(currentStaff, 0),
                                measureIdx: Math.max(currentMeasure, 0),
                                voiceIdx: Math.max(currentVoice, 0),
                            },
                            pitch: note.pitch, tpc: note.tpc,
                            duration: note.duration || lastDuration || '?',
                            dots: note.dots, tick: note.tick,
                        });
                    }
                    inNote = false;
                    note = null;
                    break;
                case 'Staff':
                    currentStaff = -1;
                    break;
                case 'Measure':
                    currentMeasure = -1;
                    break;
                case 'voice':
                    currentVoice = -1;
                    break;
                case 'pitch':
                case 'tpc':
                case 'durationType':
                case 'dots':
                case 'tick':
                    pending = null;
                    break;
            }
        }
    });
    const lines = notes.map(noteLine);
    return { notes, lines };
}
/**
 * Line-level LCS diff over the notes projection lines: the view-vocabulary
 * diff the design protocol promises (`--depth diff`). Bounded: above ~4M cell
 * comparisons the diff degrades to a positional comparison (never a hang).
 * @param a - projection lines of the older view.
 * @param b - projection lines of the newer view.
 * @returns the diff rows in document order.
 */
export function diffLines(a, b) {
    const n = a.length;
    const m = b.length;
    if (n * m <= 4_000_000 && n > 0 && m > 0) {
        const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        for (let i = n - 1; i >= 0; i--) {
            // Both rows exist: i is bounded by the table's construction range.
            const row = table[i];
            const nextRow = table[i + 1];
            for (let j = m - 1; j >= 0; j--) {
                row[j] = a[i] === b[j]
                    ? (nextRow[j + 1] ?? 0) + 1
                    : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
            }
        }
        const rows = [];
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            // Here i < n and j < m hold, so both indexes are in bounds.
            const left = a[i];
            const right = b[j];
            if (left === right) {
                rows.push({ kind: 'unchanged', text: left });
                i += 1;
                j += 1;
            }
            else if ((table[i + 1][j] ?? 0) >= (table[i][j + 1] ?? 0)) {
                rows.push({ kind: 'removed', text: left });
                i += 1;
            }
            else {
                rows.push({ kind: 'added', text: right });
                j += 1;
            }
        }
        while (i < n)
            rows.push({ kind: 'removed', text: a[i++] });
        while (j < m)
            rows.push({ kind: 'added', text: b[j++] });
        return rows;
    }
    // Degraded positional comparison: same index means the same voice line.
    const rows = [];
    const width = Math.max(n, m);
    for (let k = 0; k < width; k++) {
        const left = a[k];
        const right = b[k];
        if (left === right) {
            if (left !== undefined)
                rows.push({ kind: 'unchanged', text: left });
        }
        else {
            if (left !== undefined)
                rows.push({ kind: 'removed', text: left });
            if (right !== undefined)
                rows.push({ kind: 'added', text: right });
        }
    }
    return rows;
}
//# sourceMappingURL=mscx.js.map