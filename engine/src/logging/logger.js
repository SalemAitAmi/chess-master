/**
 * Unified engine logger.
 *
 * Output structure (one run folder, one file per active category):
 *
 *   logs/<ISO-timestamp>/
 *     system.log          plain text — server lifecycle, UCI echo
 *     search.ndjson       iteration summaries, turn results
 *     eval.ndjson         sampled leaf evaluations
 *     ...
 *
 * Line format:
 *   {"t":42,"cat":"search","msg":"iteration","d":6,"cp":25,...}
 *
 *   t   = half-move turn counter (the primary analysis key)
 *   cat = category tag (matches the filename)
 *   msg = event name
 *   ... = category-specific fields
 *
 * Session ID and game ID are logged ONCE at init / game-start, not per line.
 * Timestamps are encoded in the folder name, not repeated in every record.
 *
 * INVARIANT: nothing touches the filesystem until _stream() is first called,
 * and _stream() is unreachable while the category bit is clear. A default mask
 * of 0 (tests, production) creates no files and no timers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LOG_CATEGORY, CAT, CAT_BIT, GAME_STAGE } from './categories.js';

const __DEV__ = globalThis.__DEV__ ?? true;
const LOG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../logs');

/** Per-turn frequency: cheap categories only. Hot ones stay off by default. */
const DEV_DEFAULT =
  LOG_CATEGORY.SYSTEM | LOG_CATEGORY.UCI | LOG_CATEGORY.SEARCH |
  LOG_CATEGORY.PV | LOG_CATEGORY.BOOK | LOG_CATEGORY.TIME | LOG_CATEGORY.STAGE;

/** Hot-path guard flags. Read these; never call isEnabled() in a loop. */
export const LOG = {
  any: false, search: false, eval: false, moveOrder: false, tt: false, uci: false,
  book: false, heuristics: false, moves: false, pv: false, time: false, stage: false,
};

function refreshFlags(mask) {
  LOG.any        = mask !== 0;
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

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function field(v) {
  if (typeof v === 'bigint') return `"${v.toString(16)}"`;
  if (v === undefined) return 'null';
  return JSON.stringify(v);
}

// ─────────────────────────────────────────────────────────────────────────────
class FileLogger {
  constructor() {
    this.mask = 0;                      // nothing enabled until setMask()
    this.sampleRate = 256;
    this.turn = 0;
    this.dir = null;
    this.streams = Object.create(null);
    this.counters = Object.create(null);
    this.timer = null;
    this.stats = { written: 0, dropped: 0 };
  }

  setMask(mask) {
    this.mask = mask | 0;
    refreshFlags(this.mask);
    if (this.mask === 0) this._closeStreams();
  }
  getMask() { return this.mask; }
  setSampleRate(n) { this.sampleRate = Math.max(1, n | 0); }

  // ── Lazy filesystem. Nothing above this line ever creates a file. ──────
  _dir() {
    if (this.dir) return this.dir;
    this.dir = path.join(LOG_ROOT, stamp());
    fs.mkdirSync(this.dir, { recursive: true });
    this.timer = setInterval(() => this._flushAll(), 5000);
    this.timer.unref?.();
    return this.dir;
  }

  _stream(file) {
    let s = this.streams[file];
    if (s) return s;
    s = fs.createWriteStream(path.join(this._dir(), file), { flags: 'a', highWaterMark: 1 << 16 });
    this.streams[file] = s;
    return s;
  }

  _closeStreams() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const k in this.streams) this.streams[k].end();
    this.streams = Object.create(null);
    this.dir = null;
  }

  // ── Core write. One JSON object per line, keyed by half-move turn. ─────
  _emit(cat, msg, fields) {
    let line = `{"t":${this.turn},"cat":"${cat}","msg":${JSON.stringify(msg)}`;
    if (fields) for (const k in fields) line += `,${JSON.stringify(k)}:${field(fields[k])}`;
    line += '}\n';
    this._stream(`${cat}.ndjson`).write(line);
    this.stats.written++;
  }

  /** Always written when the category is on. Per-turn frequency. */
  event(cat, msg, fields) {
    if ((this.mask & CAT_BIT[cat]) === 0) return;
    this._emit(cat, msg, fields);
  }

  /** Sampled. The ONLY call permitted at per-node frequency. */
  trace(cat, msg, fields) {
    if ((this.mask & CAT_BIT[cat]) === 0) return;
    const n = (this.counters[cat] = (this.counters[cat] ?? 0) + 1);
    if (n % this.sampleRate !== 0) { this.stats.dropped++; return; }
    this._emit(cat, msg, fields);
  }

  /**
   * Human-readable system line. Goes to system.log — the format you quoted in
   * the bug report (`[ISO] < go depth 12`).
   */
  write(text) {
    if ((this.mask & LOG_CATEGORY.SYSTEM) === 0) return;
    this._stream('system.log').write(`[${new Date().toISOString()}] ${text}\n`);
  }

  /** Session init — logged once. */
  startSession() {
    this.event(CAT.SYSTEM, 'session-start', { id: `s${Date.now().toString(36)}` });
  }

  /** Game init — logged once per game. Resets the turn counter. */
  startGame(id = null) {
    const gid = id ?? `g${Date.now().toString(36)}`;
    this.turn = 0;
    this.event(CAT.SYSTEM, 'game-start', { gameId: gid });
    this.write(`[GAME] new game ${gid}`);
  }

  /** Increment the half-move turn counter. Called by the search per turn. */
  startTurn() { return ++this.turn; }

  getStats() { return { ...this.stats, dir: this.dir, mask: this.mask }; }

  _flushAll() { for (const k in this.streams) { const s = this.streams[k]; if (!s.destroyed) s.write(''); } }
  async flush() { this._flushAll(); await new Promise(r => setTimeout(r, 100)); }
  flushSync() {
    for (const k in this.streams) {
      try { const s = this.streams[k]; if (!s.destroyed) fs.fdatasyncSync(s.fd); } catch { /* best effort */ }
    }
  }
  close() { this._closeStreams(); }

  clear() {
    this._closeStreams();
    if (fs.existsSync(LOG_ROOT)) fs.rmSync(LOG_ROOT, { recursive: true, force: true });
    this.counters = Object.create(null);
    this.stats = { written: 0, dropped: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
class NoopLogger {
  setMask() {} getMask() { return 0; } setSampleRate() {}
  event() {} trace() {} write() {}
  startSession() {} startGame() {} startTurn() { return 0; }
  getStats() { return { written: 0, dropped: 0, mask: 0 }; }
  async flush() {} flushSync() {} close() {} clear() {}
}

// ── Singleton ────────────────────────────────────────────────────────────────
// In dev: FileLogger, mask 0 until setMask is called. Server calls setMask at
// startup. Tests call installNoopLogger(). In prod (__DEV__=false): NoopLogger
// from the start — the FileLogger constructor never runs.
let _instance = __DEV__ ? new FileLogger() : new NoopLogger();

export function installNoopLogger() { _instance.close(); _instance = new NoopLogger(); refreshFlags(0); }
export function installRealLogger(opts) { _instance.close(); _instance = new FileLogger(opts); }

const logger = new Proxy({}, {
  get(_, prop) { const v = _instance[prop]; return typeof v === 'function' ? v.bind(_instance) : v; },
});

export default logger;
export { LOG_CATEGORY, CAT, GAME_STAGE };