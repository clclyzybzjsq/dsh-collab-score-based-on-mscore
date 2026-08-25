/**
 * Score-collab server half: namespaced web routes under `/score-collab/*` and
 * the best-effort score-collab preset self-install.
 *
 * Route discipline (design §2.2): the prefix `/score-collab` is unique, we
 * never touch the fallback seat (owned by frontend-static), and duplicate
 * paths throw — all part of the composition contract, so borrowing any of the
 * webserver table is a compatibility error. Engine WASM assets (M2) will be
 * served from this same prefix, never from the frontend dist.
 *
 * Preset self-install (S3 finding): `apps/cli/src/profile-boot.ts` composes
 * every CLI-booted profile with an overlay that REPLACES the agent-presets
 * row's `config.roots` with the single shipped root, so a bundle cannot add a
 * preset root through patch config. The roster always appends its derived
 * `$DSH_HOME/.agent-presets` user root, and `agentPresets.copy()` is the only
 * authoring write — so the bundle seeds the score-collab preset there once,
 * then overwrites the copied composition with its own bundled files. Later
 * boots leave an existing preset untouched (user edits are theirs).
 * @module @local/dsh-collab-score/server
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { atomicWriteText, consumeScoreLoadPending, decodeMscs, encodeMscs, ensureWorkdir, filterMscsEntries, fingerprint, readManifest, readZip, writeZip, } from './bridge/index.js';
/** Stable Cordis plugin name of the server row. */
export const name = 'score-collab-server';
/** Services required before routes can register. */
export const inject = ['webServer'];
const require = createRequire(import.meta.url);
/** This package's manifest, for health reporting. */
const pkg = require('../package.json');
/** Immutable extension → Content-Type map for engine web assets (no fallback seat). */
const ENGINE_MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.data': 'application/octet-stream',
    '.mem': 'application/octet-stream',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mss': 'text/plain; charset=utf-8',
};
/** Content-Type for a file name, by extension; unknown types serve as octet-stream. */
function mimeFor(file) {
    const dot = file.lastIndexOf('.');
    const ext = dot >= 0 ? file.slice(dot).toLowerCase() : '';
    return ENGINE_MIME[ext] ?? 'application/octet-stream';
}
/** Whether `target` stays inside `root` (equal or a descendant). */
function contained(root, target) {
    const base = resolve(root);
    const candidate = resolve(target);
    return candidate === base || candidate.startsWith(base + sep);
}
/** Directory entry names, sorted; absent or unreadable directory yields []. */
function listFiles(dir) {
    try {
        return readdirSync(dir).sort();
    }
    catch {
        return [];
    }
}
/** Cap on one engine-saved score upload (mscz archives stay well below this). */
const MAX_SCORE_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Collect the request body as a Buffer, bounded to avoid unbounded memory. */
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error(`body exceeds ${limit} bytes`));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
/**
 * Read one session's workdir state from disk through the shared bridge
 * manifest reader (design §4/§5: round, fingerprints, append-only history).
 * @param dir - the session's workdir.
 * @returns the state snapshot.
 */
async function readWorkdirState(dir) {
    const manifest = await readManifest(dir);
    const commits = manifest?.history ?? [];
    return {
        workdir: dir,
        exists: existsSync(join(dir, 'score.mscs')),
        files: listFiles(dir),
        ...manifest === null ? {} : { manifest },
        round: manifest?.round ?? null,
        lastCommit: commits.at(-1) ?? null,
        commits,
    };
}
/**
 * Build the `/score-collab/*` route handler for one workdir root and the engine
 * web build directory.
 * @param workdirRoot - root directory of all score workdirs.
 * @param engineDir - directory holding the engine web build (panel.html + engine/).
 * @returns the route handler.
 */
