#!/usr/bin/env node
/**
 * Score-collab test-server orchestration (design §8.2, R7).
 *
 * Boots an ISOLATED dsh web instance with this bundle installed: its own
 * DSH_HOME, its own `web` profile, its own port. It never reads the user's
 * harness home and never restarts or touches the running :3080 GUI.
 *
 * Steps: build the bundle → provision the isolated profile (`dsh plugin
 * --profile web add link:…`) → assert the composed tree contains our rows →
 * boot `dsh web --port <port> --no-open` as a child → verify
 * /score-collab/health, the /plugins client bundle, and the self-installed
 * score-collab preset → report (and stop, or keep serving with --keep).
 *
 * Usage:
 *   node scripts/test-server.mjs                # build, provision, verify, stop
 *   node scripts/test-server.mjs --keep         # leave the server running
 *   node scripts/test-server.mjs --port 3181    # another port
 *   node scripts/test-server.mjs --test-home .test/m1-home  # isolated home lane
 *   node scripts/test-server.mjs --no-clean     # reuse the existing test home
 *   node scripts/test-server.mjs --no-build     # skip the bundle build step
 */

import { spawn, spawnSync } from 'node:child_process'
import { copyFile as copyFileAsync } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKOUT = 'D:/deepseek-harness'
const PACKAGE_DIR = ROOT
const PACKAGE_NAME = '@local/dsh-collab-score'
// The default test home. `--test-home <dir>` swaps it (e.g. a second lane that
// must not disturb a running --keep instance on the same default home).
const DEFAULT_TEST_HOME = join(ROOT, '.test', 'home')

const args = new Set(process.argv.slice(2))
const portArgIndex = process.argv.indexOf('--port')
const PORT = Number.parseInt(portArgIndex > 0 ? process.argv[portArgIndex + 1] : '3180', 10)
const homeArgIndex = process.argv.indexOf('--test-home')
const TEST_HOME = resolve(homeArgIndex > 0 ? process.argv[homeArgIndex + 1] : DEFAULT_TEST_HOME)
const KEEP = args.has('--keep')
const CLEAN = !args.has('--no-clean')
const BUILD = !args.has('--no-build')

const HOME_ENV = { ...process.env, DSH_HOME: TEST_HOME, DSH_TELEMETRY_DISABLED: '1' }

function fatal(message) {
  console.error(`[score-collab:test] FAIL ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

function runSync(label, command, env = {}) {
  console.log(`\n[score-collab:test] ${label}\n  $ ${command}`)
  const result = spawnSync(command, { cwd: CHECKOUT, env: { ...HOME_ENV, ...env }, shell: process.platform === 'win32', stdio: 'inherit' })
  if (result.status !== 0) fatal(`${label} failed (exit ${result.status})\n${result.stderr?.toString() ?? ''}`)
  return result
}

function runCapture(command, env = {}) {
  const result = spawnSync(command, { cwd: CHECKOUT, env: { ...HOME_ENV, ...env }, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Kill a spawned process tree (Windows: taskkill /T, since child.kill() only hits the cmd/pnpm shim). */
function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync(`taskkill /PID ${pid} /T /F`, { shell: true, stdio: 'ignore' })
  } else {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
  }
}

/** Require the target port to be free before boot, so verification can never hit a stale instance. */
async function requirePortFree(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/score-collab/health`)
    if (response.ok) fatal(`port ${port} already serves a (leftover) instance — clean it up first`)
  } catch { /* refused or unreachable: free */ }
}

async function pollHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const body = await response.json()
        if (body.ok === true) return body
      }
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1000))
  }
  fatal(`server not healthy within ${timeoutMs}ms (last: ${last})`)
}

/** Call one BFF unary RPC and return the parsed ServerResponse. */
async function rpc(port, method, payload, rpcId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  if (response.status !== 200) fatal(`${method} → HTTP ${response.status}`)
  return await response.json()
}

/** Prove the score-collab preset really MOUNTS: create a session on it. */
async function verifyMount(port) {
  const created = await rpc(port, 'session.create', { agentPreset: 'score-collab' }, 'sc-test-mount')
  if (created.result?.ok !== true) {
    fatal(`score-collab preset did not mount: ${JSON.stringify(created.result?.error ?? created)}`)
  }
  if (created.result.value.agentPreset !== 'score-collab') {
    fatal(`created session runs "${created.result.value.agentPreset}" instead of score-collab`)
  }
  console.log(`[score-collab:test] score-collab preset mounts (session ${created.result.value.sessionId})`)
}

