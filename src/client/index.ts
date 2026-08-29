/**
 * Score-collab plugin, browser half: contributes one session-header action
 * that renders the score panel entry — visible only while the session runs
 * the score-collab preset (R8 UI gating, S7: session summaries carry
 * `agentPreset`, and `agent-preset/selected` refreshes them).
 *
 * UI state here (panel open/close, probe results) never enters the session
 * log: it is pure presentation, invisible to the model (repo rule).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ScorePanelToggle } from './ScorePanelToggle'
import { en, NS, zh, type ScoreKey } from './locales'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Score panel copy. */
    'scoreCollab': ScoreKey
  }
}

export type { ScorePanelToggleProps } from './ScorePanelToggle.tsx'

/** Required services for locale registration and header-slot contribution. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'score-collab: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'score-collab-entry',
      // After the subagent catalog and jobs: lineage first, process work, then score controls.
      order: 30,
      locale: NS,
    }, ScorePanelToggle),
  )
}