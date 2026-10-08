/**
 * SMP coordinator — drives the helper threads of ONE engine instance under a
 * selectable rule set (`config.smpStrategy`). See docs/SMP_STRATEGIES.md.
 *
 *   single      Threads ignored (control arm)
 *   lazy        identical helpers, shared TT only
 *   lazy-skip   + depth skipping, aspiration perturbation, root bias
 *   root-split  static subtree per thread (root moves dealt round-robin)
 *   pv-split    YBW at the root: PV move first, remaining moves as work units
 *               claimed dynamically, shared alpha, per-iteration barrier
 *
 * Every wait is bounded. Every helper answer is validated (search id, root
 * key, legality) before it can influence a move. Only this thread logs.
 */
import logger, { LOG, CAT } from '../logging/logger.js';
import { SMP_STRATEGIES } from '../config/index.js';
import { SCORE, PIECE_CHARS } from '../core/constants.js';
import { claimTable, releaseTable } from '../tables/transposition.js';
import {
  SharedTranspositionTable, HelperThread, CTRL, SLOT, SLOT_STATE, UNIT, UNIT_STATE, UNIT_FLAG,
  MAX_UNITS, slotBase, unitBase, availableCpus, withTimeout, hrNow, runSplitUnit,
} from './lazySMP.js';
const __LOG__ = globalThis.__LOG__ ?? true;
export const SMP_STATE = {
  IDLE: 'idle', SPAWNING: 'spawning', SEARCHING: 'searching', STOPPING: 'stopping', FAILED: 'failed',
};
export const SMP_STRATEGY = Object.freeze({
  SINGLE: 'single', LAZY: 'lazy', LAZY_SKIP: 'lazy-skip', ROOT_SPLIT: 'root-split', PV_SPLIT: 'pv-split',
});
export const SMP_LOG_MODE = Object.freeze({
  WINNER: 'winner', SUMMARY: 'summary', TRIGGERED: 'triggered', FULL: 'full',
});
const LOG_MODES = new Set(Object.values(SMP_LOG_MODE));
const MIN_THREADS = 1;
const MAX_THREADS = 64;
const READY_TIMEOUT_MS = 10000;      // includes the JIT warm-up search
const STOP_GRACE_MS = 2000;
const MAX_CONSECUTIVE_SPAWN_FAILURES = 3;
const WARMUP_DEPTH = 4;
const BASE_ASPIRATION = 50;
const ASP_PERTURB = [0, 15, -15, 30, -25, 45];
const FALLBACK_BIAS = 3_000_000;
// ═══════════════════════════════════════════════════════════════════════════
// Pure helpers (exported for tests)
// ═══════════════════════════════════════════════════════════════════════════
export function assignRootBiases(rootMoves, threadCount) {
  const out = new Array(threadCount).fill(null);
  if (rootMoves.length === 0) return out;
  const top = rootMoves[0].orderScore;
  for (let k = 1; k < threadCount; k++) {
    const target = rootMoves[k % rootMoves.length];
    const bias = new Map();
    bias.set(target.algebraic, (typeof top === 'number' && typeof target.orderScore === 'number')
      ? top - target.orderScore + 1 : FALLBACK_BIAS);
    out[k] = bias;
  }
  return out;
}
export function selectResult(main, helpers) {
  let pick = { thread: 0, depth: main.move === null ? -1 : main.depth, score: main.score, reason: 'main' };
  for (const h of helpers) {
    if (h.move === null) continue;
    const hMate = h.score > SCORE.MATE_THRESHOLD;
    const pMate = pick.depth >= 0 && pick.score > SCORE.MATE_THRESHOLD;
    if (hMate && (!pMate || h.score > pick.score)) {
      pick = { thread: h.w, depth: h.depth, score: h.score, reason: 'mate' };
      continue;
    }
    if (pMate) continue;
    if (h.depth > pick.depth) {
      pick = { thread: h.w, depth: h.depth, score: h.score, reason: pick.depth < 0 ? 'main-empty' : 'deeper' };
    }
  }
  return pick;
}
/** Root moves dealt round-robin by ordering rank; part 0 (main) owns the PV move. */
export function partitionRoundRobin(order, parts) {
  const out = Array.from({ length: parts }, () => []);
  for (let i = 0; i < order.length; i++) out[i % parts].push(order[i]);
  return out;
}
function heaviest(hints) {
  if (!hints) return null;
  let best = null, bw = -1;
  for (const [m, w] of hints) if (w > bw) { bw = w; best = m; }
  return best;
}
function mateIn(score) {
  if (Math.abs(score) <= SCORE.MATE_THRESHOLD) return null;
  return score > 0 ? SCORE.MATE - score : -(SCORE.MATE + score);
}
function rankIn(list, alg) {
  if (!list) return -1;
  for (let i = 0; i < list.length; i++) if (list[i].alg === alg) return i;
  return -1;
}
function clampThreads(n) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v) || v < MIN_THREADS) return MIN_THREADS;
  return v > MAX_THREADS ? MAX_THREADS : v;
}
function configKeyOf(config) {
  const { maxSearchTime, ...rest } = config;
  return JSON.stringify(rest);
}
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
function mean(reports, f) {
  let s = 0, n = 0;
  for (const r of reports) { const v = f(r); if (v !== null && v !== undefined && Number.isFinite(v)) { s += v; n++; } }
  return n > 0 ? r2(s / n) : null;
}
// ═══════════════════════════════════════════════════════════════════════════
export class SmpCoordinator {
  constructor(config = {}, opts = {}) {
    this.threadCount = clampThreads(config.threads);
    this.owner = opts.owner ?? 'anon';
    this.logCtx = opts.logCtx ?? null;
    this.logMode = LOG_MODES.has(opts.logMode) ? opts.logMode : SMP_LOG_MODE.TRIGGERED;
    this.state = SMP_STATE.IDLE;
    this.table = null;
    this.helpers = [];
    this.searchId = 0;
    this.lastError = null;
    this.disabledReason = null;
    this.spawnFailures = 0;
    this.lastStrategy = null;
    this.counters = {
      searches: 0, helperPicks: 0, errors: 0, timeouts: 0, stale: 0,
      desyncs: 0, illegal: 0, spawns: 0, respawns: 0, earlyStops: 0, orphans: 0,
    };
  }
  // ───────── Configuration ─────────
  setThreadCount(n, engine = null) {
    this.threadCount = clampThreads(n);
    if (this.threadCount <= 1) this.release(engine, 'threads=1');
    this.disabledReason = null;
    this.spawnFailures = 0;
    return this.threadCount;
  }
  setLogMode(mode) {
    const m = String(mode).trim().toLowerCase();
    if (!LOG_MODES.has(m) || m === this.logMode) return false;
    this.logMode = m;
    return true;
  }
  isMultiThreaded() { return this.threadCount > 1; }
  helperBudget() { return Math.max(0, Math.min(this.threadCount - 1, availableCpus() - 1)); }
  holdsTable(engine) { return engine !== null && this.table !== null && engine.tt === this.table; }
  canRun(config) {
    const strategy = config.smpStrategy ?? SMP_STRATEGY.LAZY_SKIP;
    if (!SMP_STRATEGIES.includes(strategy)) return { ok: false, reason: `unknown strategy ${strategy}` };
    if (strategy === SMP_STRATEGY.SINGLE) return { ok: false, reason: 'strategy=single' };
    if (this.threadCount <= 1) return { ok: false, reason: 'threads=1' };
    if (!config.useTranspositionTable) return { ok: false, reason: 'tt-disabled' };
    if (this.helperBudget() === 0) return { ok: false, reason: `cpus=${availableCpus()}` };
    if (this.disabledReason !== null) return { ok: false, reason: this.disabledReason };
    return { ok: true, reason: null };
  }
  // ───────── Lifecycle ─────────
  _hooks() {
    return {
      onReady: (h, m) => this._event('smp-ready', {
        w: h.index, ms: h.readyAt - h.spawnAt, warmupMs: r2(m.warmupMs), pid: m.pid, ttSerial: m.serial,
      }),
      onAttached: (h, m) => this._event('smp-attached', { w: h.index, ttSerial: m.serial }),
      onExit: (h, code) => this._event('smp-exit', { w: h.index, code }),
      onFatal: (h, phase, err) => {
        this.counters.errors++;
        this._error('smp-fatal', { w: h.index, phase, error: err && err.message ? err.message : String(err) });
      },
      onError: (h, m) => {
        this.counters.errors++;
        this._error('smp-error', { w: h.index, phase: m.phase, error: m.message });
      },
      onStale: (h, m) => {
        this.counters.stale++;
        this._event('smp-stale', { w: h.index, got: m.searchId, type: m.type });
      },
      onConsole: (h, m) => { if (__LOG__) logger.write(`[smp ${this.owner} w${h.index} ${m.level}] ${m.text}`); },
    };
  }
  _attachMsg(type) {
    return { type, owner: this.owner, ttBuffer: this.table.buffer, ctrlBuffer: this.table.ctrlBuffer,
             serial: this.table.serial, sizeMB: this.table.sizeMB };
  }
  _allocTable(sizeMB) {
    if (this.table !== null) releaseTable(this.table.serial, this.owner);
    this.table = new SharedTranspositionTable({ sizeMB, role: 'owner' });
    this.table.owner = this.owner;
    claimTable(this.table.serial, this.owner);
    this._event('smp-table', { tt: this.table.id, mb: sizeMB });
    for (const h of this.helpers) {
      if (h !== undefined && !h.dead) { h.configKey = null; h.post(this._attachMsg('attach')); }
    }
  }
  _spawn(index) {
    this.counters.spawns++;
    this._event('smp-spawn', { w: index, tt: this.table.id });
    return new HelperThread(index, this._hooks())
      .spawn({ ...this._attachMsg('init'), threadIndex: index, warmupDepth: WARMUP_DEPTH });
  }
  async _ensureReady(engine, config) {
    this.state = SMP_STATE.SPAWNING;
    const want = this.helperBudget();
    if (this.table === null || this.table.sizeMB !== config.hashSizeMB) this._allocTable(config.hashSizeMB);
    if (engine.tt !== this.table) {
      engine.attachTable(this.table);
      this._event('smp-attach', { tt: this.table.id });
    }
    while (this.helpers.length > want) this.helpers.pop().terminate('resize');
    for (let i = 0; i < want; i++) {
      const h = this.helpers[i];
      if (h === undefined || h.dead) {
        if (h !== undefined) this.counters.respawns++;
        this.helpers[i] = this._spawn(i + 1);
      }
    }
    const settled = await Promise.allSettled(this.helpers.map(h =>
      withTimeout(h.ready, READY_TIMEOUT_MS, `helper ${h.index} ready`)));
    const healthy = [];
    settled.forEach((s, i) => {
      const h = this.helpers[i];
      if (s.status === 'fulfilled' && !h.dead) { healthy.push(h); return; }
      this._error('smp-ready-failed', { w: h.index, error: s.status === 'rejected' ? s.reason.message : 'dead' });
      h.terminate('ready-failed');
    });
    if (healthy.length === 0) {
      this.spawnFailures++;
      if (this.spawnFailures >= MAX_CONSECUTIVE_SPAWN_FAILURES) {
        this.disabledReason = `disabled after ${this.spawnFailures} failed spawns`;
        this._error('smp-disabled', { reason: this.disabledReason });
      }
      this.state = SMP_STATE.FAILED;
      throw new Error(`no helper became ready (${want} requested)`);
    }
    this.spawnFailures = 0;
    this.state = SMP_STATE.IDLE;
    return healthy;
  }
  /** Spawn + attach without searching (smpbench uses it to keep spawn cost out of timings). */
  async prepare(engine, config) { return this._ensureReady(engine, config); }
  clearTable() { if (this.table !== null) this.table.clear(); }
  release(engine = null, reason = 'release') {
    for (const h of this.helpers) if (h !== undefined) h.terminate(reason);
    this.helpers = [];
    if (this.table !== null) {
      if (engine !== null && engine.tt === this.table) engine.useLocalTable();
      releaseTable(this.table.serial, this.owner);
      this._event('smp-release', { tt: this.table.id, reason });
      this.table = null;
    }
    this.state = SMP_STATE.IDLE;
  }
  terminate(engine = null) { this.release(engine, 'terminate'); }
  stop() {
    if (this.state !== SMP_STATE.SEARCHING || this.table === null) return;
    this.state = SMP_STATE.STOPPING;
    Atomics.store(this.table.ctrl, CTRL.STOP_ID, this.searchId);
  }
  newGame() {
    if (this.state === SMP_STATE.SEARCHING) {
      this._error('smp-invariant', { error: 'ucinewgame while helpers are searching' });
    }
    for (const h of this.helpers) if (h !== undefined && !h.dead) h.post({ type: 'newgame' });
  }
  // ───────── Shared plumbing ─────────
  _monitor(searchId, helpers) {
    const ctrl = this.table.ctrl;
    return {
      helperCompleted(target) {
        for (const h of helpers) {
          const b = slotBase(h.index);
          if (Atomics.load(ctrl, b + SLOT.SEARCH_ID) === searchId &&
              Atomics.load(ctrl, b + SLOT.COMPLETED) >= target) return true;
        }
        return false;
      },
      snapshot() {
        return helpers.map(h => {
          const b = slotBase(h.index);
          if (Atomics.load(ctrl, b + SLOT.SEARCH_ID) !== searchId) return `w${h.index}:-`;
          return `w${h.index}:s${Atomics.load(ctrl, b + SLOT.STATE)} d${Atomics.load(ctrl, b + SLOT.DEPTH)}` +
                 `/${Atomics.load(ctrl, b + SLOT.COMPLETED)} n${Atomics.load(ctrl, b + SLOT.NODES)}` +
                 ` t${Atomics.load(ctrl, b + SLOT.POLL_MS)}`;
        }).join(' ');
      },
    };
  }
  _plan(engine, board, legalMoves, bookHints, n) {
    const biases = new Array(n).fill(null);
    const asp = new Array(n).fill(BASE_ASPIRATION);
    let ordered = null;
    try {
      ordered = legalMoves.slice();
      const ttMove = engine.tt !== null ? engine.tt.getBestMove(board.gameState.zobristKey) : 0;
      engine.moveOrderer.orderMoves(ordered, 0, board, board.gameState.activeColor,
                                    ttMove, null, bookHints, heaviest(bookHints));
    } catch (err) {
      ordered = null;
      this._error('smp-plan', { error: err.message });
    }
    for (let k = 0; k < n; k++) {
      const w = k + 1;
      asp[k] = BASE_ASPIRATION + ASP_PERTURB[w % ASP_PERTURB.length];
      if (ordered !== null && ordered.length > 1 && (w & 1) === 0) {
        const target = ordered[(w >> 1) % ordered.length];
        if (target !== ordered[0]) biases[k] = [[target.algebraic, ordered[0].orderScore - target.orderScore + 1]];
      }
    }
    return { biases, asp, ordered: ordered !== null ? ordered.map(m => m.algebraic) : null };
  }
  /** Root-bearing request (search / unit-begin). The config is sent only when it changed. */
  _dispatch(c, h, extra, expect) {
    const b = slotBase(h.index);
    Atomics.store(c.ctrl, b + SLOT.SEARCH_ID, 0);
    Atomics.store(c.ctrl, b + SLOT.STATE, SLOT_STATE.IDLE);
    const sendConfig = h.configKey !== c.configKey;
    const msg = {
      searchId: c.searchId, rootFen: c.req.rootFen, moves: c.req.moves, rootKey: c.rootKey,
      depth: c.req.depth, maxSearchTime: c.req.config.maxSearchTime,
      config: sendConfig ? c.req.config : null,
      bookHints: c.req.bookHints ? [...c.req.bookHints] : null, collect: true,
      ...extra, sentAt: hrNow(),
    };
    if (sendConfig) c.T.configSends++;
    h.configKey = c.configKey;
    return h.request(msg, expect).then(
      m => { if (m.type === 'error') h.configKey = null; return m; },
      err => { h.configKey = null; return { type: 'error', threadIndex: h.index, searchId: c.searchId, phase: 'transport', message: err.message }; });
  }
  _request(c, h, msg, expect) {
    return h.request(msg, expect).catch(err =>
      ({ type: 'error', threadIndex: h.index, searchId: c.searchId, phase: 'transport', message: err.message }));
  }
  /** Every item raced against its own timeout; timeouts mark the helper wedged. */
  _awaitEach(c, pending, helpers, timeoutMs) {
    return Promise.all(pending.map((p, k) => {
      const h = helpers[k];
      let timer;
      const late = new Promise(res => {
        timer = setTimeout(() => res({ type: 'timeout', threadIndex: h.index, searchId: c.searchId }), timeoutMs);
      });
      return Promise.race([p, late]).then(m => {
        clearTimeout(timer);
        m.receivedAt = hrNow();
        if (m.type === 'timeout') this._wedged(c, h);
        return m;
      });
    }));
  }
  /** Wait up to `budgetMs`, then raise STOP and allow STOP_GRACE_MS more. */
  _gather(c, pending, helpers, budgetMs, finalStop) {
    const ctrl = c.ctrl, id = c.searchId;
    let stopTimer = null;
    if (budgetMs <= 0) Atomics.store(ctrl, CTRL.STOP_ID, id);
    else stopTimer = setTimeout(() => { c.deadlineHit = true; Atomics.store(ctrl, CTRL.STOP_ID, id); }, budgetMs);
    return this._awaitEach(c, pending, helpers, Math.max(0, budgetMs) + STOP_GRACE_MS).finally(() => {
      if (stopTimer !== null) clearTimeout(stopTimer);
      if (finalStop) Atomics.store(ctrl, CTRL.STOP_ID, id);
    });
  }
  _wedged(c, h) {
    this.counters.timeouts++;
    const ctrl = c.ctrl, b = slotBase(h.index);
    this._error('smp-timeout', {
      w: h.index, searchId: c.searchId,
      slot: `s${Atomics.load(ctrl, b + SLOT.STATE)} id${Atomics.load(ctrl, b + SLOT.SEARCH_ID)} ` +
            `d${Atomics.load(ctrl, b + SLOT.DEPTH)}/${Atomics.load(ctrl, b + SLOT.COMPLETED)} ` +
            `n${Atomics.load(ctrl, b + SLOT.NODES)} polls${Atomics.load(ctrl, b + SLOT.POLLS)}`,
    });
    h.terminate('wedged');
  }
  // ───────── Entry point ─────────
  /** @param {object} req { engine, board, depth, bookHints, legalMoves, rootFen, moves, config, logCtx } */
  async search(req) {
    const T = {
      start: hrNow(), prepareMs: 0, planMs: 0, dispatchMs: 0, mainMs: 0, collectMs: 0,
      barrierMs: 0, assembleMs: 0, logMs: 0, syncPoints: 0, configSends: 0, stopAt: null,
    };
    const strategy = req.config.smpStrategy ?? SMP_STRATEGY.LAZY_SKIP;
    let helpers;
    const tPrep = hrNow();
    try {
      helpers = await this._ensureReady(req.engine, req.config);
    } catch (err) {
      err.smpPhase = 'prepare';
      this.lastError = err;
      throw err;
    }
    T.prepareMs = hrNow() - tPrep;
    if (req.logCtx) logger.bind(req.logCtx);
    const searchId = ++this.searchId;
    this.counters.searches++;
    this.lastStrategy = strategy;
    const ctrl = this.table.ctrl;
    Atomics.store(ctrl, CTRL.SEARCH_ID, searchId);
    Atomics.store(ctrl, CTRL.TARGET_DEPTH, req.depth);
    this.table.advanceAge();
    const tPlan = hrNow();
    const plan = this._plan(req.engine, req.board, req.legalMoves, req.bookHints, helpers.length);
    T.planMs = hrNow() - tPlan;
    const c = {
      req, strategy, searchId, helpers, ctrl, plan, T,
      rootKey: req.board.gameState.zobristKey.toString(16),
      legalByAlg: new Map(req.legalMoves.map(m => [m.algebraic, m])),
      configKey: configKeyOf(req.config),
      wallStart: Date.now(), deadlineHit: false, failures: [], unitStats: {}, orphans: 0,
    };
    this.state = SMP_STATE.SEARCHING;
    let out;
    try {
      if (strategy === SMP_STRATEGY.PV_SPLIT) out = await this._runPvSplit(c);
      else if (strategy === SMP_STRATEGY.ROOT_SPLIT) out = await this._runRootSplit(c);
      else out = await this._runLazy(c, strategy === SMP_STRATEGY.LAZY_SKIP);
    } finally {
      Atomics.store(ctrl, CTRL.STOP_ID, searchId);
      this.state = SMP_STATE.IDLE;
      if (req.logCtx) logger.bind(req.logCtx);
    }
    const tAsm = hrNow();
    const outcome = out.kind === 'root-split' ? this._assembleRootSplit(c, out)
                  : out.kind === 'pv-split'   ? this._assemblePvSplit(c, out)
                  : this._assembleLazy(c, out);
    T.assembleMs = hrNow() - tAsm;
    outcome.result.smp.timing = this._timing(c, outcome.reports);
    const tLog = hrNow();
    try { this._log(c, out.main, outcome); }
    catch (err) { if (__LOG__) logger.write(`[smp] logging failed: ${err.message}`); }
    T.logMs = hrNow() - tLog;
    return outcome.result;
  }
  // ───────── lazy / lazy-skip ─────────
  async _runLazy(c, skipMode) {
    const { req, helpers, plan, T } = c;
    const t0 = hrNow();
    const pending = helpers.map((h, k) => this._dispatch(c, h, {
      type: 'search', rootMoves: null, skip: skipMode,
      rootBias: skipMode ? plan.biases[k] : null,
      aspDelta: skipMode ? plan.asp[k] : BASE_ASPIRATION,
    }, 'result'));
    T.dispatchMs = hrNow() - t0;
    const tm = hrNow();
    const main = req.engine.search(req.board, req.depth, {
      bookHints: req.bookHints, deferTurnLog: true,
      smp: { role: 'main', monitor: this._monitor(c.searchId, helpers), earlyStop: true,
             collect: false, iterations: null },
    });
    T.mainMs = hrNow() - tm;
    T.stopAt = hrNow();
    const settled = await this._gather(c, pending, helpers, 0, true);
    T.collectMs = hrNow() - T.stopAt;
    return { kind: 'results', main, settled };
  }
  // ───────── root-split ─────────
  async _runRootSplit(c) {
    const { req, helpers, plan, T } = c;
    const order = plan.ordered ?? req.legalMoves.map(m => m.algebraic);
    const parts = partitionRoundRobin(order, helpers.length + 1);
    const active = [], pending = [], assigned = new Map();
    const t0 = hrNow();
    helpers.forEach((h, k) => {
      if (parts[k + 1].length === 0) return;
      active.push(h);
      assigned.set(h.index, parts[k + 1]);
      pending.push(this._dispatch(c, h, {
        type: 'search', rootMoves: parts[k + 1], skip: false, rootBias: null, aspDelta: BASE_ASPIRATION,
      }, 'result'));
    });
    T.dispatchMs = hrNow() - t0;
    const tm = hrNow();
    const main = req.engine.search(req.board, req.depth, {
      bookHints: req.bookHints, deferTurnLog: true, rootMoves: new Set(parts[0]),
      smp: { role: 'main', monitor: this._monitor(c.searchId, active), earlyStop: false,
             collect: false, iterations: null },
    });
    T.mainMs = hrNow() - tm;
    // Subsets are NOT redundant: wait for all of them (the wait is load
    // imbalance, reported as barrierMs), stopping only at the deadline.
    const tb = hrNow();
    const budget = Math.max(0, req.config.maxSearchTime - (Date.now() - c.wallStart));
    const settled = await this._gather(c, pending, active, budget, true);
    T.barrierMs = hrNow() - tb;
    T.syncPoints = 1;
    return { kind: 'root-split', main, settled, active, assigned };
  }
  // ───────── pv-split ─────────
  async _runPvSplit(c) {
    const { req, helpers, plan, T, ctrl } = c;
    const engine = req.engine, board = req.board;
    const splitDepth = Math.max(1, (req.config.smpSplitDepth | 0) || 4);
    const byAlg = c.legalByAlg;
    let order = (plan.ordered ?? req.legalMoves.map(m => m.algebraic)).slice();
    if (order.length > MAX_UNITS) throw new Error(`pv-split: ${order.length} root moves exceed MAX_UNITS`);
    // 1. every helper replays the root ONCE per search
    const t0 = hrNow();
    const readyP = helpers.map(h => this._dispatch(c, h, { type: 'unit-begin' }, 'unit-ready'));
    T.dispatchMs += hrNow() - t0;
    engine.beginUnitSearch(board, req.depth, {
      bookHints: req.bookHints, deferTurnLog: true,
      smp: { role: 'main', monitor: this._monitor(c.searchId, helpers), earlyStop: false,
             collect: false, iterations: null },
    });
    const tr = hrNow();
    const readyMsgs = await this._awaitEach(c, readyP, helpers, READY_TIMEOUT_MS);
    T.barrierMs += hrNow() - tr;
    T.syncPoints++;
    if (req.logCtx) logger.bind(req.logCtx);
    let live = [];
    readyMsgs.forEach((m, k) => {
      const h = helpers[k];
      if (m.type === 'unit-ready') {
        live.push(h);
        c.unitStats[h.index] = { sentAt: m.timing.sentAt, recvAt: m.timing.recvAt, setupMs: m.timing.setupMs,
                                 rebuilt: m.timing.rebuilt, units: 0, workMs: 0, lagSum: 0, lagN: 0 };
      } else {
        c.failures.push({ w: h.index, status: m.type, phase: m.phase ?? 'unit-begin', error: m.message ?? null });
      }
    });
    const iters = [];
    let lastScore = 0, lastIterMs = 0;
    const tMain = hrNow();
    for (let d = 1; d <= req.depth; d++) {
      if (engine.stopSearch) break;
      if (c.deadlineHit) { engine.abortExternal('deadline'); break; }
      if (d > 1 && engine.predictsOverrun(lastIterMs)) break;
      const iterStart = hrNow();
      const n = order.length;
      // YBW: the PV move alone, full window, establishes alpha.
      const first = byAlg.get(order[0]);
      const s0 = engine.searchRootUnit(board, first, d, -SCORE.INFINITY, SCORE.INFINITY);
      const firstMs = hrNow() - iterStart;
      const entry0 = { move: first, score: s0, exact: true, nodes: 0, thread: 0 };
      if (engine.stopSearch) {
        if (d === 1) engine.recordUnitIteration(board, 1, [entry0], s0, Math.round(firstMs));
        break;
      }
      Atomics.store(ctrl, CTRL.ALPHA, s0);
      Atomics.store(ctrl, CTRL.UNIT_COUNT, n);
      Atomics.store(ctrl, CTRL.ITER, d);
      for (let i = 1; i < n; i++) Atomics.store(ctrl, unitBase(i) + UNIT.STATE, UNIT_STATE.PENDING);
      Atomics.store(ctrl, CTRL.NEXT_UNIT, 1);
      const split = d >= splitDepth && live.length > 0 && n > 2;
      let pendingU = [];
      if (split) {
        const td = hrNow();
        pendingU = live.map(h => this._request(c, h, {
          type: 'units', searchId: c.searchId, iter: d, depth: d, count: n, moves: order, sentAt: hrNow(),
        }, 'units-done'));
        T.dispatchMs += hrNow() - td;
      }
      // The main thread claims units too.
      const tWork = hrNow();
      let mainUnits = 0;
      while (!engine.stopSearch) {
        const i = Atomics.add(ctrl, CTRL.NEXT_UNIT, 1);
        if (i >= n) break;
        if (runSplitUnit(engine, board, byAlg.get(order[i]), d, ctrl, i, 0)) mainUnits++;
      }
      const mainWorkMs = hrNow() - tWork;
      let barrierMs = 0;
      if (split) {
        if (engine.stopSearch) Atomics.store(ctrl, CTRL.STOP_ID, c.searchId);
        const tb = hrNow();
        const budget = engine.stopSearch ? 0
          : Math.max(0, req.config.maxSearchTime - (Date.now() - engine.searchStartTime));
        const msgs = await this._gather(c, pendingU, live, budget, false);
        barrierMs = hrNow() - tb;
        T.barrierMs += barrierMs;
        T.syncPoints++;
        if (req.logCtx) logger.bind(req.logCtx);
        if (c.deadlineHit) engine.abortExternal('deadline');
        const keep = [];
        msgs.forEach((m, k) => {
          const h = live[k];
          if (m.type === 'units-done') {
            keep.push(h);
            const st = c.unitStats[h.index];
            if (st) {
              st.units += m.done; st.workMs += m.timing.workMs;
              st.lagSum += m.timing.recvAt - m.timing.sentAt; st.lagN++;
            }
          } else {
            c.failures.push({ w: h.index, status: m.type, phase: m.phase ?? 'units', error: m.message ?? null, iter: d });
          }
        });
        live = keep;
      }
      // Orphans: units a failed helper claimed (or never reached). The main thread finishes them.
      let orphans = 0;
      if (!engine.stopSearch) {
        for (let i = 1; i < n && !engine.stopSearch; i++) {
          if (Atomics.load(ctrl, unitBase(i) + UNIT.STATE) === UNIT_STATE.DONE) continue;
          orphans++;
          runSplitUnit(engine, board, byAlg.get(order[i]), d, ctrl, i, 0);
        }
        c.orphans += orphans;
        this.counters.orphans += orphans;
      }
      if (engine.stopSearch) break;        // partial iteration: discarded
      const entries = [entry0];
      for (let i = 1; i < n; i++) {
        const ub = unitBase(i);
        entries.push({
          move: byAlg.get(order[i]), score: Atomics.load(ctrl, ub + UNIT.SCORE),
          exact: Atomics.load(ctrl, ub + UNIT.FLAG) === UNIT_FLAG.EXACT,
          nodes: Atomics.load(ctrl, ub + UNIT.NODES), thread: Atomics.load(ctrl, ub + UNIT.THREAD),
        });
      }
      // Bounds are ≤ the final alpha, which is the max EXACT score; exact wins ties.
      entries.sort((a, b) => (b.score - a.score) || ((b.exact ? 1 : 0) - (a.exact ? 1 : 0)));
      const iterMs = hrNow() - iterStart;
      engine.recordUnitIteration(board, d, entries, entries[0].score, Math.round(iterMs));
      lastScore = entries[0].score;
      lastIterMs = iterMs;
      order = entries.map(e => e.move.algebraic);
      let helperUnits = 0;
      for (const e of entries) if (e.thread !== 0) helperUnits++;
      iters.push({
        d, n, split: split ? 1 : 0, helpers: live.length, mainUnits, helperUnits, orphans,
        firstMs: r2(firstMs), mainWorkMs: r2(mainWorkMs), barrierMs: r2(barrierMs), iterMs: r2(iterMs),
        best: order[0], cp: lastScore,
      });
      if (Math.abs(lastScore) > SCORE.MATE_THRESHOLD) break;
    }
    T.mainMs = hrNow() - tMain;
    // 2. release the helpers
    Atomics.store(ctrl, CTRL.STOP_ID, c.searchId);
    T.stopAt = hrNow();
    const alive = helpers.filter(h => !h.dead);
    const endP = alive.map(h => this._request(c, h, { type: 'unit-end', searchId: c.searchId }, 'unit-ended'));
    const ended = await this._awaitEach(c, endP, alive, STOP_GRACE_MS);
    T.collectMs += hrNow() - T.stopAt;
    if (req.logCtx) logger.bind(req.logCtx);
    const main = engine.finishUnitSearch(board, lastScore);
    return { kind: 'pv-split', main, ended, iters };
  }
  // ───────── Validation + assembly ─────────
  _validate(m, c) {
    const r = {
      w: m.threadIndex, ok: false, status: m.type, move: null, score: 0, depth: 0,
      seldepth: m.seldepth ?? 0, nodes: m.nodes ?? 0, ms: m.time ?? 0, msg: null,
      phase: m.phase ?? null, receivedAt: m.receivedAt, pv: [], iterations: m.iterations ?? null,
      aborted: m.aborted ?? null, tt: m.tt ?? null, bias: m.bias ?? null,
      timing: m.timing ?? null, rootScores: m.rootScores ?? null,
    };
    if (m.type === 'timeout') return r;
    if (m.type === 'error') {
      r.status = m.phase === 'desync' ? 'desync' : 'error';
      r.msg = m.message;
      if (r.status === 'desync') this.counters.desyncs++; else this.counters.errors++;
      return r;
    }
    if (m.searchId !== c.searchId) { r.status = 'stale'; this.counters.stale++; return r; }
    if (m.rootKey !== c.rootKey) { r.status = 'desync'; r.msg = `${m.rootKey} != ${c.rootKey}`; this.counters.desyncs++; return r; }
    r.score = m.score; r.depth = m.depth; r.pv = m.pv ?? [];
    if (m.move === null) { r.status = 'nomove'; return r; }
    if (!c.legalByAlg.has(m.move)) { r.status = 'illegal'; r.msg = m.move; this.counters.illegal++; return r; }
    r.move = m.move; r.ok = true; r.status = 'ok';
    return r;
  }
  _assembleLazy(c, out) {
    const { main, settled } = out;
    const reports = settled.map(m => this._validate(m, c));
    const valid = reports.filter(r => r.ok);
    const pick = selectResult({ depth: main.depth, score: main.score,
                                move: main.bestMove !== null ? main.bestMove.algebraic : null }, valid);
    let result = main;
    if (pick.thread !== 0) {
      const h = valid.find(r => r.w === pick.thread);
      result = {
        ...main, bestMove: c.legalByAlg.get(h.move), score: h.score, depth: h.depth,
        seldepth: Math.max(main.seldepth, h.seldepth),
        pv: (h.pv.length > 0 ? h.pv : [h.move]).map(a => ({ algebraic: a })),
      };
    }
    return this._finalize(c, main, result, reports, pick, {});
  }
  _assembleRootSplit(c, out) {
    const { main, settled, assigned } = out;
    const reports = settled.map(m => this._validate(m, c));
    const pool = [];
    const add = (thread, list) => {
      for (const s of list || []) {
        const mv = c.legalByAlg.get(s.alg);
        if (mv !== undefined) pool.push({ move: mv, score: s.score, exact: s.exact, thread });
      }
    };
    add(0, main.rootScores);
    for (const r of reports) if (r.ok) add(r.w, r.rootScores);
    let unsearched = 0;
    for (const r of reports) if (!r.ok) unsearched += (assigned.get(r.w) || []).length;
    let result = main;
    let pick = { thread: 0, depth: main.depth, score: main.score, reason: 'merge' };
    if (pool.length > 0) {
      const chosen = c.req.engine.chooseRootMove(c.req.board, pool);
      const okDepths = [main.depth, ...reports.filter(r => r.ok).map(r => r.depth)];
      const depth = Math.min(...okDepths);
      const alg = chosen.move.algebraic;
      let pv = [alg];
      if (chosen.thread === 0 && main.bestMove !== null && main.bestMove.algebraic === alg) {
        pv = main.pv.map(p => p.algebraic);
      } else if (chosen.thread !== 0) {
        const from = reports.find(r => r.w === chosen.thread);
        if (from && from.move === alg && from.pv.length > 0) pv = from.pv;
      }
      result = {
        ...main, bestMove: chosen.move, score: chosen.score, depth,
        seldepth: Math.max(main.seldepth, ...reports.map(r => r.seldepth)),
        pv: pv.map(a => ({ algebraic: a })),
        mergedRoot: pool.map(p => ({ alg: p.move.algebraic, score: p.score, exact: p.exact })),
      };
      pick = { thread: chosen.thread, depth, score: chosen.score, reason: 'merge' };
    }
    return this._finalize(c, main, result, reports, pick, { unsearched });
  }
  _assemblePvSplit(c, out) {
    const { main, ended, iters } = out;
    const reports = ended.map(m => {
      const st = c.unitStats[m.threadIndex] ?? null;
      return {
        w: m.threadIndex, ok: m.type === 'unit-ended' && !m.stale,
        status: m.type === 'unit-ended' ? (m.stale ? 'stale' : 'ok') : m.type,
        move: null, score: 0, depth: main.depth, seldepth: m.seldepth ?? 0, nodes: m.nodes ?? 0,
        ms: st ? st.workMs : 0, msg: m.message ?? null, phase: m.phase ?? null,
        receivedAt: m.receivedAt, pv: [], iterations: null, aborted: null, tt: m.tt ?? null, bias: null,
        units: m.units ?? 0, rootScores: null,
        timing: st ? { sentAt: st.sentAt, recvAt: st.recvAt, setupMs: st.setupMs, rebuilt: st.rebuilt,
                       unitRecvLagMs: st.lagN > 0 ? st.lagSum / st.lagN : null } : null,
      };
    });
    const pick = { thread: 0, depth: main.depth, score: main.score, reason: 'pv-split' };
    return this._finalize(c, main, main, reports, pick, { iters });
  }
  _finalize(c, main, result, reports, pick, extra) {
    let helperNodes = 0;
    for (const r of reports) helperNodes += r.nodes;
    const valid = reports.filter(r => r.ok);
    const played = result.bestMove !== null ? result.bestMove.algebraic : null;
    const voters = valid.filter(r => r.move !== null);
    const agree = voters.filter(r => r.move === played).length;
    const lazy = c.strategy === SMP_STRATEGY.LAZY || c.strategy === SMP_STRATEGY.LAZY_SKIP;
    if (lazy && pick.thread !== 0) this.counters.helperPicks++;
    if (main.abortReason === 'helper-complete') this.counters.earlyStops++;
    const anomalous = (lazy && pick.thread !== 0) || reports.some(r => !r.ok) ||
                      (lazy && agree < voters.length) || c.failures.length > 0 ||
                      c.orphans > 0 || (extra.unsearched ?? 0) > 0;
    const out = result === main ? { ...main } : result;
    out.mainNodes = main.nodes;
    out.nodes = main.nodes + helperNodes;
    out.smp = {
      strategy: c.strategy, threads: 1 + c.helpers.length, pick: pick.thread, reason: pick.reason,
      agree, considered: voters.length, errors: reports.length - valid.length + c.failures.length,
      totalNodes: out.nodes, mainNodes: main.nodes, earlyStop: main.abortReason === 'helper-complete',
      anomalous, unsearched: extra.unsearched ?? 0, orphans: c.orphans,
      iterations: extra.iters ? extra.iters.length : 0, timing: null,
    };
    return { result: out, reports, pick, played, anomalous, iters: extra.iters ?? null };
  }
  _timing(c, reports) {
    const T = c.T;
    const overheadMs = T.prepareMs + T.planMs + T.dispatchMs + T.collectMs + T.assembleMs;
    return {
      totalMs: r2(hrNow() - T.start), prepareMs: r2(T.prepareMs), planMs: r2(T.planMs),
      dispatchMs: r2(T.dispatchMs), mainMs: r2(T.mainMs), collectMs: r2(T.collectMs),
      barrierMs: r2(T.barrierMs), assembleMs: r2(T.assembleMs), overheadMs: r2(overheadMs),
      syncPoints: T.syncPoints, configSends: T.configSends,
      recvLagMs: mean(reports, r => r.timing && r.timing.sentAt ? r.timing.recvAt - r.timing.sentAt : null),
      setupMs: mean(reports, r => r.timing ? r.timing.setupMs : null),
      stopLagMs: mean(reports, r => r.timing && r.timing.stopSeenAt && T.stopAt ? r.timing.stopSeenAt - T.stopAt : null),
      postLagMs: mean(reports, r => r.timing && r.timing.postAt && r.receivedAt ? r.receivedAt - r.timing.postAt : null),
      unitRecvLagMs: mean(reports, r => r.timing ? r.timing.unitRecvLagMs ?? null : null),
      rebuilds: reports.filter(r => r.timing && r.timing.rebuilt).length,
    };
  }
  // ───────── Logging (main thread only) ─────────
  _log(c, main, outcome) {
    if (!(__LOG__ && (LOG.search || LOG.smp))) return;
    logger.lockTurn(c.req.board);
    try {
      const { result, reports, pick, played, anomalous, iters } = outcome;
      const s = result.smp, t = s.timing;
      if (LOG.search && main.turnRecord) {
        logger.event(CAT.SEARCH, 'turn', this._augmentTurn(main.turnRecord, main, result));
      }
      for (const f of c.failures) this._error('smp-worker-failed', f);
      for (const r of reports) {
        if (!r.ok) this._error('smp-worker-failed', { w: r.w, status: r.status, phase: r.phase, error: r.msg });
      }
      if (!LOG.smp) return;
      let torn = 0;
      for (const r of reports) torn += r.tt ? r.tt.torn : 0;
      logger.event(CAT.SMP, 'smp-turn', {
        strategy: s.strategy, threads: s.threads, pick: s.pick, reason: s.reason, played,
        mainBest: main.bestMove !== null ? main.bestMove.algebraic : null,
        mainDepth: main.depth, pickDepth: result.depth,
        agree: s.agree, considered: s.considered, errors: s.errors,
        earlyStop: s.earlyStop ? 1 : 0, anomalous: anomalous ? 1 : 0,
        unsearched: s.unsearched, orphans: s.orphans,
        mainNodes: s.mainNodes, totalNodes: s.totalNodes,
        nps: t.totalMs > 0 ? Math.round(s.totalNodes * 1000 / t.totalMs) : null,
        torn, tt: this.table !== null ? this.table.id : null, mode: this.logMode,
        ...t,
      });
      const mode = this.logMode;
      const trails = mode === SMP_LOG_MODE.FULL || (mode === SMP_LOG_MODE.TRIGGERED && anomalous);
      for (const r of reports) {
        const isWinner = r.w === pick.thread;
        if (mode === SMP_LOG_MODE.WINNER && !isWinner) continue;
        logger.event(CAT.SMP, 'smp-worker', {
          w: r.w, status: r.status, move: r.move, cp: r.score, depth: r.depth, seldepth: r.seldepth,
          nodes: r.nodes, ms: r2(r.ms), nps: r.ms > 0 ? Math.round(r.nodes * 1000 / r.ms) : null,
          units: r.units ?? null,
          recvLagMs: r.timing && r.timing.sentAt ? r2(r.timing.recvAt - r.timing.sentAt) : null,
          setupMs: r.timing ? r2(r.timing.setupMs) : null, rebuilt: r.timing && r.timing.rebuilt ? 1 : 0,
          stopLagMs: r.timing && r.timing.stopSeenAt && c.T.stopAt ? r2(r.timing.stopSeenAt - c.T.stopAt) : null,
          agree: r.move !== null && r.move === played ? 1 : 0, winner: isWinner ? 1 : 0,
          aborted: r.aborted, bias: r.bias,
          ttHits: r.tt ? r.tt.hits : null, ttTorn: r.tt ? r.tt.torn : null, error: r.msg,
        });
        if ((trails || (mode === SMP_LOG_MODE.WINNER && isWinner)) && r.iterations) {
          for (const it of r.iterations) logger.event(CAT.SMP, 'smp-iter', { w: r.w, ...it });
        }
      }
      if (iters && mode !== SMP_LOG_MODE.WINNER) {
        for (const it of iters) logger.event(CAT.SMP, 'smp-split-iter', it);
      }
    } finally {
      logger.unlockTurn();
    }
  }
  _augmentTurn(rec, main, result) {
    const s = result.smp, t = s.timing || {};
    const out = {
      ...rec, threads: s.threads, smpStrategy: s.strategy, smpPick: s.pick, smpReason: s.reason,
      smpAgree: s.agree, smpConsidered: s.considered, smpErrors: s.errors,
      smpNodes: s.totalNodes, smpEarlyStop: s.earlyStop ? 1 : 0,
      smpOverheadMs: t.overheadMs ?? null, smpBarrierMs: t.barrierMs ?? null,
    };
    const m = result.bestMove;
    if (m !== null && m.algebraic !== rec.best) {
      out.mainBest = rec.best; out.mainCp = rec.cp; out.mainDepth = rec.depth;
      out.best = m.algebraic; out.cp = result.score; out.mate = mateIn(result.score);
      out.depth = result.depth; out.seldepth = result.seldepth;
      out.pv = result.pv.map(p => p.algebraic).join(' '); out.pvLen = result.pv.length;
      out.bestRank = rankIn(result.mergedRoot ?? main.rootScores, m.algebraic);
      out.qual = null;
      out.cap = m.capturedPiece !== null ? PIECE_CHARS[m.capturedPiece] : null;
      out.capSee = m.seeScore; out.promo = m.isPromotion ? 1 : 0;
    } else if (result.depth !== rec.depth) {
      out.depth = result.depth;
    }
    return out;
  }
  _event(label, fields) {
    if (!(__LOG__ && LOG.smp)) return;
    if (this.logCtx !== null) logger.bind(this.logCtx);
    logger.event(CAT.SMP, label, { owner: this.owner, ...fields });
  }
  _error(label, fields) {
    this.lastError = new Error(`${label}: ${fields.error ?? fields.status ?? ''}`);
    if (!__LOG__) return;
    if (this.logCtx !== null) logger.bind(this.logCtx);
    logger.write(`[SMP ${this.owner}] ${label} ${JSON.stringify(fields)}`);
    if (LOG.smp) logger.event(CAT.SMP, label, { owner: this.owner, ...fields });
  }
  describe() {
    const live = this.helpers.filter(h => h !== undefined && !h.dead).length;
    return `threads=${this.threadCount} helpers=${live}/${this.helperBudget()} state=${this.state} ` +
           `strategy=${this.lastStrategy ?? '-'} tt=${this.table !== null ? this.table.id : 'none'} ` +
           `log=${this.logMode} picks=${this.counters.helperPicks}/${this.counters.searches} ` +
           `errors=${this.counters.errors} timeouts=${this.counters.timeouts} orphans=${this.counters.orphans}` +
           (this.disabledReason !== null ? ` disabled="${this.disabledReason}"` : '') +
           (this.lastError !== null ? ` lastError="${this.lastError.message}"` : '');
  }
}
export default SmpCoordinator;