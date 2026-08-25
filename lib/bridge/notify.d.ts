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
/** One pending reload request. */
export interface PendingLoad {
    /** File name inside the workdir to load into the engine. */
    name: string;
    /** ISO timestamp of when the agent marked it (diagnostics/ordering). */
    ts: string;
}
/**
 * Mark one session's score as needing an engine reload.
 * @param sessionId - session id (workdir basename under the workdir root).
 * @param name - file name inside the workdir to load.
 */
export declare function markScoreLoadPending(sessionId: string, name: string): void;
/**
 * Read and clear the pending reload for one session (one-shot: the panel
 * consumes it and loads the file; the next poll sees no pending load).
 * @param sessionId - session id.
 * @returns the pending load, or null when nothing is pending.
 */
export declare function consumeScoreLoadPending(sessionId: string): PendingLoad | null;
