// Bridge unit tests (M1): container codec, mscx projections, and the workdir
// state machine against a REAL MuseScore 4 sample (beams-1.mscs, 72KB).
// Run after `pnpm run build`: imports the built lib, exactly the artifact the
// agent-plane tools and server routes load.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, copyFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeMscs, encodeMscs,
  smokeCounts, projectSummary, projectNotes, diffLines, scanXml,
  mscxOfContainer, containerWithMscx,
  syncProbe, editScore, commitScore, diffScore, readManifest, ScoreWorkdirError,
} from '../lib/bridge/index.js'

const FIXTURE = new URL('./fixtures/beams-1.mscs', import.meta.url)

const fixtureContainer = async () => (await readFile(FIXTURE, 'utf8'))

/** Fresh temp workdir populated with the fixture as score.mscs. */
async function freshWorkdir() {
  const dir = await mkdtemp(join(tmpdir(), 'score-collab-bridge-'))
  await mkdir(join(dir, 'commits'), { recursive: true })
  await copyFile(FIXTURE, join(dir, 'score.mscs'))
  return dir
}

test('container: decodes the real mscs and is a codec fixpoint', async () => {
  const container = await fixtureContainer()
  const entries = decodeMscs(container)
  assert.ok(entries.length >= 1, 'at least one entry')
  const mscx = entries.find(entry => entry.name.endsWith('.mscx'))
  assert.ok(mscx !== undefined, 'contains a .mscx entry')
  assert.match(mscx.data.toString('utf8'), /<museScore version="4\.00">/)
  // decode -> encode -> decode yields identical entries (bridge fixpoint).
  const again = decodeMscs(encodeMscs(entries))
  assert.equal(again.length, entries.length)
  for (let i = 0; i < entries.length; i++) {
    assert.equal(again[i].name, entries[i].name)
    assert.ok(again[i].data.equals(entries[i].data))
  }
})

test('mscx: smoke counters over the real score', async () => {
  const embedded = mscxOfContainer(await fixtureContainer())
  assert.ok(embedded !== null)
  const counts = smokeCounts(embedded.mscx)
  assert.equal(counts.wellFormed, true)
  assert.ok(counts.measures >= 1)
  assert.equal(counts.notes, 7, 'beams-1 has exactly 7 notes')
  assert.ok(counts.pitchRange !== null)
  // beams-1 publishes no explicit <tick> elements (tick is positional there),
  // so the tick smoke reports 0 — a faithful result, not a bug.
  assert.equal(counts.tickSum, 0)
  assert.ok(scanXml('<Score><Note/><Note></Score>', () => {}).wellFormed === false, 'mismatched close detected')
})

test('mscx: summary projection exposes parts, timesig, keysig', async () => {
  const embedded = mscxOfContainer(await fixtureContainer())
  assert.ok(embedded !== null)
  const summary = projectSummary(embedded.mscx)
  assert.ok(summary.parts.length >= 1)
  assert.ok(summary.parts.some(part => part.trackName !== ''), 'at least one named part')
  assert.ok(summary.measureCount >= 1)
  assert.ok(summary.timeSignatures.length >= 1)
  assert.equal(summary.timeSignatures[0].sigN, 4)
})

test('mscx: notes projection carries locators isomorphic with --score-elements', async () => {
  const embedded = mscxOfContainer(await fixtureContainer())
  assert.ok(embedded !== null)
  const { notes, lines } = projectNotes(embedded.mscx)
  assert.equal(notes.length, 7)
  assert.equal(lines.length, 7)
  const first = notes[0]
  assert.ok(first.loc.staffIdx >= 0 && first.loc.measureIdx >= 0 && first.loc.voiceIdx >= 0)
  assert.ok(first.duration.length > 0)
})

test('mscx: line diff over the notes vocabulary', () => {
  const diff = diffLines(['m0:s0:v0 p67@quarter'], ['m0:s0:v0 p64@quarter'])
  assert.deepEqual(diff, [
    { kind: 'removed', text: 'm0:s0:v0 p67@quarter' },
    { kind: 'added', text: 'm0:s0:v0 p64@quarter' },
  ])
})

