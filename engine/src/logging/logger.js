/**
 * Zero-cost logging with bounded memory.
 *
 * Design contract:
 *   1. When a category is disabled, the ONLY cost is a boolean read.
 *      Callers MUST guard hot-path calls: `if (LOG.search) logger.searchNode(...)`
 *   2. Turn summaries stream to NDJSON — append-only, never re-serialize history.
 *   3. In-memory turn history is a ring buffer (default 8 turns).
 *   4. Per-node logging is SAMPLED, not exhaustive. Cross-referencing uses
 *      node counters, not per-node string IDs.
 *   5. The entire logger can be swapped for a no-op via `installNoopLogger()`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LOG_CATEGORY, CATEGORY_NAMES, GAME_STAGE } from './categories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '../../logs');
const TURN_LOG_DIR = path.join(LOG_DIR, 'turns');

// ─────────────────────────────────────────────────────────────────────────────
// Hot-path guard flags — read these BEFORE constructing log payloads.
// These are plain properties on a frozen-shape object so V8 inlines the read.
// ─────────────────────────────────────────────────────────────────────────────
export const LOG = {
  search: false,
  eval: false,
  moveOrder: false,
  tt: false,
  uci: false,
  book: false,
  heuristics: false,
  moves: false,
  pv: false,
  time: false,
  stage: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Ring buffer — fixed memory footprint regardless of game length
// ─────────────────────────────────────────────────────────────────────────────
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.size = 0;
  }
  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }
  toArray() {
    if (this.size < this.capacity) return this.buffer.slice(0, this.size);
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }
  clear() {
    this.buffer.fill(undefined);
    this.head = 0;
    this.size = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sampled trace writer — writes every Nth call, drops the rest.
// Prevents pino-style buffer blowup on per-node logging.
// ─────────────────────────────────────────────────────────────────────────────
class SampledWriter {
  constructor(stream, sampleRate = 1000) {
    this.stream = stream;
    this.sampleRate = sampleRate;   // write 1 in N
    this.counter = 0;
    this.dropped = 0;
  }
  write(obj) {
    this.counter++;
    if (this.counter % this.sampleRate !== 0) {
      this.dropped++;
      return;
    }
    // Single-line JSON, no pretty-print — minimal serialization cost
    this.stream.write(JSON.stringify(obj) + '\n');
  }
  writeAlways(obj) {
    this.stream.write(JSON.stringify(obj) + '\n');
  }
  stats() {
    return { written: this.counter - this.dropped, dropped: this.dropped };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main logger
// ─────────────────────────────────────────────────────────────────────────────
class EngineLogger {
  constructor(opts = {}) {
    this.enabledMask = LOG_CATEGORY.NONE;
    this.turnRingSize = opts.turnRingSize ?? 8;
    this.nodeSampleRate = opts.nodeSampleRate ?? 1000;
    this.maxCandidatesPerTurn = opts.maxCandidatesPerTurn ?? 10;

    this.sessionId = `s${Date.now().toString(36)}`;
    this.gameId = null;
    this.turnNumber = 0;
    this.turnData = null;

    // Bounded in-memory history
    this.recentTurns = new RingBuffer(this.turnRingSize);

    // Lazy-init streams — don't open file handles unless logging is on
    this._turnStream = null;
    this._traceWriters = new Map();
  }

  // ───────── Category control ─────────

  setEnabledCategories(mask) {
    this.enabledMask = mask;
    // Sync the hot-path guard flags — this is the critical bit.
    LOG.search     = (mask & LOG_CATEGORY.SEARCH) !== 0;
    LOG.eval       = (mask & LOG_CATEGORY.EVAL) !== 0;
    LOG.moveOrder  = (mask & LOG_CATEGORY.MOVE_ORDER) !== 0;
    LOG.tt         = (mask & LOG_CATEGORY.TT) !== 0;
    LOG.uci        = (mask & LOG_CATEGORY.UCI) !== 0;
    LOG.book       = (mask & LOG_CATEGORY.BOOK) !== 0;
    LOG.heuristics = (mask & LOG_CATEGORY.HEURISTICS) !== 0;
    LOG.moves      = (mask & LOG_CATEGORY.MOVES) !== 0;
    LOG.pv         = (mask & LOG_CATEGORY.PV) !== 0;
    LOG.time       = (mask & LOG_CATEGORY.TIME) !== 0;
    LOG.stage      = (mask & LOG_CATEGORY.STAGE) !== 0;
  }

  isEnabled(category) {
    return (this.enabledMask & category) !== 0;
  }

  // ───────── Lazy stream init ─────────

  _getTurnStream() {
    if (this._turnStream) return this._turnStream;
    fs.mkdirSync(TURN_LOG_DIR, { recursive: true });
    const file = path.join(TURN_LOG_DIR, `${this.gameId || this.sessionId}.ndjson`);
    // Append mode, 64KB OS buffer — bounded.
    this._turnStream = fs.createWriteStream(file, { flags: 'a', highWaterMark: 64 * 1024 });
    return this._turnStream;
  }

  _getTraceWriter(category) {
    let w = this._traceWriters.get(category);
    if (w) return w;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const name = CATEGORY_NAMES[category] || `cat${category}`;
    const stream = fs.createWriteStream(
      path.join(LOG_DIR, `${name}.ndjson`),
      { flags: 'a', highWaterMark: 64 * 1024 }
    );
    w = new SampledWriter(stream, this.nodeSampleRate);
    this._traceWriters.set(category, w);
    return w;
  }

  // ───────── Game / turn lifecycle ─────────

  startNewGame(gameId = null) {
    // Close previous game's stream so we don't leak FDs across games
    if (this._turnStream) {
      this._turnStream.end();
      this._turnStream = null;
    }
    this.gameId = gameId || `g${Date.now().toString(36)}`;
    this.turnNumber = 0;
    this.recentTurns.clear();
  }

  startTurn(fen, color, stageInfo) {
    this.turnNumber++;
    // Flat, pre-sized object — avoid dynamic shape changes that deopt V8
    this.turnData = {
      t: this.turnNumber,
      ts: Date.now(),
      fen,
      color,
      stage: stageInfo?.stage ?? null,
      phase: stageInfo?.phasePercent ?? null,
      // Bounded candidate list — we only keep top N
      candidates: [],
      best: null,
      score: 0,
      depth: 0,
      nodes: 0,
      qnodes: 0,
      time: 0,
      pv: null,
      // Counters instead of per-node ID arrays — O(1) memory
      nSearch: 0,
      nEval: 0,
      nOrder: 0,
      warnings: null,  // lazy-alloc
      errors: null,    // lazy-alloc
    };
    return this.turnNumber;
  }

  /**
   * Record a candidate — but only keep the top N by score.
   * Uses a simple insertion into a bounded sorted array.
   * O(k) per call where k = maxCandidatesPerTurn, not O(total candidates).
   */
  recordCandidateMove(move, score, orderScore, evalBreakdown) {
    const td = this.turnData;
    if (!td) return;

    const cands = td.candidates;
    const max = this.maxCandidatesPerTurn;

    // Fast reject: list full and this score is worse than the worst kept
    if (cands.length >= max && score <= cands[cands.length - 1].s) return;

    // Build record — keep it flat and small. Skip evalBreakdown for
    // non-top-3 to cap nested-object memory.
    const keepBreakdown = cands.length < 3;
    const rec = {
      m: move.algebraic,
      s: score,
      o: orderScore,
      cap: move.capturedPiece ?? null,
      tt: move.isTTMove || false,
      k: move.isKiller || false,
      eb: keepBreakdown ? evalBreakdown : null,
    };

    // Insert sorted, trim to max
    let i = cands.length;
    while (i > 0 && cands[i - 1].s < score) i--;
    cands.splice(i, 0, rec);
    if (cands.length > max) cands.length = max;
  }

  finalizeTurn(bestMove, searchResult) {
    const td = this.turnData;
    if (!td) return;

    td.best   = bestMove?.algebraic ?? null;
    td.score  = searchResult?.score ?? 0;
    td.depth  = searchResult?.depth ?? 0;
    td.nodes  = searchResult?.nodes ?? 0;
    td.qnodes = searchResult?.qNodes ?? 0;
    td.time   = searchResult?.time ?? 0;
    td.pv     = searchResult?.pv?.map(m => m.algebraic).join(' ') ?? null;

    // Stream one NDJSON line — O(1) per turn, never re-serialize history
    if (this.enabledMask !== LOG_CATEGORY.NONE) {
      this._getTurnStream().write(JSON.stringify(td) + '\n');
    }

    // Ring buffer handles eviction — old turn becomes GC-eligible
    this.recentTurns.push(td);
    this.turnData = null;
  }

  addTurnWarning(type, message) {
    const td = this.turnData;
    if (!td) return;
    if (!td.warnings) td.warnings = [];
    td.warnings.push({ type, message });
    console.warn(`[T${this.turnNumber}] ${type}: ${message}`);
  }

  addTurnError(type, message, details) {
    const td = this.turnData;
    if (td) {
      if (!td.errors) td.errors = [];
      td.errors.push({ type, message });
    }
    console.error(`[T${this.turnNumber}] ${type}: ${message}`);
    if (details?.stack) console.error(details.stack);
  }

  // ───────── Hot-path trace logging ─────────
  // Callers MUST guard these with `if (LOG.search)` etc.
  // These methods assume the guard already passed — no redundant check.

  searchNode(depth, ply, alpha, beta, moveCount) {
    const td = this.turnData;
    if (td) td.nSearch++;   // O(1) counter, no string allocation

    // Sampled write — 1 in N nodes actually hits disk
    this._getTraceWriter(LOG_CATEGORY.SEARCH).write({
      t: this.turnNumber, d: depth, p: ply, a: alpha, b: beta, mc: moveCount
    });
  }

  evalPoint(score, phase) {
    const td = this.turnData;
    if (td) td.nEval++;
    this._getTraceWriter(LOG_CATEGORY.EVAL).write({
      t: this.turnNumber, s: score, ph: phase
    });
  }

  moveOrderPoint(ply, topMove, topScore, count) {
    const td = this.turnData;
    if (td) td.nOrder++;
    this._getTraceWriter(LOG_CATEGORY.MOVE_ORDER).write({
      t: this.turnNumber, p: ply, m: topMove, s: topScore, c: count
    });
  }

  // ───────── Non-hot-path logging (UCI, book, etc.) ─────────
  // These fire per-command, not per-node, so no sampling needed.

  uci(level, data, message) {
    if (level === 'error') {
      console.error(`[UCI] ${message}`, data);
      this.addTurnError('uci', message, data);
      return;
    }
    if (level === 'warn') console.warn(`[UCI] ${message}`);
    if (!LOG.uci) return;
    this._getTraceWriter(LOG_CATEGORY.UCI).writeAlways({
      t: this.turnNumber, lvl: level, msg: message, ...data
    });
  }

  book(level, data, message) {
    if (!LOG.book) return;
    this._getTraceWriter(LOG_CATEGORY.BOOK).writeAlways({
      t: this.turnNumber, lvl: level, msg: message, ...data
    });
  }

  // ───────── Introspection ─────────

  getRecentTurns() { return this.recentTurns.toArray(); }
  getCurrentTurn() { return this.turnData; }

  getTraceStats() {
    const out = {};
    for (const [cat, w] of this._traceWriters) {
      out[CATEGORY_NAMES[cat]] = w.stats();
    }
    return out;
  }

  // ───────── Legacy category methods ─────────
  // Backward-compat shims for eval sub-modules that still use the old
  // (level, data, message) signature. The guard check is INSIDE the method,
  // so callers that don't guard still work — they just pay for argument
  // construction. That's bounded damage; file I/O and retention are avoided.
  //
  // Hot-path callers should migrate to `if (LOG.x)` guards + evalPoint/
  // searchNode/etc. These shims exist so un-migrated code doesn't crash.

  _legacyLog(enabled, category, level, data, message) {
    // Errors always surface regardless of category mask.
    if (level === 'error') {
      const name = CATEGORY_NAMES[category] || 'log';
      console.error(`[${name.toUpperCase()}] ${message}`);
      this.addTurnError(name, message, data);
      return;
    }
    // Guard. The caller already allocated `data`, but we stop here:
    // no spread, no stringify, no disk write.
    if (!enabled) return;
    if (level === 'warn') {
      console.warn(`[${(CATEGORY_NAMES[category] || 'log').toUpperCase()}] ${message}`);
    }
    // writeAlways because these are typically info/debug, not per-node trace.
    // If a sub-module IS calling this per-node, that module needs a guard.
    this._getTraceWriter(category).writeAlways({
      t: this.turnNumber, lvl: level, msg: message, ...data,
    });
  }

  search(l, d, m)     { this._legacyLog(LOG.search,     LOG_CATEGORY.SEARCH,     l, d, m); }
  eval(l, d, m)       { this._legacyLog(LOG.eval,       LOG_CATEGORY.EVAL,       l, d, m); }
  moveOrder(l, d, m)  { this._legacyLog(LOG.moveOrder,  LOG_CATEGORY.MOVE_ORDER, l, d, m); }
  tt(l, d, m)         { this._legacyLog(LOG.tt,         LOG_CATEGORY.TT,         l, d, m); }
  heuristics(l, d, m) { this._legacyLog(LOG.heuristics, LOG_CATEGORY.HEURISTICS, l, d, m); }
  moves(l, d, m)      { this._legacyLog(LOG.moves,      LOG_CATEGORY.MOVES,      l, d, m); }
  pv(l, d, m)         { this._legacyLog(LOG.pv,         LOG_CATEGORY.PV,         l, d, m); }
  time(l, d, m)       { this._legacyLog(LOG.time,       LOG_CATEGORY.TIME,       l, d, m); }
  stage(l, d, m)      { this._legacyLog(LOG.stage,      LOG_CATEGORY.STAGE,      l, d, m); }

  // ───────── Legacy specialized methods ─────────

  /** Per-eval breakdown. Routed through the sampled writer since this
   *  fires at every leaf when eval logging is on. */
  evalBreakdown(fen, breakdown, total) {
    if (!LOG.eval) return;
    this._getTraceWriter(LOG_CATEGORY.EVAL).write({
      t: this.turnNumber, fen, total, ...breakdown,
    });
  }

  /** Per-heuristic trace. Sub-evaluators call this ~5× per eval. Sampled. */
  heuristicCalc(name, color, score, details) {
    if (!LOG.heuristics) return;
    this._getTraceWriter(LOG_CATEGORY.HEURISTICS).write({
      t: this.turnNumber, h: name, c: color, s: score, ...details,
    });
  }

  /** Per-node move-ordering dump. Sampled; kept minimal. */
  moveOrderingDecision(moves, ply, context) {
    if (!LOG.moveOrder) return;
    this._getTraceWriter(LOG_CATEGORY.MOVE_ORDER).write({
      t: this.turnNumber, ply, n: moves.length,
      top: moves[0]?.algebraic, topScore: moves[0]?.orderScore,
    });
  }

  logStageTransition(prev, next, details) {
    console.log(`[STAGE] ${prev} → ${next}`);
    if (!LOG.stage) return;
    this._getTraceWriter(LOG_CATEGORY.STAGE).writeAlways({
      t: this.turnNumber, prev, next, ...details,
    });
  }

  logOpeningViolation(move, violations, bonuses) {
    // Console-only; no file write needed. The turn warning covers persistence.
    const net = (bonuses?.reduce((s, b) => s + b.bonus, 0) || 0) +
                (violations?.reduce((s, v) => s + v.penalty, 0) || 0);
    console.warn(`[OPENING] ${move.algebraic}: ${violations.length} violation(s), net ${net}`);
    this.addTurnWarning('opening_violation', `${move.algebraic}: ${violations.length} violation(s)`);
  }

  // ───────── Cleanup ─────────

  async flush() {
    const promises = [];
    if (this._turnStream) {
      promises.push(new Promise(r => this._turnStream.once('drain', r) || r()));
    }
    for (const w of this._traceWriters.values()) {
      promises.push(new Promise(r => w.stream.once('drain', r) || r()));
    }
    await Promise.race([Promise.all(promises), new Promise(r => setTimeout(r, 1000))]);
  }

  close() {
    if (this._turnStream) { this._turnStream.end(); this._turnStream = null; }
    for (const w of this._traceWriters.values()) w.stream.end();
    this._traceWriters.clear();
  }

  clearLogs() {
    this.close();
    for (const dir of [LOG_DIR, TURN_LOG_DIR]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isFile()) fs.unlinkSync(p);
      }
    }
    this.recentTurns.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// No-op logger — every method is an empty function.
