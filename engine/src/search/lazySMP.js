/**
 * Lazy SMP primitives — shared transposition table, control block, helper
 * thread handle. Policy (who searches what, who wins, what is logged) lives in
 * smpCoordinator.js.
 *
 * OWNERSHIP. Each engine INSTANCE that runs with Threads > 1 owns exactly one
 * SharedTranspositionTable and one helper pool. The buffer is handed only to
 * that instance's main SearchEngine and its own workers: Lazy SMP shares a
 * table between THREADS of one engine, never between engines.
 *
 * ENTRY LAYOUT (4 × int32, lockless):
 *   [0] keyLo ^ w1 ^ w2     [1] keyHi ^ w1     [2] w1 = score
 *   [3] w2 = move(15) | depth(7) << 15 | flag(2) << 22 | age(8) << 24
 * A reader interleaving with a writer sees words from two stores; the XOR fold
 * makes that mix fail the key check (Hyatt/Mann lockless hashing), so a torn
 * entry is a MISS, never a wrong score. `tornSuspect` counts reads whose high
 * key matched but low key did not — at 2^-32 odds of a genuine collision, that
 * is a torn write. w2 is never 0 for a live entry (stored depth ≥ 1).
 *
 * CONTROL BLOCK (Int32Array over its own SharedArrayBuffer):
 *   header   AGE, SEARCH_ID, STOP_ID, TARGET_DEPTH,
 *            NEXT_UNIT, UNIT_COUNT, ALPHA, ITER          (pv-split work queue)
 *   slot k   per-helper status board, written by helper k, read by main
 *   unit i   pv-split root-move work unit results
 */
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import { TT_FLAG, encodeMove, allocateTableSerial } from '../tables/transposition.js';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'smpWorker.js');
// ═══════════════════════════════════════════════════════════════════════════
// Control block
// ═══════════════════════════════════════════════════════════════════════════
export const CTRL = Object.freeze({
  AGE: 0, SEARCH_ID: 1, STOP_ID: 2, TARGET_DEPTH: 3,
  NEXT_UNIT: 4, UNIT_COUNT: 5, ALPHA: 6, ITER: 7,
  HEADER: 8,
});
export const SLOT = Object.freeze({
  STATE: 0, SEARCH_ID: 1, DEPTH: 2, COMPLETED: 3, NODES: 4,
  SELDEPTH: 5, POLL_MS: 6, BEST: 7, SCORE: 8, POLLS: 9,
});
export const SLOT_STRIDE = 10;
export const MAX_SLOTS = 65;
export const SLOT_STATE = Object.freeze({ IDLE: 0, SEARCHING: 1, DONE: 2, ERROR: 3 });
/** pv-split work unit: one root move at one iteration depth. */
export const UNIT = Object.freeze({ STATE: 0, SCORE: 1, FLAG: 2, THREAD: 3, NODES: 4, MICROS: 5 });
export const UNIT_STRIDE = 6;
export const MAX_UNITS = 256;     // > 218, the maximum number of legal moves
export const UNIT_STATE = Object.freeze({ PENDING: 0, CLAIMED: 1, DONE: 2, ABORTED: 3 });
export const UNIT_FLAG = Object.freeze({ UPPER: 0, EXACT: 1 });
const UNIT_BASE = CTRL.HEADER + MAX_SLOTS * SLOT_STRIDE;

export function slotBase(threadIndex) { return CTRL.HEADER + threadIndex * SLOT_STRIDE; }

export function unitBase(i) { return UNIT_BASE + i * UNIT_STRIDE; }

export function createControlBuffer() {
  return new SharedArrayBuffer((UNIT_BASE + MAX_UNITS * UNIT_STRIDE) * 4);
}

/**
 * High-resolution epoch milliseconds, comparable ACROSS threads. Each worker
 * has its own performance.timeOrigin, so performance.now() alone is not.
 */
export function hrNow() { return performance.timeOrigin + performance.now(); }
export function availableCpus() {
  return typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
}

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Monotone max on the shared root alpha. Lock-free; in C: atomic_compare_exchange loop. */
export function raiseSharedAlpha(ctrl, score) {
  for (;;) {
    const cur = Atomics.load(ctrl, CTRL.ALPHA);
    if (score <= cur) return;
    if (Atomics.compareExchange(ctrl, CTRL.ALPHA, cur, score) === cur) return;
  }
}

/**
 * Execute one claimed pv-split unit and publish it. Shared by the main thread
 * and helpers so both follow byte-identical rules. STATE is written LAST, so a
 * reader that sees DONE sees the score/flag/nodes of the same unit.
 * @returns {boolean} true when the unit completed (not aborted)
 */
