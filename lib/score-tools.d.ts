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
import type { Context } from '@deepseek-ai/cordis';
/** Stable Cordis plugin name of the score-tools row (mounted per preset). */
export declare const name = "score-collab-score-tools";
/** Services required before the tools can register. */
export declare const inject: string[];
/** Deployment-variable values; the default must mirror server.ts Config.workdirRoot. */
export interface Config {
    /** Root of all score workdirs; defaults to `<dshHome>/collab-score`. */
    workdirRoot?: string;
}
/**
 * Score-tools row body: register the quartet.
 * @param ctx - plugin context carrying the tools registry.
 */
export declare function apply(ctx: Context, config?: Config): void;
