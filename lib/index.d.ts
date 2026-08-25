/**
 * Score-collab plugin — host node half of the browser row.
 *
 * This entry is the inert node half of the `score-collab-client` row: the
 * package exists in the host composition so the modules graph scans its
 * `dsh.client` declaration, while the browser half ships via exports["./client"].
 * The bundle's actual host behavior lives in ./server.ts (routes + preset
 * self-install) and ./score-tools.ts (agent-plane tools, mounted by preset).
 * @module @local/dsh-collab-score
 */
/** Host plugin body — no host-side behavior in this entry. */
export declare function apply(): void;
