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
import type { Context } from '@deepseek-ai/cordis';
/** Stable Cordis plugin name of the server row. */
export declare const name = "score-collab-server";
/** Services required before routes can register. */
export declare const inject: string[];
/** Deployment-variable values; validated Config fields, never hardcoded tunables. */
export interface Config {
    /** Root of all score workdirs; defaults to `<dshHome>/collab-score` (environment truth, overridable per deployment). */
    workdirRoot?: string;
    /** Whether the plugin self-installs the score-collab preset when missing. Default true. */
    installPreset?: boolean;
    /** Directory with the engine web build (`panel.html`, `engine/*` assets); defaults to `<pluginRoot>/engine-dist`. */
    engineDir?: string;
}
/**
 * Server row body: register the namespaced routes, then seed the preset.
 * @param ctx - plugin context carrying webServer.
 * @param config - deployment config.
 */
export declare function apply(ctx: Context, config?: Config): void;
