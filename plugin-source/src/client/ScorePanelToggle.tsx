import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales'

/** Full props for the session-header score action. */
export type ScorePanelToggleProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>

/** Modal-style overlay that hosts the session-scoped engine viewer iframe. */
const overlayStyle: CSSProperties = {
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
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'move',
  userSelect: 'none',
}

const closeButtonStyle: CSSProperties = {
  marginLeft: 'auto',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  font: 'inherit',
}

const frameStyle: CSSProperties = {
  flex: 1,
  width: '100%',
  border: 0,
  borderRadius: 4,
  background: '#fff',
}

/**
 * Session-header entry point for the score panel. Renders nothing unless the
 * session runs the score-collab preset — the mode gate (R8) at UI level, the
 * mirror of composition-level tool gating. Opening the panel shows the
 * session-scoped MuseScore engine viewer inline (one iframe per session, its
 * own workdir and engine instance — sessions never share an editor).
 * @param props - runtime slot currency plus the namespace translator.
 * @returns the entry and its engine overlay, or null outside score-collab mode.
 */
export function ScorePanelToggle({ sessionId, useSessions, t }: ScorePanelToggleProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)

  if (preset !== 'score-collab') return null

  // Drag the overlay by its header: track the pointer delta from the initial
  // overlay position and mirror it into left/top (overriding the default
  // right/top placement once dragged).
  const startDrag = (event: ReactMouseEvent): void => {
    event.preventDefault()
    const rect = overlayRef.current?.getBoundingClientRect()
    const baseLeft = rect?.left ?? 0
    const baseTop = rect?.top ?? 0
    const startX = event.clientX
    const startY = event.clientY
    const move = (ev: globalThis.MouseEvent): void => {
      setDrag({ x: baseLeft + ev.clientX - startX, y: baseTop + ev.clientY - startY })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const overlayPosition: CSSProperties = drag === null
    ? { right: 16, top: 56 }
    : { left: drag.x, top: drag.y, right: 'auto' }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        aria-pressed={open}
        aria-haspopup="dialog"
        title={open ? t('entry.close') : t('entry.open')}
        onClick={() => setOpen(next => !next)}
        style={{ color: 'var(--dsw-alias-label-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        {t('entry.label')}
      </button>
      {open
        ? (
          <div ref={overlayRef} style={{ ...overlayStyle, ...overlayPosition }} role="dialog" aria-label={t('panel.title')}>
            <div style={headerStyle} onMouseDown={startDrag}>
              <strong>{t('panel.title')}</strong>
              <span style={{ opacity: 0.75 }}>{t('panel.session', { id: sessionId })}</span>
              <button
                type="button"
                title={t('entry.close')}
                onClick={() => setOpen(false)}
                style={closeButtonStyle}
              >
                ✕
              </button>
            </div>
            <iframe
              src={`/score-collab/engine/viewer.html?session=${encodeURIComponent(sessionId)}`}
              style={frameStyle}
              title="MuseScore 引擎"
              allow="autoplay; clipboard-write"
            />
          </div>
        )
        : null}
    </div>
  )
}
