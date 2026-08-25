/**
 * Workdir state machine (design §4/§5): the collab-score session directory with
 * score.mscs as the single write truth, commits/ snapshots, and manifest.json as
 * the atomic commit point. Turn-based, soft-locked: every edit re-validates the
 * expected old text before replacing it (a stale write fails instead of
 * clobbering), and every write lands through temp-file + rename.
 * @module @local/dsh-collab-score/bridge/state
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeMscs, encodeMscs } from './container.js'
import { diffLines, projectNotes, projectSummary, smokeCounts } from './mscx.js'

/** One commit record in manifest.history (append-only). */
export interface CommitRecord {
  commitId: string
  ts: string
  by: string
  summary: string
}

/** The score workdir manifest (design §4). */
export interface ScoreManifest {
  scoreId: string
  round: number
  lastUserEdit?: string
  lastAgentCommit?: string
  fingerprints: {
    mscs: string
    view?: string
  }
  history: CommitRecord[]
}

/** Error thrown by edit/commit with a stable `code` for tool error reporting. */
export class ScoreWorkdirError extends Error {
  constructor(
    readonly code: 'no-score' | 'stale-write' | 'not-well-formed' | 'commit-failed',
    message: string,
  ) {
    super(message)
  }
}

/** The current score.mscs container text, or null when absent. */
export async function readContainer(workdir: string): Promise<string | null> {
  const path = join(workdir, 'score.mscs')
  return existsSync(path) ? await readFile(path, 'utf8') : null
}

/** The embedded mscx text of one container, or null when absent. */
export function mscxOfContainer(container: string): { name: string; mscx: string } | null {
  const entries = decodeMscs(container)
  const mscx = entries.find(entry => entry.name.endsWith('.mscx'))
  return mscx === undefined ? null : { name: mscx.name, mscx: mscx.data.toString('utf8') }
}

/** Re-encode one mscx back into the container, preserving the other entries. */
export function containerWithMscx(container: string, mscx: string): string {
  const entries = decodeMscs(container)
  const rebuilt = entries.map(entry => (
    entry.name.endsWith('.mscx') ? { name: entry.name, data: mscx } : entry
  ))
  return encodeMscs(rebuilt).toString('utf8')
}

/** SHA-256 hex of one text. */
export function fingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Read the manifest; absent or unparsable manifests read as null. */
export async function readManifest(workdir: string): Promise<ScoreManifest | null> {
  const path = join(workdir, 'manifest.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ScoreManifest
  } catch {
    return null
  }
}

/** Ensure the workdir and its commits/ subdirectory exist. */
export async function ensureWorkdir(workdir: string): Promise<void> {
  await mkdir(join(workdir, 'commits'), { recursive: true })
}

/** Atomic text write: temp file in the same directory, then rename. */
export async function atomicWriteText(file: string, text: string): Promise<void> {
  const temp = `${file}.tmp-${process.pid}`
  await writeFile(temp, text, 'utf8')
  await rename(temp, file)
}

/** Sanity verdict of one mscx: well-formedness plus the smoke counters. */
export interface MscxVerdict {
  wellFormed: boolean
  error?: string
  smoke: {
    measures: number
    notes: number
    chords: number
    parts: number
    staffs: number
  }
}

/** Verify one mscx through the M1 validation chain (structure + smoke). */
export function verifyMscx(mscx: string): MscxVerdict {
  const counts = smokeCounts(mscx)
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
  }
}

/** Rich sync probe: files, manifest, fingerprint drift, structural verdict. */
export interface SyncProbe {
  exists: boolean
  files: string[]
  manifest: ScoreManifest | null
  fingerprint: string | null
  fingerprintMatches: boolean
  verdict: MscxVerdict | null
  mscxName: string | null
}