export function runSplitUnit(engine, board, move, depth, ctrl, i, thread) {
  const ub = unitBase(i);
  Atomics.store(ctrl, ub + UNIT.THREAD, thread);
  Atomics.store(ctrl, ub + UNIT.STATE, UNIT_STATE.CLAIMED);
  const nodes0 = engine.nodes;
  const t0 = hrNow();
  engine.searchSplitUnit(board, move, depth, ctrl);
  if (engine.stopSearch) {
    Atomics.store(ctrl, ub + UNIT.STATE, UNIT_STATE.ABORTED);
    return false;
  }
  Atomics.store(ctrl, ub + UNIT.SCORE, engine.unitScore | 0);
  Atomics.store(ctrl, ub + UNIT.FLAG, engine.unitFlag);
  Atomics.store(ctrl, ub + UNIT.NODES, (engine.nodes - nodes0) & 0x7FFFFFFF);
  Atomics.store(ctrl, ub + UNIT.MICROS, Math.min(0x7FFFFFFF, Math.round((hrNow() - t0) * 1000)));
  Atomics.store(ctrl, ub + UNIT.STATE, UNIT_STATE.DONE);
  return true;
}
// ═══════════════════════════════════════════════════════════════════════════
// Shared transposition table — same API as TranspositionTable
// ═══════════════════════════════════════════════════════════════════════════
const ENTRY_INTS = 4;
const ENTRY_BYTES = ENTRY_INTS * 4;
const LO_MASK = 0xFFFFFFFFn;
const FILL_SAMPLE = 1024;
export class SharedTranspositionTable {
  /**
   * Owner:  new SharedTranspositionTable({ sizeMB })
   * Helper: new SharedTranspositionTable({ ttBuffer, ctrlBuffer, serial, sizeMB, role: 'helper' })
   */
  constructor({ sizeMB = 64, ttBuffer = null, ctrlBuffer = null, serial = 0, role = 'owner' } = {}) {
    if (ttBuffer === null) {
      const n = Math.floor((sizeMB * 1024 * 1024) / ENTRY_BYTES);
      let pow2 = 2;
      while (pow2 * 2 <= n) pow2 *= 2;
      ttBuffer = new SharedArrayBuffer(pow2 * ENTRY_BYTES);
    }
    this.buffer = ttBuffer;
    this.view = new Int32Array(ttBuffer);
    this.size = this.view.length / ENTRY_INTS;
    this.indexMask = (this.size - 1) & ~1;
    this.ctrlBuffer = ctrlBuffer ?? createControlBuffer();
    this.ctrl = new Int32Array(this.ctrlBuffer);
    this.serial = serial > 0 ? serial : allocateTableSerial();
    this.kind = 'shared';
    this.role = role;
    this.sizeMB = sizeMB;
    this.owner = null;
    this._age = Atomics.load(this.ctrl, CTRL.AGE) & 0xFF;
    this._w1 = 0; this._w2 = 0;
    this.hits = 0; this.misses = 0; this.stores = 0; this.collisions = 0;
    this.tornSuspect = 0; this.hitAgeSum = 0; this.hitDepthSum = 0;
    this._probeResult = { hit: false, usable: false, score: 0, flag: 0, move: 0, age: 0, depth: 0 };
  }
  get id() { return `tt#${this.serial}:${this.kind}:${this.size}`; }
  /** Validated slot for (lo,hi) in its bucket, or -1. Caches the words it validated. */
  _find(lo, hi) {
    const v = this.view;
    const a = lo & this.indexMask;
    for (let s = a; s <= (a | 1); s++) {
      const base = s << 2;
      const w2 = v[base + 3];
      if (w2 === 0) continue;
      const w1 = v[base + 2];
      const kh = v[base + 1] ^ w1;
      if (kh === hi) {
        if ((v[base] ^ w1 ^ w2) === lo) { this._w1 = w1; this._w2 = w2; return s; }
        this.tornSuspect++;
      }
    }
    return -1;
  }
  _write(i, lo, hi, depth, score, flag, bestMove) {
    const v = this.view, base = i << 2;
    const w1 = score | 0;
    const w2 = (encodeMove(bestMove) & 0x7FFF) | ((depth & 0x7F) << 15) |
               ((flag & 3) << 22) | ((this._age & 0xFF) << 24);
    v[base + 2] = w1;
    v[base + 3] = w2;
    v[base + 1] = hi ^ w1;
    v[base]     = lo ^ w1 ^ w2;
    this.stores++;
  }
  store(key, depth, score, flag, bestMove) {
    const lo = Number(key & LO_MASK) | 0;
    const hi = Number(key >> 32n) | 0;
    let i = this._find(lo, hi);
    if (i >= 0) {
      const w2 = this._w2;
      if (((w2 >>> 15) & 0x7F) > depth && ((w2 >>> 24) & 0xFF) === this._age) return;
      this._write(i, lo, hi, depth, score, flag, bestMove);
      return;
    }
    const a = lo & this.indexMask;
    const aw2 = this.view[(a << 2) + 3];
    const aStale = aw2 === 0 || ((aw2 >>> 24) & 0xFF) !== this._age;
    i = (aStale || ((aw2 >>> 15) & 0x7F) <= depth) ? a : (a | 1);
    if (this.view[(i << 2) + 3] !== 0) this.collisions++;
    this._write(i, lo, hi, depth, score, flag, bestMove);
  }
  probe(key, depth, alpha, beta) {
    const r = this._probeResult;
    const lo = Number(key & LO_MASK) | 0;
    const hi = Number(key >> 32n) | 0;
    if (this._find(lo, hi) < 0) {
      this.misses++;
      r.hit = false; r.usable = false; r.move = 0; r.score = 0; r.flag = 0; r.age = 0; r.depth = 0;
      return r;
    }
    const w1 = this._w1, w2 = this._w2;
    const storedDepth = (w2 >>> 15) & 0x7F;
    r.hit = true;
    r.move = w2 & 0x7FFF;
    r.age = (this._age - ((w2 >>> 24) & 0xFF)) & 0xFF;
    r.depth = storedDepth;
    if (storedDepth < depth) {
      this.misses++;
      r.usable = false; r.score = 0; r.flag = 0;
      return r;
    }
    this.hits++;
    this.hitAgeSum += r.age;
    this.hitDepthSum += storedDepth;
    const flag = (w2 >>> 22) & 3;
    r.score = w1;
    r.flag = flag;
    r.usable = flag === TT_FLAG.EXACT ||
               (flag === TT_FLAG.LOWER_BOUND && w1 >= beta) ||
               (flag === TT_FLAG.UPPER_BOUND && w1 <= alpha);
    return r;
  }
  getBestMove(key) {
    const lo = Number(key & LO_MASK) | 0;
    const hi = Number(key >> 32n) | 0;
    return this._find(lo, hi) >= 0 ? (this._w2 & 0x7FFF) : 0;
  }
  /** Per-thread stats reset + age snapshot. Age is ADVANCED only by the owner. */
  newSearch() {
    this._age = Atomics.load(this.ctrl, CTRL.AGE) & 0xFF;
    this.hits = 0; this.misses = 0; this.stores = 0; this.collisions = 0;
    this.tornSuspect = 0; this.hitAgeSum = 0; this.hitDepthSum = 0;
  }
  /** Owner only, before helpers are dispatched: every thread then sees one age. */
  advanceAge() {
    if (this.role !== 'owner') throw new Error(`${this.id}: advanceAge from a ${this.role} view`);
    Atomics.store(this.ctrl, CTRL.AGE, (Atomics.load(this.ctrl, CTRL.AGE) + 1) & 0xFF);
  }
  /** Owner only, with helpers idle (the coordinator guarantees this between searches). */
  clear() {
    if (this.role !== 'owner') throw new Error(`${this.id}: clear from a ${this.role} view`);
    this.view.fill(0);
    Atomics.store(this.ctrl, CTRL.AGE, 0);
    this._age = 0;
  }
  _fillPermille() {
    const sample = Math.min(FILL_SAMPLE, this.size);
    const stride = Math.max(1, Math.floor(this.size / sample));
    let used = 0, seen = 0;
    for (let i = 0; i < this.size; i += stride) {
      if (this.view[(i << 2) + 3] !== 0) used++;
      seen++;
    }
    return seen === 0 ? 0 : Math.round((used / seen) * 1000);
  }
  getStats() {
    const total = this.hits + this.misses;
    const fill = this._fillPermille();
    return {
      hits: this.hits, misses: this.misses, stores: this.stores,
      collisions: this.collisions, tornSuspect: this.tornSuspect,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + '%' : 'n/a',
      hitAgeAvg:   this.hits > 0 ? +(this.hitAgeSum / this.hits).toFixed(2) : null,
      hitDepthAvg: this.hits > 0 ? +(this.hitDepthSum / this.hits).toFixed(2) : null,
      fillPermille: fill, usage: (fill / 10).toFixed(1) + '%',
    };
  }
}
// ═══════════════════════════════════════════════════════════════════════════
// Helper thread handle (main thread only)
//
// Every failure path ends in `dead = true` with `lastError` set, and rejects
// any promise a caller is waiting on. No rejection is ever left unobserved —
// the server treats an unhandled rejection as fatal.
// ═══════════════════════════════════════════════════════════════════════════
export class HelperThread {
  constructor(index, hooks) {
    this.index = index;
    this.hooks = hooks;
    this.worker = null;
    this.dead = false;
    this.spawnAt = 0;
    this.readyAt = 0;
    this.exitCode = null;
    this.lastError = null;
    this.pending = null;
    this.ready = null;
    this._readyRes = null;
    this._readyRej = null;
    /** Key of the config this worker last received; null forces a resend. */
    this.configKey = null;
  }
  spawn(initMsg) {
    this.spawnAt = Date.now();
    this.ready = new Promise((res, rej) => { this._readyRes = res; this._readyRej = rej; });
    this.ready.catch(() => {});
    try {
      this.worker = new Worker(WORKER_PATH, { workerData: { threadIndex: this.index } });
    } catch (err) {
      this._fail('spawn', err);
      return this;
    }
    this.worker.on('message', (m) => this._onMessage(m));
    this.worker.on('error', (err) => this._fail('worker-error', err));
    this.worker.on('exit', (code) => {
      this.exitCode = code;
      if (!this.dead) this._fail('exit', new Error(`worker exited with code ${code}`));
      this.hooks.onExit(this, code);
    });
    this.worker.postMessage(initMsg);
    return this;
  }
  post(msg) {
    if (this.dead || this.worker === null) return false;
    try { this.worker.postMessage(msg); return true; }
    catch (err) { this._fail('post', err); return false; }
  }
  
