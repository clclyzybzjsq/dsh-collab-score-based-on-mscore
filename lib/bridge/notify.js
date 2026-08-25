/**
 * Session-scoped "the engine should reload a score" signal (M2 plugin bridge).
 *
 * The agent-plane tools write score files into a session workdir on disk; the
 * browser panel polls the host routes for a pending load and then pushes the
 * bytes into the engine iframe. This module is the in-process handoff between
 * the two planes: `markScoreLoadPending` is called by the tools (after a
 * create/open/edit), `consumeScoreLoadPending` by the server's state route.
 * The key is the session id, i.e. the workdir basename under the workdir root.
 * @module @local/dsh-collab-score/bridge/notify
 */
/** Process-wide pending-load registry, keyed by session id. */
const pending = new Map();
/**
 * Mark one session's score as needing an engine reload.
 * @param sessionId - session id (workdir basename under the workdir root).
 * @param name - file name inside the workdir to load.
 */
export function markScoreLoadPending(sessionId, name) {
    pending.set(sessionId, { name, ts: new Date().toISOString() });
}
/**
 * Read and clear the pending reload for one session (one-shot: the panel
 * consumes it and loads the file; the next poll sees no pending load).
 * @param sessionId - session id.
 * @returns the pending load, or null when nothing is pending.
 */
export function consumeScoreLoadPending(sessionId) {
    const value = pending.get(sessionId);
    if (value === undefined)
        return null;
    pending.delete(sessionId);
    return value;
}
//# sourceMappingURL=notify.js.map