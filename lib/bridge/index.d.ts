/**
 * The shared bridge module: mscs container codec, mscx projection/validation,
 * and the workdir state machine. Used by the agent-plane tools (score-tools)
 * and the host-plane server routes alike, so both sides of the collaboration
 * loop validate against the same code.
 * @module @local/dsh-collab-score/bridge
 */
export * from './container.js';
export * from './mscx.js';
export * from './state.js';
export * from './notify.js';
