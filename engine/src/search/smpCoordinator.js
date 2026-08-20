/**
 * SMP coordinator — SKELETON. Owns thread count and bias policy. It does not
 * yet run a search; the current pipeline is untouched.
 *
 * Invocation path (planned):
 *
 *   setoption name Threads value N
 *       → UCIHandler._setThreads(N)
 *       → coordinator.setThreadCount(N)
 *
 *   go depth D
 *       → UCIHandler.go
 *           if coordinator.isMultiThreaded():
 *               plan   = coordinator.planSearch(board, D, rootMoves)   ← implemented
 *               result = await coordinator.run(plan)                   ← NOT WIRED (throws)
 *           else:
 *               result = engine.search(board, D, { bookHints })         ← current path
 *
 * Transition plan:
 *   Step 1 (this file):  policy + lifecycle skeleton, Threads option visible.
 *   Step 2:              run() with ONE worker; verify it reproduces the
 *                        single-threaded bestmove for a fixed depth.
 *   Step 3:              N workers, each with its own root bias; main thread
 *                        picks the deepest / best-scored result.
 *   Step 4:              LazySMPManager's SharedTranspositionTable wired into
 *                        SearchEngine so findings merge across workers.
 *
 * Bias policy (assignRootBiases): worker 0 is the unbiased "main" line. Worker
 * k is steered toward root move of rank (k mod n) by adding the deficit that
 * lifts it above the current top score. Every worker still searches every
 * root move — only the ORDER changes — so evaluation and ordering are honoured
 * and the bestmove is never something the ordering rejected. Overlap
 * minimisation between subtrees is a later refinement.
 */
import { LazySMPManager } from './lazySMP.js';

export const SMP_STATE = {
  IDLE:      'idle',
  SPAWNING:  'spawning',
  SEARCHING: 'searching',
  STOPPING:  'stopping',
  FAILED:    'failed',
};

const MIN_THREADS = 1;
const MAX_THREADS = 64;
/** Fallback bias when root moves have no orderScore yet (above the TT tier). */
const FALLBACK_BIAS = 3_000_000;

/**
 * @param {Array<{algebraic:string, orderScore?:number}>} rootMoves  sorted, best first
 * @param {number} threadCount
 * @returns {Array<Map<string,number>|null>} index = worker; null = unbiased
 */
export function assignRootBiases(rootMoves, threadCount) {
  const out = new Array(threadCount);
  out[0] = null;
  if (rootMoves.length === 0) {
    for (let k = 1; k < threadCount; k++) out[k] = null;
    return out;
  }
  const top = rootMoves[0].orderScore;
  for (let k = 1; k < threadCount; k++) {
    const target = rootMoves[k % rootMoves.length];
    const bias = new Map();
    if (typeof top === 'number' && typeof target.orderScore === 'number') {
      bias.set(target.algebraic, top - target.orderScore + 1);
    } else {
      bias.set(target.algebraic, FALLBACK_BIAS);
    }
    out[k] = bias;
  }
  return out;
}

export class SmpCoordinator {
  constructor(config = {}) {
    // ── Configuration ──
    this.threadCount = clampThreads(config.threads);
    this.hashSizeMB  = config.hashSizeMB || 64;
    // ── Lifecycle ──
    this.state = SMP_STATE.IDLE;
    this.manager = null;          // LazySMPManager, created on first spawn
    this.lastError = null;
    this.wired = false;           // flips when run() is implemented
  }

  // ───────── Configuration ─────────

  setThreadCount(n) {
    this.threadCount = clampThreads(n);
    return this.threadCount;
  }

  isMultiThreaded() { return this.threadCount > 1; }

  // ───────── Planning ─────────

  /**
   * Build the per-worker plan. Pure: no threads touched, safe to call from go.
   * @param {Board} board
   * @param {number} depth
   * @param {Array} rootMoves   scored + sorted root moves
   */
  planSearch(board, depth, rootMoves) {
    return {
      fen: board.toFen(),
      depth,
      threadCount: this.threadCount,
      biases: assignRootBiases(rootMoves, this.threadCount),
    };
  }

  // ───────── Execution (NOT WIRED) ─────────

  /**
   * Future entry point. Explicitly fails loud so a premature caller cannot
   * silently fall through to an empty result.
   */
  async run(plan) {
    this.lastError = new Error(
      `SMP.run not wired (threads=${plan.threadCount}); caller must use the single-threaded path`
    );
    this.state = SMP_STATE.FAILED;
    throw this.lastError;
  }

  /** Step 2 will call this before run(). Left uncalled on purpose. */
  ensureSpawned() {
    if (this.manager !== null) return this.manager;
    this.state = SMP_STATE.SPAWNING;
    this.manager = new LazySMPManager(this.threadCount - 1, null);
    return this.manager;
  }

  stop() {
    if (this.manager === null) return;
    this.state = SMP_STATE.STOPPING;
    this.manager.stop();
    this.state = SMP_STATE.IDLE;
  }

  terminate() {
    if (this.manager === null) return;
    this.manager.terminate();
    this.manager = null;
    this.state = SMP_STATE.IDLE;
  }

  // ───────── Introspection ─────────

  describe() {
    return `threads=${this.threadCount} state=${this.state} wired=${this.wired}` +
           (this.lastError !== null ? ` lastError="${this.lastError.message}"` : '');
  }
}

function clampThreads(n) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return MIN_THREADS;
  if (v < MIN_THREADS) return MIN_THREADS;
  if (v > MAX_THREADS) return MAX_THREADS;
  return v;
}

export default SmpCoordinator;