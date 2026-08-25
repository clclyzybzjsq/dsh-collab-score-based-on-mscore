/**
 * Score-collab plugin, browser half: contributes one session-header action
 * that renders the score panel entry — visible only while the session runs
 * the score-collab preset (R8 UI gating, S7: session summaries carry
 * `agentPreset`, and `agent-preset/selected` refreshes them).
 *
 * UI state here (panel open/close, probe results) never enters the session
 * log: it is pure presentation, invisible to the model (repo rule).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type ScoreKey } from './locales';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Score panel copy. */
        'scoreCollab': ScoreKey;
    }
}
export type { ScorePanelToggleProps } from './ScorePanelToggle.tsx';
/** Required services for locale registration and header-slot contribution. */
export declare const inject: string[];
/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