// Swap this in for production builds or perf benchmarks.
// ─────────────────────────────────────────────────────────────────────────────
class NoopLogger {
  setEnabledCategories() {}
  isEnabled() { return false; }
  startNewGame() {}
  startTurn() { return 0; }
  recordCandidateMove() {}
  finalizeTurn() {}
  addTurnWarning() {}
  addTurnError(type, msg, d) { console.error(`[${type}] ${msg}`); if (d?.stack) console.error(d.stack); }
  searchNode() {}
  evalPoint() {}
  moveOrderPoint() {}
  uci(level, data, msg) { if (level === 'error') console.error(`[UCI] ${msg}`, data); }
  book() {}
  getRecentTurns() { return []; }
  getCurrentTurn() { return null; }
  getTraceStats() { return {}; }
  async flush() {}
  close() {}
  clearLogs() {}
  _errOnly(label, level, msg) { if (level === 'error') console.error(`[${label}] ${msg}`); }
  search(l, d, m)     { this._errOnly('SEARCH', l, m); }
  eval(l, d, m)       { this._errOnly('EVAL', l, m); }
  moveOrder(l, d, m)  { this._errOnly('MOVE_ORDER', l, m); }
  tt(l, d, m)         { this._errOnly('TT', l, m); }
  heuristics(l, d, m) { this._errOnly('HEURISTICS', l, m); }
  moves(l, d, m)      { this._errOnly('MOVES', l, m); }
  pv(l, d, m)         { this._errOnly('PV', l, m); }
  time(l, d, m)       { this._errOnly('TIME', l, m); }
  stage(l, d, m)      { this._errOnly('STAGE', l, m); }
  // Legacy specialized — pure no-ops
  evalBreakdown() {}
  heuristicCalc() {}
  moveOrderingDecision() {}
  logStageTransition() {}
  logOpeningViolation() {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton with runtime swap
// ─────────────────────────────────────────────────────────────────────────────
let _instance = new EngineLogger();

export function installNoopLogger() {
  _instance.close();
  _instance = new NoopLogger();
  for (const k of Object.keys(LOG)) LOG[k] = false;
}

export function installRealLogger(opts) {
  if (_instance instanceof EngineLogger) _instance.close();
  _instance = new EngineLogger(opts);
}

// Proxy so `import logger from ...` always sees the current instance
const logger = new Proxy({}, {
  get(_, prop) { return _instance[prop]; }
});

export default logger;
export { LOG_CATEGORY, GAME_STAGE };