  /**
   * One outstanding request per helper, strictly request/response. A reply
   * matches on searchId, on type (`expect`, or `error`), and on iteration for
   * pv-split `units`. A new request SUPERSEDES a leftover one (its promise is
   * rejected and already handled by the caller).
   */
  request(msg, expect = 'result') {
    if (this.dead) {
      return Promise.reject(new Error(`helper ${this.index} is dead (${this.lastError?.phase ?? 'unknown'})`));
    }
    if (this.pending !== null) {
      const old = this.pending;
      this.pending = null;
      old.reject(new Error(`superseded by ${msg.type}`));
    }
    return new Promise((resolve, reject) => {
      this.pending = { searchId: msg.searchId, iter: msg.iter ?? null, expect, resolve, reject };
      if (!this.post(msg)) {
        this.pending = null;
        reject(new Error(`helper ${this.index}: post failed`));
      }
    });
  }

  _onMessage(m) {
    switch (m.type) {
      case 'ready':
        this.readyAt = Date.now();
        this._readyRes(m);
        this.hooks.onReady(this, m);
        return;
      case 'result':
      case 'unit-ready':
      case 'units-done':
      case 'unit-ended':
      case 'error': {
        const p = this.pending;
        const matches = p !== null && m.searchId === p.searchId &&
          (m.type === p.expect || m.type === 'error') &&
          (p.iter === null || m.iter === undefined || m.iter === p.iter);
        if (matches) { this.pending = null; p.resolve(m); return; }
        if (m.type === 'error' && (m.searchId === null || m.searchId === undefined)) {
          if (m.phase === 'init') this._fail('init', new Error(m.message));
          this.hooks.onError(this, m);
          return;
        }
        this.hooks.onStale(this, m);
        return;
      }
      case 'attached': this.hooks.onAttached(this, m); return;
      case 'console':  this.hooks.onConsole(this, m); return;
      default:         this.hooks.onError(this, { phase: 'protocol', message: `unknown message ${m.type}` });
    }
  }

  _fail(phase,err) {
    if (this.dead) return;
    this.dead = true;
    this.lastError = { phase, message: err && err.message ? err.message : String(err) };
    if (this._readyRej) this._readyRej(err);
    if (this.pending !== null) { const p = this.pending; this.pending = null; p.reject(err); }
    this.hooks.onFatal(this, phase, err);
    if (this.worker !== null) this.worker.terminate().catch(() => {});
  }
  terminate(reason) {
    if (this.dead && this.worker === null) return;
    const wasDead = this.dead;
    this.dead = true;
    if (!wasDead) this.lastError = { phase: 'terminated', message: reason };
    if (this._readyRej) this._readyRej(new Error(`terminated: ${reason}`));
    if (this.pending !== null) {
      const p = this.pending; this.pending = null;
      p.reject(new Error(`helper ${this.index} terminated: ${reason}`));
    }
    if (this.worker !== null) { this.worker.terminate().catch(() => {}); this.worker = null; }
  }
}