/**
 * Prove the M1 turn state machine end to end: drive the shared bridge (the same
 * code the tools run) to plant a committed score in the test instance's home,
 * then read it back through the live /score-collab/api/state route and assert
 * round/commits/lastCommit/fingerprint agreement.
 */
async function verifyState(port) {
  const { ensureWorkdir, commitScore, editScore, readManifest, syncProbe } = await import('../lib/bridge/index.js')
  const workdir = join(TEST_HOME, 'collab-score', 'm1-state-check')
  await ensureWorkdir(workdir)
  await copyFileAsync(join(ROOT, 'test', 'fixtures', 'beams-1.mscs'), join(workdir, 'score.mscs'))
  const first = await commitScore(workdir, 'agent', '初始提交')
  if (first.commitId !== 'v000001') fatal(`first commit is ${first.commitId}, expected v000001`)
  await editScore(workdir, {
    anchor: '<pitch>67</pitch>',
    expected: '<pitch>67</pitch>',
    replacement: '<pitch>64</pitch>',
  })
  const second = await commitScore(workdir, 'agent', '首音改 E4')
  if (second.commitId !== 'v000002') fatal(`second commit is ${second.commitId}, expected v000002`)

  const state = await fetch(`http://127.0.0.1:${port}/score-collab/api/state?session=m1-state-check`)
  const body = await state.json()
  if (body.round !== 2) fatal(`state.round is ${body.round}, expected 2`)
  if (body.commits?.length !== 2) fatal(`state.commits has ${body.commits?.length} entries, expected 2`)
  if (body.lastCommit?.commitId !== 'v000002') fatal(`state.lastCommit is ${body.lastCommit?.commitId}, expected v000002`)
  if (body.lastCommit?.by !== 'agent') fatal(`state.lastCommit.by is ${body.lastCommit?.by}, expected agent`)
  const probe = await syncProbe(workdir)
  if (!probe.fingerprintMatches) fatal('manifest fingerprint drifted from score.mscs after the M1 turn sequence')
  const manifest = await readManifest(workdir)
  const secondSummary = manifest?.history[1]?.summary ?? ''
  if (!secondSummary.includes('首音改 E4') || !secondSummary.includes('7 音符')) {
    fatal(`second commit summary does not mirror the view at commit time: ${secondSummary}`)
  }
  console.log(`[score-collab:test] M1 turn state machine roundtrip (round ${body.round}, commits ${body.commits.length})`)
}

/**
 * Prove the M2 engine web build is served: the panel shell and the engine
 * assets (viewer index.html, qtloader, the 65MB wasm head) must resolve under
 * the /score-collab engine routes with sane content types.
 */
async function verifyEngine(port) {
  const panel = await fetch(`http://127.0.0.1:${PORT}/score-collab/panel.html`)
  if (panel.status !== 200) fatal(`panel.html → HTTP ${panel.status}`)
  const panelText = await panel.text()
  if (!panelText.includes('score-collab/engine')) fatal('panel.html does not reference the engine iframe URL')

  const engineHtml = await fetch(`http://127.0.0.1:${PORT}/score-collab/engine/index.html`)
  if (engineHtml.status !== 200) fatal(`engine index.html → HTTP ${engineHtml.status}`)

  // index.html redirects to viewer.html, which is the real viewer shell.
  const viewer = await fetch(`http://127.0.0.1:${PORT}/score-collab/engine/viewer.html`)
  if (viewer.status !== 200) fatal(`engine viewer.html → HTTP ${viewer.status}`)
  const viewerText = await viewer.text()
  if (!viewerText.includes('MuseScoreStudio')) fatal('engine viewer.html does not reference the MuseScoreStudio bundle')

  const qtloader = await fetch(`http://127.0.0.1:${PORT}/score-collab/engine/distr/qtloader.js`)
  if (qtloader.status !== 200) fatal(`engine qtloader.js → HTTP ${qtloader.status}`)

  const wasmHead = await fetch(`http://127.0.0.1:${PORT}/score-collab/engine/MuseScoreStudio.wasm`, { headers: { range: 'bytes=0-1023' } })
  if (wasmHead.status !== 206 && wasmHead.status !== 200) fatal(`engine MuseScoreStudio.wasm → HTTP ${wasmHead.status}`)

  console.log('[score-collab:test] engine static routes serve (panel + viewer + qtloader + wasm)')
}