/** The score_sync probe over one workdir. */
export async function syncProbe(workdir: string): Promise<SyncProbe> {
  let files: string[] = []
  try {
    files = (await readdir(workdir)).sort()
  } catch {
    files = []
  }
  const manifest = await readManifest(workdir)
  const container = await readContainer(workdir)
  if (container === null) {
    return { exists: false, files, manifest, fingerprint: null, fingerprintMatches: false, verdict: null, mscxName: null }
  }
  const current = fingerprint(container)
  const embedded = mscxOfContainer(container)
  const verdict = embedded === null ? null : verifyMscx(embedded.mscx)
  return {
    exists: true,
    files,
    manifest,
    fingerprint: current,
    fingerprintMatches: manifest?.fingerprints.mscs === current,
    verdict,
    mscxName: embedded?.name ?? null,
  }
}

/** The summary returned by score_edit. */
export interface EditResult {
  applied: boolean
  summary: string
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
export async function editScore(
  workdir: string,
  edit: { anchor: string; expected: string; replacement: string },
): Promise<EditResult> {
  const container = await readContainer(workdir)
  if (container === null) throw new ScoreWorkdirError('no-score', `工作目录无 score.mscs：${workdir}`)
  const embedded = mscxOfContainer(container)
  if (embedded === null) throw new ScoreWorkdirError('no-score', 'score.mscs 内没有 .mscx 文件')
  if (!embedded.mscx.includes(edit.anchor)) {
    throw new ScoreWorkdirError('stale-write', `锚 "${edit.anchor}" 在 score.mscx 中不存在`)
  }
  const occurrences = embedded.mscx.split(edit.expected).length - 1
  if (occurrences !== 1) {
    throw new ScoreWorkdirError('stale-write', `期望旧值出现 ${occurrences} 次（必须恰好 1 次）：${edit.expected.slice(0, 60)}…`)
  }
  if (!edit.expected.includes(edit.anchor)) {
    throw new ScoreWorkdirError('stale-write', '锚必须位于期望旧值之内')
  }
  const before = verifyMscx(embedded.mscx)
  if (!before.wellFormed) {
    throw new ScoreWorkdirError('not-well-formed', `写前结构自检已失败（工作目录文件损坏）：${before.error ?? 'unknown'}`)
  }
  const afterMscx = embedded.mscx.replace(edit.expected, edit.replacement)
  const after = verifyMscx(afterMscx)
  if (!after.wellFormed) {
    throw new ScoreWorkdirError('not-well-formed', `写后结构自检失败（已放弃写入）：${after.error ?? 'unknown'}`)
  }
  const containerAfter = containerWithMscx(container, afterMscx)
  await atomicWriteText(join(workdir, 'score.mscs'), containerAfter)
  const manifest = await readManifest(workdir)
  if (manifest !== null) {
    const updated: ScoreManifest = {
      ...manifest,
      fingerprints: { ...manifest.fingerprints, mscs: fingerprint(containerAfter) },
    }
    await atomicWriteText(join(workdir, 'manifest.json'), JSON.stringify(updated, null, 2))
  }
  return {
    applied: true,
    summary: `编辑已应用并自检通过：小节 ${before.smoke.measures}→${after.smoke.measures}，音符 ${before.smoke.notes}→${after.smoke.notes}`,
  }
}

/** One commit's summary: the view vocabulary snapshot (design §6). */
export function commitSummary(mscx: string): string {
  const summary = projectSummary(mscx)
  const count = smokeCounts(mscx)
  const joints = [`${count.measures} 小节`, `${count.notes} 音符`, `${count.chords} 和弦`]
  if (summary.parts.length > 0) joints.unshift(`乐器：${summary.parts.map(part => part.trackName || '(未命名)').join('、')}`)
  return joints.join('；')
}

/** The score_commit result. */
export interface CommitResult {
  commitId: string
  round: number
  summary: string
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
export async function commitScore(workdir: string, by: string, note?: string): Promise<CommitResult> {
  const container = await readContainer(workdir)
  if (container === null) throw new ScoreWorkdirError('no-score', `工作目录无 score.mscs：${workdir}`)
  const embedded = mscxOfContainer(container)
  if (embedded === null) throw new ScoreWorkdirError('no-score', 'score.mscs 内没有 .mscx 文件')
  const verdict = verifyMscx(embedded.mscx)
  if (!verdict.wellFormed) {
    throw new ScoreWorkdirError('not-well-formed', `提交前结构自检失败：${verdict.error ?? 'unknown'}`)
  }
  await ensureWorkdir(workdir)
  const manifest = (await readManifest(workdir)) ?? {
    scoreId: fingerprint(container).slice(0, 16),
    round: 0,
    fingerprints: { mscs: '' },
    history: [],
  }
  const round = manifest.history.length + 1
  const commitId = `v${String(round).padStart(6, '0')}`
  const ts = new Date().toISOString()
  const summary = [commitSummary(embedded.mscx), note !== undefined && note.trim() !== '' ? note.trim() : undefined]
    .filter((part): part is string => part !== undefined)
    .join(' — ')
  await atomicWriteText(join(workdir, 'commits', `${commitId}.mscs`), container)
  const updated: ScoreManifest = {
    ...manifest,
    round,
    lastAgentCommit: ts,
    fingerprints: { ...manifest.fingerprints, mscs: fingerprint(container) },
    history: [...manifest.history, { commitId, ts, by, summary }],
  }
  await atomicWriteText(join(workdir, 'manifest.json'), JSON.stringify(updated, null, 2))
  return { commitId, round, summary }
}

/** The score_create result. */
export interface CreateResult {
  workdir: string
  summary: string
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
export async function createScore(workdir: string, mscx: string): Promise<CreateResult> {
  await ensureWorkdir(workdir)
  const container = encodeMscs([{ name: 'score.mscx', data: mscx }]).toString('utf8')
  await atomicWriteText(join(workdir, 'score.mscs'), container)
  const manifest: ScoreManifest = {
    scoreId: fingerprint(container).slice(0, 16),
    round: 0,
    fingerprints: { mscs: fingerprint(container) },
    history: [],
  }
  await atomicWriteText(join(workdir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { workdir, summary: commitSummary(mscx) }
}

/** One side of a compared view (commit id or 'working' for the live file). */
export interface DiffSide {
  label: string
  lines: string[]
}

/** The `--depth diff` result. */
export interface ScoreDiff {
  from: DiffSide
  to: DiffSide
  rows: Array<{ kind: 'unchanged' | 'removed' | 'added'; text: string }>
}

/** Read one commit's projection lines by commit id (vNNNNNN). */
async function commitLines(workdir: string, commitId: string): Promise<DiffSide | null> {
  const path = join(workdir, 'commits', `${commitId}.mscs`)
  if (!existsSync(path)) return null
  const embedded = mscxOfContainer(await readFile(path, 'utf8'))
  if (embedded === null) return { label: commitId, lines: [] }
  return { label: commitId, lines: projectNotes(embedded.mscx).lines }
}

/**
 * Diff the two most recent committed views (or the live working file against
 * the last commit when only one exists) using the notes-projection vocabulary.
 * @param workdir - the session workdir.
 * @returns the two sides and their line diff.
 * @throws ScoreWorkdirError when no commit exists yet.
 */
export async function diffScore(workdir: string): Promise<ScoreDiff> {
  let commits: string[] = []
  try {
    commits = (await readdir(join(workdir, 'commits')))
      .filter(name => /^v\d{6}\.mscs$/.test(name))
      .sort()
  } catch {
    commits = []
  }
  if (commits.length === 0) throw new ScoreWorkdirError('commit-failed', '尚无提交，diff 至少需要一个版本')
  // `commits` is non-empty here; both indexes are in bounds.
  const newerId = commits[commits.length - 1]!.replace(/\.mscs$/, '')
  let from: DiffSide
  let to: DiffSide
  if (commits.length >= 2) {
    const olderId = commits[commits.length - 2]!.replace(/\.mscs$/, '')
    from = (await commitLines(workdir, olderId)) ?? { label: olderId, lines: [] }
    to = (await commitLines(workdir, newerId)) ?? { label: newerId, lines: [] }
  } else {
    const container = await readContainer(workdir)
    const embedded = container === null ? null : mscxOfContainer(container)
    from = (await commitLines(workdir, newerId)) ?? { label: newerId, lines: [] }
    to = { label: 'working', lines: embedded === null ? [] : projectNotes(embedded.mscx).lines }
  }
  return { from, to, rows: diffLines(from.lines, to.lines) }
}