function makeHandler(workdirRoot, engineDir) {
    return async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://score-collab.local');
        const pathname = url.pathname;
        const readMethod = req.method === 'GET' || req.method === 'HEAD';
        if (readMethod && pathname === '/score-collab/health') {
            writeJson(res, 200, { ok: true, name: pkg.name, version: pkg.version, workdirRoot });
            return;
        }
        if (readMethod && pathname === '/score-collab/api/state') {
            const session = url.searchParams.get('session');
            if (session === null || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(session)) {
                writeJson(res, 400, { error: 'invalid session id' });
                return;
            }
            const dir = resolve(workdirRoot, session);
            if (!contained(workdirRoot, dir)) {
                writeJson(res, 400, { error: 'session escapes workdir root' });
                return;
            }
            const state = await readWorkdirState(dir);
            // M2 plugin bridge: one-shot "the agent wrote a score, reload the engine"
            // signal consumed here so the panel sees it exactly once.
            const pendingLoad = consumeScoreLoadPending(session);
            writeJson(res, 200, pendingLoad === null ? state : { ...state, pendingLoad });
            return;
        }
        // M2 plugin bridge: the panel pulls the score file bytes for the pending
        // load (and for any later "load current workdir score" request). The file
        // name is strictly validated to stay inside the session workdir. The
        // default `score.mscs` (the M1 write-truth container) is converted to an
        // mscz archive on the fly, because the engine sniffs standard score
        // formats (mscz/mscx/musicxml) and rejects the raw mscs container.
        const scoreMatch = pathname.match(/^\/score-collab\/api\/session\/([A-Za-z0-9][A-Za-z0-9-]*)\/score$/);
        if (readMethod && scoreMatch) {
            const session = scoreMatch[1];
            const name = url.searchParams.get('name') ?? 'score.mscs';
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
                writeJson(res, 400, { error: 'invalid file name' });
                return;
            }
            const dir = resolve(workdirRoot, session);
            if (!contained(workdirRoot, dir)) {
                writeJson(res, 400, { error: 'session escapes workdir root' });
                return;
            }
            if (name === 'score.mscs') {
                const file = join(dir, name);
                if (!existsSync(file)) {
                    writeJson(res, 404, { error: 'session has no score.mscs yet' });
                    return;
                }
                try {
                    const mscz = writeZip(decodeMscs(readFileSync(file, 'utf8')));
                    res.writeHead(200, {
                        'content-type': 'application/octet-stream',
                        'content-length': String(mscz.length),
                        'cache-control': 'no-store',
                    });
                    res.end(mscz);
                    return;
                }
                catch (error) {
                    writeJson(res, 400, {
                        error: `score.mscs 不是有效的 mscs 容器：${error instanceof Error ? error.message : String(error)}`,
                    });
                    return;
                }
            }
            serveStatic(res, join(dir, name));
            return;
        }
        // M2 plugin bridge (engine → workdir write-back): the browser half uploads
        // the engine-saved mscz bytes here; they are converted back to the mscs
        // container (the single write truth the agent tools operate on) and the
        // manifest's lastUserEdit/fingerprint advance.
        if (!readMethod && req.method === 'POST' && scoreMatch) {
            const session = scoreMatch[1];
            const dir = resolve(workdirRoot, session);
            if (!contained(workdirRoot, dir)) {
                writeJson(res, 400, { error: 'session escapes workdir root' });
                return;
            }
            try {
                const body = await readBody(req, MAX_SCORE_UPLOAD_BYTES);
                const entries = readZip(body);
                const container = encodeMscs(filterMscsEntries(entries)).toString('utf8');
                await ensureWorkdir(dir);
                await atomicWriteText(join(dir, 'score.mscs'), container);
                const manifest = (await readManifest(dir)) ?? {
                    scoreId: fingerprint(container).slice(0, 16),
                    round: 0,
                    fingerprints: { mscs: '' },
                    history: [],
                };
                const updated = {
                    ...manifest,
                    lastUserEdit: new Date().toISOString(),
                    fingerprints: { ...manifest.fingerprints, mscs: fingerprint(container) },
                };
                await atomicWriteText(join(dir, 'manifest.json'), JSON.stringify(updated, null, 2));
                writeJson(res, 200, { ok: true, bytes: body.length, round: updated.round, scoreId: updated.scoreId });
            }
            catch (error) {
                writeJson(res, 400, {
                    error: `保存回写失败：${error instanceof Error ? error.message : String(error)}`,
                });
            }
            return;
        }
        if (readMethod && pathname === '/score-collab/panel.html') {
            serveStatic(res, join(engineDir, 'panel.html'));
            return;
        }
        if (readMethod && pathname.startsWith('/score-collab/engine/')) {
            // Engine assets, always nested below panel.html's directory (design §3.3).
            // The browser half URL-encodes file names (e.g. "MS%20Basic.sf3"), and may
            // emit a double slash from directoryUrl + "/" + name, so decode each
            // segment and drop empty ones before resolving.
            const rel = pathname.slice('/score-collab/engine/'.length);
            if (rel === '' || rel.includes('..') || rel.includes('\\')) {
                writeJson(res, 400, { error: 'invalid asset path' });
                return;
            }
            let segments;
            try {
                segments = rel.split('/').filter(Boolean).map(seg => decodeURIComponent(seg));
            }
            catch {
                writeJson(res, 400, { error: 'invalid asset path encoding' });
                return;
            }
            serveStatic(res, join(engineDir, ...segments));
            return;
        }
        writeJson(res, 404, { error: 'not found' });
    };
}
/**
 * Stream a static file with a correct Content-Type; 404 as JSON when missing.
 * Path must be pre-validated by the caller (contained under its root).
 * @param res - the response.
 * @param file - resolved absolute file path.
 */