test('state: commit advances round, snapshot, and fingerprint', async () => {
  const dir = await freshWorkdir()
  const probeBefore = await syncProbe(dir)
  assert.equal(probeBefore.exists, true)
  assert.equal(probeBefore.fingerprintMatches, false, 'no manifest yet')
  assert.equal(probeBefore.verdict?.wellFormed, true)

  const committed = await commitScore(dir, 'agent', '初始提交')
  assert.equal(committed.commitId, 'v000001')
  assert.equal(committed.round, 1)

  const manifest = await readManifest(dir)
  assert.ok(manifest !== null)
  assert.equal(manifest.round, 1)
  assert.equal(manifest.history.length, 1)
  assert.equal(manifest.history[0].commitId, 'v000001')
  assert.equal(manifest.history[0].by, 'agent')
  assert.equal(manifest.fingerprints.mscs, probeBefore.fingerprint, 'manifest fingerprint matches the file')

  const probeAfter = await syncProbe(dir)
  assert.equal(probeAfter.fingerprintMatches, true)
})

test('state: edit applies unique anchored replacement and detects stale writes', async () => {
  const dir = await freshWorkdir()
  const applied = await editScore(dir, {
    anchor: '<pitch>67</pitch>',
    expected: '<pitch>67</pitch>',
    replacement: '<pitch>64</pitch>',
  })
  assert.equal(applied.applied, true)
  const after = mscxOfContainer((await readFile(join(dir, 'score.mscs'), 'utf8')))
  assert.ok(after !== null)
  assert.ok(!after.mscx.includes('<pitch>67</pitch>'))
  assert.ok(after.mscx.includes('<pitch>64</pitch>'))
  assert.equal(smokeCounts(after.mscx).wellFormed, true)

  // The same edit is stale now: the anchor vanished.
  await assert.rejects(
    editScore(dir, {
      anchor: '<pitch>67</pitch>',
      expected: '<pitch>67</pitch>',
      replacement: '<pitch>65</pitch>',
    }),
    // eslint-disable-next-line unicorn/prevent-abbreviations
    (error) => error instanceof ScoreWorkdirError && error.code === 'stale-write',
  )
})

test('state: a write that breaks structure is rejected before touching disk', async () => {
  const dir = await freshWorkdir()
  const before = await readFile(join(dir, 'score.mscs'), 'utf8')
  // Removing the closing root tag produces structurally broken output; the
  // post-write check must reject it and leave score.mscs untouched.
  await assert.rejects(
    editScore(dir, {
      anchor: '</Score>',
      expected: '</Score>',
      replacement: '',
    }),
    (error) => error instanceof ScoreWorkdirError && error.code === 'not-well-formed',
  )
  const after = await readFile(join(dir, 'score.mscs'), 'utf8')
  assert.equal(after, before, 'the failed edit left score.mscs untouched')
})

test('state: diff compares the last two committed views', async () => {
  const dir = await freshWorkdir()
  await assert.rejects(diffScore(dir), (error) => error instanceof ScoreWorkdirError)
  await commitScore(dir, 'agent', 'v1')
  await editScore(dir, {
    anchor: '<pitch>67</pitch>',
    expected: '<pitch>67</pitch>',
    replacement: '<pitch>64</pitch>',
  })
  await commitScore(dir, 'agent', 'v2: first note E4')
  const diff = await diffScore(dir)
  assert.equal(diff.from.label, 'v000001')
  assert.equal(diff.to.label, 'v000002')
  assert.ok(diff.rows.some(row => row.kind === 'removed' && row.text.includes('p67')))
  assert.ok(diff.rows.some(row => row.kind === 'added' && row.text.includes('p64')))
})

test('state: commit refuses a score that fails structure self-check', async () => {
  const dir = await freshWorkdir()
  const container = await fixtureContainer()
  const embedded = mscxOfContainer(container)
  assert.ok(embedded !== null)
  // Corrupt the mscx inside the container, then write it back.
  const broken = containerWithMscx(container, embedded.mscx.replace('</Score>', ''))
  await writeFile(join(dir, 'score.mscs'), broken)
  await assert.rejects(
    commitScore(dir, 'agent'),
    (error) => error instanceof ScoreWorkdirError && error.code === 'not-well-formed',
  )
})