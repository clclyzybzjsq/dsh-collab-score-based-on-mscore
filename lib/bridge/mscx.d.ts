/**
 * Lightweight mscx (score) parsing for the M1 validation chain: well-formedness,
 * the smoke counters, and the view projections (summary / notes / diff) that the
 * design protocol §6 defines. Not a general XML parser — MuseScore score XML is
 * a flat tag stream, and the only readers here are our own projections, so a
 * tag-stack scanner suffices and keeps the payload dependency-free.
 * @module @local/dsh-collab-score/bridge/mscx
 */
/** One parsed open-tag event. */
export interface XmlOpen {
    type: 'open';
    name: string;
    attrs: Record<string, string>;
}
/** One parsed close-tag event. */
export interface XmlClose {
    type: 'close';
    name: string;
}
/** One non-whitespace text run. */
export interface XmlText {
    type: 'text';
    text: string;
}
export type XmlEvent = XmlOpen | XmlClose | XmlText;
/** Outcome of a full-tag-stack scan. */
export interface ScanResult {
    /** Root element name, or null when the document has none. */
    root: string | null;
    /** True when every open tag closed, exactly in nesting order, with one root. */
    wellFormed: boolean;
    /** First structural problem, absent when well-formed. */
    error?: string;
}
/**
 * Scan one XML document as a flat event stream, enforcing tag-stack matching.
 * Handles comments, CDATA, processing instructions, self-closing tags, and
 * quoted attributes (single or double). Text events are emitted trimmed.
 * @param source - the XML text.
 * @param onEvent - receives each event in document order (caller filters).
 * @returns the scan outcome; events still stream on malformed documents.
 */
export declare function scanXml(source: string, onEvent: (event: XmlEvent) => void): ScanResult;
/** Smoke counters over one score, per the M1 validation chain. */
export interface SmokeCounts {
    measures: number;
    notes: number;
    chords: number;
    parts: number;
    staffs: number;
    keysigs: number;
    timesigs: number;
    tempos: number;
    rehearsalMarks: number;
    /** Rough total of per-note ticks (MuseScore 4 `<tick>` runs are measure-relative). */
    tickSum: number;
    /** Min/max pitch across all notes; null when the score has no notes. */
    pitchRange: [number, number] | null;
}
/**
 * Compute the smoke counters and check well-formedness in ONE scan.
 * @param mscx - the score text (the mscx file's contents).
 * @returns smoke counters plus the structural verdict.
 */
export declare function smokeCounts(mscx: string): SmokeCounts & {
    wellFormed: boolean;
    error?: string;
};
/** One instrument row for the summary projection. */
export interface PartSummary {
    /** Part index in document order. */
    index: number;
    /** trackName text ('' when the part publishes none). */
    trackName: string;
}
/** One tempo row for the summary projection. */
export interface TempoRow {
    /** tick position (measure-relative like the score's own `<tick>` runs). */
    tick: number;
    /** BPM value from the immediate `<tempo>` text child. */
    tempo: number;
}
/** One time-signature row for the summary projection. */
export interface TimeSigRow {
    measure: number;
    sigN: number;
    sigD: number;
}
/** One key-signature row for the summary projection. */
export interface KeySigRow {
    measure: number;
    /** Net accidentals (negative = flats, positive = sharps), when computable. */
    accidentals: number;
}
/** The `--depth summary` projection: what the model reads before editing. */
export interface ScoreSummary {
    parts: PartSummary[];
    measureCount: number;
    tempos: TempoRow[];
    timeSignatures: TimeSigRow[];
    keySignatures: KeySigRow[];
    rehearsalMarks: number;
}
/**
 * Project the summary vocabulary of one score (design §6: instruments /
 * measures / time / key / tempo / rehearsal marks). One pass with a small
 * state machine: only the tags named below are observed.
 * @param mscx - the score text.
 * @returns the summary projection.
 */
export declare function projectSummary(mscx: string): ScoreSummary;
/** One note row of the `--depth notes` projection. */
export interface NoteRow {
    /** Location locator, isomorphic with MuseScore's `--score-elements` location. */
    loc: {
        staffIdx: number;
        measureIdx: number;
        voiceIdx: number;
    };
    pitch: number;
    tpc: number;
    duration: string;
    dots: number;
    tick: number;
}
/** The `--depth notes` projection. */
export interface NotesProjection {
    notes: NoteRow[];
    /** Compact per-voice lines, one per note — the diff vocabulary. */
    lines: string[];
}
/**
 * Project every note with its locator (design §6): staff/measure/voice indexes,
 * pitch, tpc, duration type, dots, and tick.
 * @param mscx - the score text.
 * @returns the notes projection plus the line vocabulary for diffing.
 */
export declare function projectNotes(mscx: string): NotesProjection;
/** One row of the diff vocabulary. */
export interface DiffLine {
    kind: 'unchanged' | 'removed' | 'added';
    text: string;
}
/**
 * Line-level LCS diff over the notes projection lines: the view-vocabulary
 * diff the design protocol promises (`--depth diff`). Bounded: above ~4M cell
 * comparisons the diff degrades to a positional comparison (never a hang).
 * @param a - projection lines of the older view.
 * @param b - projection lines of the newer view.
 * @returns the diff rows in document order.
 */
export declare function diffLines(a: string[], b: string[]): DiffLine[];
