import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { NS } from './locales';
/** Modal-style overlay that hosts the session-scoped engine viewer iframe. */
const overlayStyle = {
    position: 'fixed',
    top: 56,
    right: 16,
    zIndex: 100,
    width: 'min(1200px, 92vw)',
    height: 'min(820px, 88vh)',
    padding: 12,
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: 'var(--dsw-alias-bg-overlay)',
    color: 'var(--dsw-alias-label-primary)',
    font: '13px/1.6 var(--dsw-font-family)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
};
const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'move',
    userSelect: 'none',
};
const closeButtonStyle = {
    marginLeft: 'auto',
    color: 'var(--dsw-alias-label-secondary)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    font: 'inherit',
};
const frameStyle = {
    flex: 1,
    width: '100%',
    border: 0,
    borderRadius: 4,
    background: '#fff',
};
/**
 * Session-header entry point for the score panel. Renders nothing unless the
 * session runs the score-collab preset — the mode gate (R8) at UI level, the
 * mirror of composition-level tool gating. Opening the panel shows the
 * session-scoped MuseScore engine viewer inline (one iframe per session, its
 * own workdir and engine instance — sessions never share an editor).
 * @param props - runtime slot currency plus the namespace translator.
 * @returns the entry and its engine overlay, or null outside score-collab mode.
 */
export function ScorePanelToggle({ sessionId, useSessions, t }) {
    const preset = useSessions(state => state.byId[sessionId]?.agentPreset);
    const [open, setOpen] = useState(false);
    const [drag, setDrag] = useState(null);
    const overlayRef = useRef(null);
    if (preset !== 'score-collab')
        return null;
    // Drag the overlay by its header: track the pointer delta from the initial
    // overlay position and mirror it into left/top (overriding the default
    // right/top placement once dragged).
    const startDrag = (event) => {
        event.preventDefault();
        const rect = overlayRef.current?.getBoundingClientRect();
        const baseLeft = rect?.left ?? 0;
        const baseTop = rect?.top ?? 0;
        const startX = event.clientX;
        const startY = event.clientY;
        const move = (ev) => {
            setDrag({ x: baseLeft + ev.clientX - startX, y: baseTop + ev.clientY - startY });
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };
    const overlayPosition = drag === null
        ? { right: 16, top: 56 }
        : { left: drag.x, top: drag.y, right: 'auto' };
    return (_jsxs("div", { style: { display: 'inline-flex', alignItems: 'center', gap: 6 }, children: [_jsx("button", { type: "button", "aria-pressed": open, "aria-haspopup": "dialog", title: open ? t('entry.close') : t('entry.open'), onClick: () => setOpen(next => !next), style: { color: 'var(--dsw-alias-label-secondary)', background: 'none', border: 'none', cursor: 'pointer' }, children: t('entry.label') }), open
                ? (_jsxs("div", { ref: overlayRef, style: { ...overlayStyle, ...overlayPosition }, role: "dialog", "aria-label": t('panel.title'), children: [_jsxs("div", { style: headerStyle, onMouseDown: startDrag, children: [_jsx("strong", { children: t('panel.title') }), _jsx("span", { style: { opacity: 0.75 }, children: t('panel.session', { id: sessionId }) }), _jsx("button", { type: "button", title: t('entry.close'), onClick: () => setOpen(false), style: closeButtonStyle, children: "\u2715" })] }), _jsx("iframe", { src: `/score-collab/engine/viewer.html?session=${encodeURIComponent(sessionId)}`, style: frameStyle, title: "MuseScore \u5F15\u64CE", allow: "autoplay; clipboard-write" })] }))
                : null] }));
}
//# sourceMappingURL=ScorePanelToggle.js.map