function serveStatic(res, file) {
    let size;
    try {
        size = statSync(file).size;
    }
    catch {
        writeJson(res, 404, { error: `no such asset: ${file}` });
        return;
    }
    res.writeHead(200, {
        'content-type': mimeFor(file),
        'content-length': String(size),
        'cache-control': file.endsWith('panel.html') ? 'no-store' : 'no-cache',
    });
    createReadStream(file).pipe(res);
}
/**
 * Seed the score-collab preset when the roster lacks it: copy from `standard`
 * into the derived user root, then overwrite the copy's composition and display
 * metadata with this bundle's own files. Idempotent — an existing preset is
 * never touched, so user edits survive restarts.
 *
 * The roster row activates asynchronously relative to this row, so the service
 * is awaited here rather than at apply time: one-shot `ctx.get` would race the
 * boot and silently skip the install on unlucky orderings.
 * @param ctx - plugin context carrying the roster service.
 */
async function ensurePresetInstalled(ctx) {
    const deadline = Date.now() + 60_000;
    while (true) {
        const presets = ctx.get('agentPresets');
        if (presets != null) {
            await installOnce(ctx, presets);
            return;
        }
        if (Date.now() > deadline) {
            ctx.logger.warn('score-collab: agentPresets 服务未在 60s 内出现，跳过预设自安装');
            return;
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
    }
}
/** Copy-and-overwrite the preset exactly once; survives a concurrent boot's copy. */
async function installOnce(ctx, presets) {
    if ((await presets.list()).some(preset => preset.id === 'score-collab'))
        return;
    try {
        await presets.copy('standard', 'score-collab', '乐谱协作');
    }
    catch (error) {
        // A concurrent boot may have won the copy; a second list settles it.
        if ((await presets.list()).some(preset => preset.id === 'score-collab'))
            return;
        throw error;
    }
    const preset = await presets.resolve('score-collab');
    const dir = dirname(preset.path);
    const composition = readFileSync(new URL('../preset/score-collab/agent.cordis.yml', import.meta.url), 'utf8');
    const meta = readFileSync(new URL('../preset/score-collab/preset.yml', import.meta.url), 'utf8');
    await writeFile(join(dir, 'agent.cordis.yml'), composition);
    await writeFile(join(dir, 'preset.yml'), meta);
    ctx.logger.info('score-collab: 已安装「乐谱协作」预设（agentPresets.copy 自安装到用户预设根）');
}
/**
 * Server row body: register the namespaced routes, then seed the preset.
 * @param ctx - plugin context carrying webServer.
 * @param config - deployment config.
 */
export function apply(ctx, config = {}) {
    const workdirRoot = config.workdirRoot ?? join(resolveDshHome(), 'collab-score');
    // pluginRoot: lib/server.js lives one level below the package root
    // (score-collab/lib/server.js -> score-collab).
    const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const engineDir = config.engineDir ?? join(pluginRoot, 'engine-dist');
    const webServer = ctx.webServer;
    ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/score-collab',
        handler: makeHandler(workdirRoot, engineDir),
    }), 'score-collab: /score-collab/* routes');
    if (config.installPreset !== false) {
        void ensurePresetInstalled(ctx)
            .catch(error => ctx.logger.warn(`score-collab: 预设自安装失败: ${error instanceof Error ? error.message : String(error)}`));
    }
}
/** Write one JSON response body. */
function writeJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(payload);
}
//# sourceMappingURL=server.js.map