/**
 * Prove the M2 engine-save write-back roundtrip: GET converts score.mscs to an
 * mscz the engine can open; POST persists an engine-saved mscz back into the
 * session workdir (converted to the mscs container) and advances
 * manifest.lastUserEdit; a second GET returns the edited note.
 */
async function verifyWriteBack(port) {
  const { ensureWorkdir, createScore, writeZip, readZip } = await import('../lib/bridge/index.js')
  const workdir = join(TEST_HOME, 'collab-score', 'wb-check')
  const template = readFileSync(join(ROOT, 'assets', 'blank-template.mscx'), 'utf8')
  await ensureWorkdir(workdir)
  await createScore(workdir, template)

  const get = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/score-collab/api/session/wb-check/score`)
    if (response.status !== 200) fatal(`GET score → HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  const mscz = await get()
  const mscx = readZip(mscz).find(entry => entry.name.endsWith('.mscx'))
  if (!mscx) fatal('GET score did not return an mscz with score.mscx')

  const editedMscx = mscx.data.toString('utf8').replace(
    /<BarLine>/,
    '<Chord><durationType>quarter</durationType><Note><pitch>60</pitch><tpc>15</tpc></Note></Chord><BarLine>',
  )
  const editedMscz = writeZip([{ name: 'score.mscx', data: Buffer.from(editedMscx, 'utf8') }])
  const post = await fetch(`http://127.0.0.1:${port}/score-collab/api/session/wb-check/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: editedMscz,
  })
  if (post.status !== 200) fatal(`POST score → HTTP ${post.status}: ${await post.text()}`)

  const state = await (await fetch(`http://127.0.0.1:${port}/score-collab/api/state?session=wb-check`)).json()
  if (!state.manifest?.lastUserEdit) fatal('write-back did not set manifest.lastUserEdit')

  const back = await get()
  const backMscx = readZip(back).find(entry => entry.name.endsWith('.mscx'))?.data.toString('utf8') ?? ''
  if (!backMscx.includes('<pitch>60</pitch>')) fatal('edited note did not survive the write-back roundtrip')

  console.log('[score-collab:test] engine save write-back roundtrip (GET mscz, POST edit, lastUserEdit, note persisted)')
}

async function main() {
  if (!existsSync(join(CHECKOUT, 'package.json'))) fatal(`checkout not found at ${CHECKOUT}`)
  if (BUILD) runSync('build bundle', `pnpm.cmd -C "${PACKAGE_DIR.replaceAll('\\', '/')}" run build`)
  if (CLEAN) rmSync(TEST_HOME, { recursive: true, force: true })
  mkdirSync(TEST_HOME, { recursive: true })

  // 1. Install the bundle into the isolated profile (auto-initializes the `web`
  //    profile template; link: keeps iterating without re-copying).
  runSync('provision profile', `pnpm.cmd dsh plugin --profile web add link:${PACKAGE_DIR.replaceAll('\\', '/')}`)

  // 2. Assert the composed tree carries our rows (bundle layer reached the boot).
  const dump = runCapture('pnpm.cmd dsh --profile web --dump-config')
  if (dump.status !== 0) fatal(`dump-config failed\n${dump.stderr}`)
  for (const marker of ['score-collab-server', '@local/dsh-collab-score/server', '@local/dsh-collab-score']) {
    if (!dump.stdout.includes(marker)) fatal(`composed tree missing marker ${marker}`)
  }
  console.log('[score-collab:test] composed tree contains the score-collab rows')

  // 3. The port must be free: a stale instance would answer health and state
  //    checks with another home's data, failing or masking this run.
  await requirePortFree(PORT)

  // 4. Boot the test instance as a managed child (never :3080, isolated home).
  const command = `pnpm.cmd dsh web --port ${PORT} --no-open`
  console.log(`\n[score-collab:test] boot test instance\n  $ ${command}  (DSH_HOME=${TEST_HOME})`)
  const child = KEEP
    ? spawn(command, { cwd: CHECKOUT, env: HOME_ENV, shell: process.platform === 'win32', stdio: 'ignore', detached: true })
    : spawn(command, { cwd: CHECKOUT, env: HOME_ENV, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })

  let stdout = ''
  let stderr = ''
  if (!KEEP) {
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
  }

  if (KEEP) {
    const pidFile = join(ROOT, '.test', `web-${PORT}.pid`)
    writeFileSync(pidFile, String(child.pid))
    console.log(`[score-collab:test] server pid ${child.pid} recorded at ${pidFile}`)
  }

  try {
    const health = await pollHealth(`http://127.0.0.1:${PORT}/score-collab/health`, 180_000)
    console.log(`[score-collab:test] health OK: ${JSON.stringify(health)}`)

    // 5. The client bundle is served by the modules node half.
    const bundleUrl = `http://127.0.0.1:${PORT}/plugins/${PACKAGE_NAME}/client.js`
    const bundle = await fetch(bundleUrl)
    if (bundle.status !== 200) fatal(`client bundle ${bundleUrl} → HTTP ${bundle.status}`)
    const bundleText = await bundle.text()
    if (!bundleText.includes('__ModuleLoader__.load')) fatal('client bundle lacks the module-loader handoff')
    console.log('[score-collab:test] client bundle served with module-loader handoff')

    // 6. The score-collab preset self-installed into the user preset root.
    //    Poll for CONTENT, not existence: `copy()` creates the files, and the
    //    bundled-composition overwrite lands a moment later — reading on
    //    existence alone would see standard's composition mid-write.
    const presetFile = join(TEST_HOME, '.agent-presets', 'score-collab', 'agent.cordis.yml')
    const metaFile = join(TEST_HOME, '.agent-presets', 'score-collab', 'preset.yml')
    const deadlinePreset = Date.now() + 60_000
    let composition = ''
    while (Date.now() < deadlinePreset) {
      if (existsSync(presetFile) && existsSync(metaFile)) {
        composition = readFileSync(presetFile, 'utf8')
        const meta = readFileSync(metaFile, 'utf8')
        if (
          composition.includes('score-collab 模式')
          && composition.includes('score-tools')
          && meta.includes('乐谱协作')
        ) break
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1000))
    }
    if (!composition.includes('score-tools')) fatal('score-collab preset was not self-installed with the bundled composition')
    console.log('[score-collab:test] score-collab preset self-installed (composition = bundled)')

    // 6b. The regression that M0-close missed: the preset must really MOUNT, not
    //     just sit on disk. Creating a score-collab session exercises the full
    //     compose → mount → activate path; a row whose module cannot resolve,
    //     whose config is incomplete, or whose schema the value DSL rejects
    //     failed HERE with agent-preset-invalid.
    await verifyMount(PORT)

    // 6c. M1 turn state machine: plant a two-commit workdir via the shared
    //     bridge, then read it back through the live route and assert the
    //     manifest/fingerprint/commit-detail contract end to end.
    await verifyState(PORT)

    // 6c2. M2 engine-save write-back: mscz GET conversion + POST persistence.
    await verifyWriteBack(PORT)

    // 6d. M2 engine assets under the static routes (panel shell + viewer).
    await verifyEngine(PORT)

    console.log('[score-collab:test] workdir state endpoint:')
    const state = await (await fetch(`http://127.0.0.1:${PORT}/score-collab/api/state?session=smoke-test`)).json()
    console.log(`  ${JSON.stringify(state)}`)
  } catch (error) {
    const lastLog = buffer => buffer.split('\n').filter(Boolean).slice(-120).join('\n')
    if (stdout.trim() !== '' || stderr.trim() !== '') {
      console.log('\n[score-collab:test] --- child stdout tail ---\n' + lastLog(stdout))
      console.log('\n[score-collab:test] --- child stderr tail ---\n' + lastLog(stderr))
    }
    throw error
  } finally {
    if (!KEEP) {
      killTree(child.pid)
      console.log('[score-collab:test] test instance stopped')
    }
  }

  console.log(`\n[score-collab:test] PASS — ${KEEP ? `manual browser smoke at http://127.0.0.1:${PORT}` : 'all verifications green'}`)
  if (KEEP) console.log(`  stop: taskkill /PID ${child.pid} /T /F   (or delete .test\\web-${PORT}.pid)`)
}

main().catch(error => {
  console.error(error)
  process.exit(process.exitCode ?? 1)
})