/**
 * Score-collab agent-plane tools: the score_sync / score_view / score_edit /
 * score_commit quartet, mounted only by the score-collab preset.
 *
 * Mode gating (R8) is composition-level: these rows exist only in the
 * score-collab preset's agent plane, so agents on every other preset never see
 * the tools — there is no runtime switch and no "disabled but present"
 * intermediate state.
 *
 * M1: the quartet is live against the workdir state machine (src/bridge). All
 * validation runs through the shared bridge: well-formedness + smoke after every
 * write (design §6), fingerprint drift in score_sync, view vocabulary in
 * score_view (summary/notes/diff), anchored edits with a post-write rollback.
 * @module @local/dsh-collab-score/score-tools
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { commitScore, createScore, diffScore, editScore, markScoreLoadPending, mscxOfContainer, projectNotes, projectSummary, readContainer, ScoreWorkdirError, syncProbe, verifyMscx, } from './bridge/index.js';
/** Stable Cordis plugin name of the score-tools row (mounted per preset). */
export const name = 'score-collab-score-tools';
/** Services required before the tools can register. */
export const inject = ['tools'];
/** Preview cap for score_view notes/diff rows: bounded model-facing payloads. */
const ROW_CAP = 400;
/**
 * Resolve the session workdir for one tool call: always the current session's
 * id (exec.agent.id) under the workdir root. There is no workdir argument —
 * the tools operate exclusively on the session they run in, so the agent can
 * never write into another session or guess a path.
 * @param exec - the tool execution context.
 * @param config - the tool row config.
 * @returns the resolved workdir absolute path.
 * @throws when no agent session is available.
 */
function resolveWorkdir(exec, config) {
    const sessionId = exec.agent?.id;
    if (!sessionId || sessionId === '') {
        throw new Error('无法确定会话工作目录（当前工具调用没有 agent 会话上下文）');
    }
    return join(config.workdirRoot ?? join(resolveDshHome(), 'collab-score'), sessionId);
}
/** Canonical JSON text renderer shared by the quartet. */
const renderText = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }];
/** Probe the workdir through the shared state machine (score_sync). */
async function probeWorkdir(workdir, signal) {
    const probe = await syncProbe(workdir);
    if (!probe.exists) {
        return {
            workdir, exists: false, files: probe.files,
            scoreId: null, round: null, fingerprintMatches: false, wellFormed: null,
            measures: 0, notes: 0,
            error: '工作目录尚无 score.mscs：先让用户提供样例或经面板保存一份',
        };
    }
    const smoke = probe.verdict === null
        ? { measures: 0, notes: 0 }
        : { measures: probe.verdict.smoke.measures, notes: probe.verdict.smoke.notes };
    return {
        workdir,
        exists: true,
        files: probe.files,
        scoreId: probe.manifest?.scoreId ?? null,
        round: probe.manifest?.round ?? null,
        fingerprintMatches: probe.fingerprintMatches,
        wellFormed: probe.verdict?.wellFormed ?? null,
        measures: smoke.measures,
        notes: smoke.notes,
        ...probe.verdict !== null && probe.verdict.error !== undefined ? { error: probe.verdict.error } : {},
    };
}
/** Render the bounded notes projection. */
function boundedNotes(mscx, cap) {
    const projection = projectNotes(mscx);
    const truncated = projection.notes.length > cap;
    return {
        notes: truncated ? projection.notes.slice(0, cap) : projection.notes,
        count: projection.notes.length,
        truncated,
    };
}
/** Render a bounded diff: rows kept capped, counts reported. */
function boundedDiff(workdir) {
    return diffScore(workdir).then((result) => {
        const rows = result.rows;
        const added = rows.filter(row => row.kind === 'added').length;
        const removed = rows.filter(row => row.kind === 'removed').length;
        const truncated = rows.length > ROW_CAP;
        return {
            rows: truncated ? rows.slice(0, ROW_CAP) : rows,
            from: result.from.label,
            to: result.to.label,
            added,
            removed,
            truncated,
        };
    });
}
/** Read one mscx for the view tools, with the structural verdict. */
async function readScoreWithVerdict(workdir) {
    const container = await readContainer(workdir);
    if (container === null)
        return { exists: false, mscx: null, wellFormed: false, error: '工作目录尚无 score.mscs' };
    const embedded = mscxOfContainer(container);
    if (embedded === null)
        return { exists: true, mscx: null, wellFormed: false, error: 'score.mscs 内没有 .mscx 文件' };
    const verdict = verifyMscx(embedded.mscx);
    return {
        exists: true,
        mscx: embedded.mscx,
        wellFormed: verdict.wellFormed,
        ...verdict.error === undefined ? {} : { error: verdict.error },
    };
}
/**
 * Score-tools row body: register the quartet.
 * @param ctx - plugin context carrying the tools registry.
 */
