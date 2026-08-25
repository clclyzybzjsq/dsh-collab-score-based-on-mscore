/**
 * Workdir state machine (design §4/§5): the collab-score session directory with
 * score.mscs as the single write truth, commits/ snapshots, and manifest.json as
 * the atomic commit point. Turn-based, soft-locked: every edit re-validates the
 * expected old text before replacing it (a stale write fails instead of
 * clobbering), and every write lands through temp-file + rename.
 * @module @local/dsh-collab-score/bridge/state
 */
/** One commit record in manifest.history (append-only). */
export interface CommitRecord {
    commitId: string;
    ts: string;
    by: string;
    summary: string;
}
/** The score workdir manifest (design §4). */
export interface ScoreManifest {
    scoreId: string;
    round: number;
    lastUserEdit?: string;
    lastAgentCommit?: string;
    fingerprints: {
        mscs: string;
        view?: string;
    };
    history: CommitRecord[];
}
/** Error thrown by edit/commit with a stable `code` for tool error reporting. */
export declare class ScoreWorkdirError extends Error {
    readonly code: 'no-score' | 'stale-write' | 'not-well-formed' | 'commit-failed';
    constructor(code: 'no-score' | 'stale-write' | 'not-well-formed' | 'commit-failed', message: string);
}
/** The current score.mscs container text, or null when absent. */
export declare function readContainer(workdir: string): Promise<string | null>;
/** The embedded mscx text of one container, or null when absent. */
export declare function mscxOfContainer(container: string): {
    name: string;
    mscx: string;
} | null;
/** Re-encode one mscx back into the container, preserving the other entries. */
export declare function containerWithMscx(container: string, mscx: string): string;
/** SHA-256 hex of one text. */
export declare function fingerprint(text: string): string;
/** Read the manifest; absent or unparsable manifests read as null. */
export declare function readManifest(workdir: string): Promise<ScoreManifest | null>;
/** Ensure the workdir and its commits/ subdirectory exist. */
export declare function ensureWorkdir(workdir: string): Promise<void>;
/** Atomic text write: temp file in the same directory, then rename. */
export declare function atomicWriteText(file: string, text: string): Promise<void>;
/** Sanity verdict of one mscx: well-formedness plus the smoke counters. */
export interface MscxVerdict {
    wellFormed: boolean;
    error?: string;
    smoke: {
        measures: number;
        notes: number;
        chords: number;
        parts: number;
        staffs: number;
    };
}
/** Verify one mscx through the M1 validation chain (structure + smoke). */
export declare function verifyMscx(mscx: string): MscxVerdict;
/** Rich sync probe: files, manifest, fingerprint drift, structural verdict. */
export interface SyncProbe {
    exists: boolean;
    files: string[];
    manifest: ScoreManifest | null;
    fingerprint: string | null;
    fingerprintMatches: boolean;
    verdict: MscxVerdict | null;
    mscxName: string | null;
}
/** The score_sync probe over one workdir. */
export declare function syncProbe(workdir: string): Promise<SyncProbe>;
/** The summary returned by score_edit. */
export interface EditResult {
    applied: boolean;
    summary: string;
}
/**
 * Apply one anchored byte edit to score.mscs (design §6): `expected` must occur
 * exactly once and contain `anchor`; the replacement is written only then, and
 * immediately re-verified — a write that breaks structure is rolled back and
 * reported as a stale-write-class failure.
 * @param workdir - the session workdir.
 * @param edit - anchor locator, expected old text, replacement text.
 * @returns the applied result.
 * @throws ScoreWorkdirError on no score, ambiguous/wrong anchor, or failed post-check.
 */
export declare function editScore(workdir: string, edit: {
    anchor: string;
    expected: string;
    replacement: string;
}): Promise<EditResult>;
/** One commit's summary: the view vocabulary snapshot (design §6). */
export declare function commitSummary(mscx: string): string;
/** The score_commit result. */
export interface CommitResult {
    commitId: string;
    round: number;
    summary: string;
}
/**
 * Commit the current score.mscs: snapshots the container into commits/vNNNNNN.mscs
 * and atomically advances manifest.json. The commit point is atomic: either both
 * the snapshot and the manifest advance, or neither does (snapshot first, and a
 * manifest write failure throws commit-failed with the snapshot already present).
 * @param workdir - the session workdir.
 * @param by - the author label recorded on the commit.
 * @param note - optional commit message.
 * @returns the commit identity and its view summary.
 */
export declare function commitScore(workdir: string, by: string, note?: string): Promise<CommitResult>;
/** The score_create result. */
export interface CreateResult {
    workdir: string;
    summary: string;
}
/**
 * Create a fresh score in the workdir from an mscx template (M2 score_create):
 * wraps the mscx into an mscs container as score.mscs and initializes an empty
 * manifest (round 0, fingerprint of the new container). Safe to run on an
 * existing workdir — it replaces the working score, which is exactly what
 * "create a new score in this session" means.
 * @param workdir - the session workdir.
 * @param mscx - the mscx template text.
 * @returns the workdir and the view summary of the created score.
 */
export declare function createScore(workdir: string, mscx: string): Promise<CreateResult>;
/** One side of a compared view (commit id or 'working' for the live file). */
export interface DiffSide {
    label: string;
    lines: string[];
}
/** The `--depth diff` result. */
export interface ScoreDiff {
    from: DiffSide;
    to: DiffSide;
    rows: Array<{
        kind: 'unchanged' | 'removed' | 'added';
        text: string;
    }>;
}
/**
 * Diff the two most recent committed views (or the live working file against
 * the last commit when only one exists) using the notes-projection vocabulary.
 * @param workdir - the session workdir.
 * @returns the two sides and their line diff.
 * @throws ScoreWorkdirError when no commit exists yet.
 */
export declare function diffScore(workdir: string): Promise<ScoreDiff>;
