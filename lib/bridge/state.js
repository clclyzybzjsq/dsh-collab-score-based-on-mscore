/**
 * Workdir state machine (design §4/§5): the collab-score session directory with
 * score.mscs as the single write truth, commits/ snapshots, and manifest.json as
 * the atomic commit point. Turn-based, soft-locked: every edit re-validates the
 * expected old text before replacing it (a stale write fails instead of
 * clobbering), and every write lands through temp-file + rename.
 * @module @local/dsh-collab-score/bridge/state
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeMscs, encodeMscs } from './container.js';
import { diffLines, projectNotes, projectSummary, smokeCounts } from './mscx.js';
/** Error thrown by edit/commit with a stable `code` for tool error reporting. */
export class ScoreWorkdirError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
/** The current score.mscs container text, or null when absent. */
export async function readContainer(workdir) {
    const path = join(workdir, 'score.mscs');
    return existsSync(path) ? await readFile(path, 'utf8') : null;
}
/** The embedded mscx text of one container, or null when absent. */
export function mscxOfContainer(container) {
    const entries = decodeMscs(container);
    const mscx = entries.find(entry => entry.name.endsWith('.mscx'));
    return mscx === undefined ? null : { name: mscx.name, mscx: mscx.data.toString('utf8') };
}
/** Re-encode one mscx back into the container, preserving the other entries. */
export function containerWithMscx(container, mscx) {
    const entries = decodeMscs(container);
    const rebuilt = entries.map(entry => (entry.name.endsWith('.mscx') ? { name: entry.name, data: mscx } : entry));
    return encodeMscs(rebuilt).toString('utf8');
}
/** SHA-256 hex of one text. */
export function fingerprint(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
/** Read the manifest; absent or unparsable manifests read as null. */
export async function readManifest(workdir) {
    const path = join(workdir, 'manifest.json');
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    }
    catch {
        return null;
    }
}
/** Ensure the workdir and its commits/ subdirectory exist. */
export async function ensureWorkdir(workdir) {
    await mkdir(join(workdir, 'commits'), { recursive: true });
}
/** Atomic text write: temp file in the same directory, then rename. */
export async function atomicWriteText(file, text) {
    const temp = `${file}.tmp-${process.pid}`;
    await writeFile(temp, text, 'utf8');
    await rename(temp, file);
}
/** Verify one mscx through the M1 validation chain (structure + smoke). */
export function verifyMscx(mscx) {
    const counts = smokeCounts(mscx);
    return {
        wellFormed: counts.wellFormed,
        ...counts.error === undefined ? {} : { error: counts.error },
        smoke: {
            measures: counts.measures,
            notes: counts.notes,
            chords: counts.chords,
            parts: counts.parts,
            staffs: counts.staffs,
        },
    };
}
/** The score_sync probe over one workdir. */
export async function syncProbe(workdir) {
    let files = [];
    try {
        files = (await readdir(workdir)).sort();
    }
    catch {
        files = [];
    }
    const manifest = await readManifest(workdir);
    const container = await readContainer(workdir);
    if (container === null) {
        return { exists: false, files, manifest, fingerprint: null, fingerprintMatches: false, verdict: null, mscxName: null };
    }
    const current = fingerprint(container);
    const embedded = mscxOfContainer(container);
    const verdict = embedded === null ? null : verifyMscx(embedded.mscx);
    return {
        exists: true,
        files,
        manifest,
        fingerprint: current,
        fingerprintMatches: manifest?.fingerprints.mscs === current,
        verdict,
        mscxName: embedded?.name ?? null,
    };
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
export async function editScore(workdir, edit) {
    const container = await readContainer(workdir);
    if (container === null)
        throw new ScoreWorkdirError('no-score', `工作目录无 score.mscs：${workdir}`);
    const embedded = mscxOfContainer(container);
    if (embedded === null)
        throw new ScoreWorkdirError('no-score', 'score.mscs 内没有 .mscx 文件');
    if (!embedded.mscx.includes(edit.anchor)) {
        throw new ScoreWorkdirError('stale-write', `锚 "${edit.anchor}" 在 score.mscx 中不存在`);
    }
    const occurrences = embedded.mscx.split(edit.expected).length - 1;
    if (occurrences !== 1) {
        throw new ScoreWorkdirError('stale-write', `期望旧值出现 ${occurrences} 次（必须恰好 1 次）：${edit.expected.slice(0, 60)}…`);
    }
    if (!edit.expected.includes(edit.anchor)) {
        throw new ScoreWorkdirError('stale-write', '锚必须位于期望旧值之内');
    }
    const before = verifyMscx(embedded.mscx);
    if (!before.wellFormed) {
        throw new ScoreWorkdirError('not-well-formed', `写前结构自检已失败（工作目录文件损坏）：${before.error ?? 'unknown'}`);
    }
    const afterMscx = embedded.mscx.replace(edit.expected, edit.replacement);
    const after = verifyMscx(afterMscx);
    if (!after.wellFormed) {
        throw new ScoreWorkdirError('not-well-formed', `写后结构自检失败（已放弃写入）：${after.error ?? 'unknown'}`);
    }
    const containerAfter = containerWithMscx(container, afterMscx);
    await atomicWriteText(join(workdir, 'score.mscs'), containerAfter);
    const manifest = await readManifest(workdir);
    if (manifest !== null) {
        const updated = {
            ...manifest,
            fingerprints: { ...manifest.fingerprints, mscs: fingerprint(containerAfter) },
        };
        await atomicWriteText(join(workdir, 'manifest.json'), JSON.stringify(updated, null, 2));
    }
    return {
        applied: true,
        summary: `编辑已应用并自检通过：小节 ${before.smoke.measures}→${after.smoke.measures}，音符 ${before.smoke.notes}→${after.smoke.notes}`,
    };
}
/** One commit's summary: the view vocabulary snapshot (design §6). */
export function commitSummary(mscx) {
    const summary = projectSummary(mscx);
    const count = smokeCounts(mscx);
    const joints = [`${count.measures} 小节`, `${count.notes} 音符`, `${count.chords} 和弦`];
    if (summary.parts.length > 0)
        joints.unshift(`乐器：${summary.parts.map(part => part.trackName || '(未命名)').join('、')}`);
    return joints.join('；');
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
export async function commitScore(workdir, by, note) {
    const container = await readContainer(workdir);
    if (container === null)
        throw new ScoreWorkdirError('no-score', `工作目录无 score.mscs：${workdir}`);
    const embedded = mscxOfContainer(container);
    if (embedded === null)
        throw new ScoreWorkdirError('no-score', 'score.mscs 内没有 .mscx 文件');
    const verdict = verifyMscx(embedded.mscx);
    if (!verdict.wellFormed) {
        throw new ScoreWorkdirError('not-well-formed', `提交前结构自检失败：${verdict.error ?? 'unknown'}`);
    }
    await ensureWorkdir(workdir);
    const manifest = (await readManifest(workdir)) ?? {
        scoreId: fingerprint(container).slice(0, 16),
        round: 0,
        fingerprints: { mscs: '' },
        history: [],
    };
    const round = manifest.history.length + 1;
    const commitId = `v${String(round).padStart(6, '0')}`;
    const ts = new Date().toISOString();
    const summary = [commitSummary(embedded.mscx), note !== undefined && note.trim() !== '' ? note.trim() : undefined]
        .filter((part) => part !== undefined)
        .join(' — ');
    await atomicWriteText(join(workdir, 'commits', `${commitId}.mscs`), container);
    const updated = {
        ...manifest,
        round,
        lastAgentCommit: ts,
        fingerprints: { ...manifest.fingerprints, mscs: fingerprint(container) },
        history: [...manifest.history, { commitId, ts, by, summary }],
    };
    await atomicWriteText(join(workdir, 'manifest.json'), JSON.stringify(updated, null, 2));
    return { commitId, round, summary };
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
export async function createScore(workdir, mscx) {
    await ensureWorkdir(workdir);
    const container = encodeMscs([{ name: 'score.mscx', data: mscx }]).toString('utf8');
    await atomicWriteText(join(workdir, 'score.mscs'), container);
    const manifest = {
        scoreId: fingerprint(container).slice(0, 16),
        round: 0,
        fingerprints: { mscs: fingerprint(container) },
        history: [],
    };
    await atomicWriteText(join(workdir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { workdir, summary: commitSummary(mscx) };
}
/** Read one commit's projection lines by commit id (vNNNNNN). */
async function commitLines(workdir, commitId) {
    const path = join(workdir, 'commits', `${commitId}.mscs`);
    if (!existsSync(path))
        return null;
    const embedded = mscxOfContainer(await readFile(path, 'utf8'));
    if (embedded === null)
        return { label: commitId, lines: [] };
    return { label: commitId, lines: projectNotes(embedded.mscx).lines };
}
/**
 * Diff the two most recent committed views (or the live working file against
 * the last commit when only one exists) using the notes-projection vocabulary.
 * @param workdir - the session workdir.
 * @returns the two sides and their line diff.
 * @throws ScoreWorkdirError when no commit exists yet.
 */
export async function diffScore(workdir) {
    let commits = [];
    try {
        commits = (await readdir(join(workdir, 'commits')))
            .filter(name => /^v\d{6}\.mscs$/.test(name))
            .sort();
    }
    catch {
        commits = [];
    }
    if (commits.length === 0)
        throw new ScoreWorkdirError('commit-failed', '尚无提交，diff 至少需要一个版本');
    // `commits` is non-empty here; both indexes are in bounds.
    const newerId = commits[commits.length - 1].replace(/\.mscs$/, '');
    let from;
    let to;
    if (commits.length >= 2) {
        const olderId = commits[commits.length - 2].replace(/\.mscs$/, '');
        from = (await commitLines(workdir, olderId)) ?? { label: olderId, lines: [] };
        to = (await commitLines(workdir, newerId)) ?? { label: newerId, lines: [] };
    }
    else {
        const container = await readContainer(workdir);
        const embedded = container === null ? null : mscxOfContainer(container);
        from = (await commitLines(workdir, newerId)) ?? { label: newerId, lines: [] };
        to = { label: 'working', lines: embedded === null ? [] : projectNotes(embedded.mscx).lines };
    }
    return { from, to, rows: diffLines(from.lines, to.lines) };
}
//# sourceMappingURL=state.js.map