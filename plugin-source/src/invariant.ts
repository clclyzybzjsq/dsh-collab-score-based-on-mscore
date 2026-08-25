/**
 * Package-owned invariant companion for `@local/dsh-collab-score`.
 * @module @local/dsh-collab-score/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@local/dsh-collab-score'

/** Cordis companion plugin name. */
export const name = 'score-collab-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant yet: the M0 skeleton owns the invariant that every
 * forward write (edit/commit) passes the pre-write fingerprint compare plus an
 * atomic commit-point replace (design §5, soft lock); that relationship arrives
 * with the M1 bridge, which is when the check installs here. Until then the
 * package emits no cordis events and owns no cross-plugin mutable state; both
 * slot registration and route registration prove disposal through this entry.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))