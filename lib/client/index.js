import { ScorePanelToggle } from './ScorePanelToggle';
import { en, NS, zh } from './locales';
/** Required services for locale registration and header-slot contribution. */
export const inject = ['slots', 'locale'];
/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'score-collab: dictionaries');
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'score-collab-entry',
        // After the subagent catalog and jobs: lineage first, process work, then score controls.
        order: 30,
        locale: NS,
    }, ScorePanelToggle));
}
//# sourceMappingURL=index.js.map