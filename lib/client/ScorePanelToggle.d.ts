import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales';
/** Full props for the session-header score action. */
export type ScorePanelToggleProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>;
/**
 * Session-header entry point for the score panel. Renders nothing unless the
 * session runs the score-collab preset — the mode gate (R8) at UI level, the
 * mirror of composition-level tool gating. Opening the panel shows the
 * session-scoped MuseScore engine viewer inline (one iframe per session, its
 * own workdir and engine instance — sessions never share an editor).
 * @param props - runtime slot currency plus the namespace translator.
 * @returns the entry and its engine overlay, or null outside score-collab mode.
 */
export declare function ScorePanelToggle({ sessionId, useSessions, t }: ScorePanelToggleProps): import("react").JSX.Element | null;