export function apply(ctx, config = {}) {
    const tools = [
        defineTool({
            name: 'score_sync',
            description: '定向乐谱工作区（回合第一个动作）：读取工作目录状态——score.mscs 存在性、manifest 的 scoreId/round、文件布局、指纹是否与 manifest 一致（他人改写检测）、结构自检（well-formed + 小节/音符烟雾）。',
            parameters: {},
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        workdir: { type: 'string' },
                        exists: { type: 'boolean' },
                        files: { type: 'array', items: { type: 'string' } },
                        scoreId: { type: 'json' },
                        round: { type: 'json' },
                        fingerprintMatches: { type: 'boolean' },
                        wellFormed: { type: 'json' },
                        measures: { type: 'integer' },
                        notes: { type: 'integer' },
                        error: { type: 'string' },
                    },
                },
                render: renderText,
            },
            async execute(args, exec) {
                return probeWorkdir(resolveWorkdir(exec, config), exec.signal);
            },
        }),
        defineTool({
            name: 'score_view',
            description: '读取乐谱视图（只读，绝不回写）。depth: summary=乐器/小节/拍号/调号/速度/排练标记；notes=按 staff/measure/voice 展开音符（pitch/tpc/duration/dots + loc 定位符）；diff=最近两提交的视图词汇差异（无提交时报告说明）。',
            parameters: { depth: {
                    type: 'string',
                    enum: ['summary', 'notes', 'diff'],
                    description: '视图深度：summary 概览 / notes 音符展开 / diff 版本差异',
                },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        depth: { type: 'string' },
                        exists: { type: 'boolean' },
                        workdir: { type: 'string' },
                        summary: { type: 'json' },
                        notes: { type: 'json' },
                        diff: { type: 'json' },
                        info: { type: 'string' },
                        error: { type: 'string' },
                    },
                },
                render: renderText,
            },
            async execute(args, exec) {
                void exec.signal;
                const workdir = resolveWorkdir(exec, config);
                const base = await readScoreWithVerdict(workdir);
                const outcome = {
                    depth: args.depth ?? 'summary',
                    exists: base.exists,
                    workdir,
                    ...base.error !== undefined ? { error: base.error } : {},
                };
                if (base.mscx === null)
                    return outcome;
                if (!base.wellFormed) {
                    outcome.error = `结构自检失败（视图仍可读取，但写面不可用）：${base.error ?? 'unknown'}`;
                    return outcome;
                }
                if (args.depth === 'summary') {
                    outcome.summary = projectSummary(base.mscx);
                }
                else if (args.depth === 'notes') {
                    const bounded = boundedNotes(base.mscx, ROW_CAP);
                    outcome.notes = { rows: bounded.notes, count: bounded.count, truncated: bounded.truncated };
                    if (bounded.truncated)
                        outcome.info = `音符行超过 ${ROW_CAP} 条，仅返回前 ${ROW_CAP} 条`;
                }
                else {
                    try {
                        outcome.diff = (await boundedDiff(workdir));
                    }
                    catch (error) {
                        outcome.info = error instanceof Error ? error.message : String(error);
                    }
                }
                return outcome;
            },
        }),
        defineTool({
            name: 'score_create',
            description: '在当前会话创建一份新乐谱（M2）：把空白模板（钢琴、4/4、单小节，无音符）写成 workdir/score.mscs（mscs 容器）并初始化 manifest，随后标记引擎重新加载——会话弹窗内的引擎会自动显示新乐谱。',
            parameters: {},
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        workdir: { type: 'string' },
                        summary: { type: 'string' },
                    },
                },
                render: renderText,
            },
            async execute(args, exec) {
                void exec.signal;
                const workdir = resolveWorkdir(exec, config);
                const template = await readFile(new URL('../assets/blank-template.mscx', import.meta.url), 'utf8');
                const result = await createScore(workdir, template);
                markScoreLoadPending(basename(workdir), 'score.mscs');
                return result;
            },
        }),
        defineTool({
            name: 'score_open',
            description: '在当前会话打开乐谱（M2）：把工作目录内的指定文件（默认 score.mscs）标记为引擎加载，面板/引擎随即重新加载显示。可先用 fs 工具把 mscz/mscx 文件放入工作目录再调用本工具；score_edit 后也用它（或自动）强制刷新显示。',
            parameters: { name: { type: 'string', description: '工作目录内的文件名（默认 score.mscs）；仅允许字母数字和 . _ -' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        workdir: { type: 'string' },
                        name: { type: 'string' },
                        exists: { type: 'boolean' },
                    },
                },
                render: renderText,
            },
            async execute(args, exec) {
                void exec.signal;
                const workdir = resolveWorkdir(exec, config);
                const name = args.name ?? 'score.mscs';
                if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
                    throw new Error(`invalid file name: ${name}`);
                }
                if (!existsSync(join(workdir, name))) {
                    return { workdir, name, exists: false };
                }
                markScoreLoadPending(basename(workdir), name);
                return { workdir, name, exists: true };
            },
        }),
        defineTool({
            name: 'score_edit',
            description: '以字节锚定方式修改 score.mscs（design §6）：期望旧值必须恰好出现一次且包含锚；写前比对（防陈旧写），写后结构自检（不合格则回滚），随后更新 manifest 指纹。完成编辑后自动标记引擎重新加载（当前会话面板即时显示修改）。随后应 score_commit 提交快照供用户复核。',
            parameters: { anchor: { type: 'string', required: true, description: '唯一锚字符串（定位修改处；例如 <pitch>67</pitch>）' },
                expected: { type: 'string', required: true, description: '锚所在位置的期望旧文本（必须恰好出现一次，且包含锚）' },
                replacement: { type: 'string', required: true, description: '新文本（替换整个 expected 段）' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        applied: { type: 'boolean' },
                        summary: { type: 'string' },
                    },
                },
                render: renderText,
            },
            async execute(args, exec) {
                void exec.signal;
                try {
                    const workdir = resolveWorkdir(exec, config);
                    const result = await editScore(workdir, {
                        anchor: args.anchor,
                        expected: args.expected,
                        replacement: args.replacement,
                    });
                    markScoreLoadPending(basename(workdir), 'score.mscs');
                    return result;
                }
                catch (error) {
                    if (error instanceof ScoreWorkdirError) {
                        throw new Error(`${error.code}: ${error.message}`);
                    }
                    throw error;
                }
            },
        }),
        defineTool({
            name: 'score_commit',
            description: '提交乐谱快照：把当前 score.mscs 存入 commits/vNNNNNN.mscs 并原子推进 manifest（round/指纹/history 增加一条）。提交前执行结构自检；返回视图词汇摘要供用户复核。提交后用户可在面板刷新查看。',
            parameters: { message: { type: 'string', description: '提交说明（可选）' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        commitId: { type: 'string' },
                        round: { type: 'integer' },
                        summary: { type: 'string' },
                    },
                },
                render: renderText,
            },
            async execute(args, exec) {
                void exec.signal;
                try {
                    return await commitScore(resolveWorkdir(exec, config), 'agent', args.message);
                }
                catch (error) {
                    if (error instanceof ScoreWorkdirError) {
                        throw new Error(`${error.code}: ${error.message}`);
                    }
                    throw error;
                }
            },
        }),
    ];
    for (const definition of tools) {
        ctx.effect(() => ctx.tools.register(definition), `score-collab: tool ${definition.name}`);
    }
}
//# sourceMappingURL=score-tools.js.map