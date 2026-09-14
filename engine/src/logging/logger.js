/**
 * Unified engine logger.
 *
 *   logs/<session-ISO>/
 *     session.log            plain text: server lifecycle, UCI echo (all engines)
 *     instances.ndjson       one record per engine instance: profile + resolved config
 *     boot/                  records emitted before ANY game starts
 *       book.ndjson  tt.ndjson  uci.ndjson
 *     game-1/                one directory per GAME, shared by all engine instances
 *       search.ndjson  eval.ndjson  heuristics.ndjson  order.ndjson
 *       tt.ndjson      uci.ndjson   moves.ndjson       pv.ndjson
 *       time.ndjson    stage.ndjson book.ndjson
 *     game-2/ ...
 *
 * Line shape — no `cat` (the filename is the category), no `msg` in uci.ndjson:
 *
 *   {"seq":<n>,"t":<halfmove>,"eng":"<instance>","msg":"<event>", ...}
 *   {"seq":<n>,"t":<halfmove>,"eng":"<instance>","cmd":"<command>", ...}
 *
 *   seq  monotonic within a game, across ALL files and ALL engine instances.
 *        This is the operation sequence: sorting by it reconstructs the exact
 *        interleaving of UCI traffic, ordering, search and evaluation.
 *   t    real half-move index of the position: (fullMove-1)*2 + (black to move).
 *   eng  engine instance id. Lines from two instances share one game directory.
 *
 * CONTEXT. `t` and `eng` come from a bound LogContext, not from call sites.
 * The server binds the context of whichever instance it is dispatching to,
 * before dispatch. Command handling is synchronous (the search is synchronous),
 * so one active context at a time is sufficient — see EngineSession.dispatch,
 * which re-binds after every await.
 *
 * TURN LOCK. makeMove/undoMove mutate the board during search, so `t` is frozen
 * at the root position for the duration of a search (SearchEngine._prepare /
 * _finish). Every line emitted anywhere in the tree is attributed to the turn
 * the search is deciding.
 *
 * GAME ROTATION is owned by EngineSession, not by UCIHandler: with two engine
 * instances, `ucinewgame` arrives twice per game.
 *
 * INVARIANT: no filesystem access until a line is actually emitted, and no line
 * is reachable while the category bit is clear.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LOG_CATEGORY, CAT, CAT_BIT, GAME_STAGE } from './categories.js';

const __DEV__ = globalThis.__DEV__ ?? true;
const LOG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../logs');
const BOOT_DIR = 'boot';
const NO_POSITION = -1;

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

/** uci.ndjson labels its event `cmd`; everything else uses `msg`. */
const LABEL_KEY = Object.create(null);
LABEL_KEY[CAT.UCI] = 'cmd';
const labelKeyFor = (cat) => LABEL_KEY[cat] ?? 'msg';

/** Per-engine-instance logging context. One per UCIHandler. */
export class LogContext {
  constructor(eng) {
    this.eng = eng;
    this.board = null;
    this.turnLock = NO_POSITION;
  }
}
const ORPHAN = new LogContext('-');

// ─────────────────────────────────────────────────────────────────────────────
class FileLogger {
  constructor() {
    this.mask = 0;
    this.sampleRate = 256;

    this.ctx = ORPHAN;

    this.sessionDir = null;
    this.gameIndex = 0;
    this.gameDir = null;
    this.gameRecords = 0;
    this.seq = 0;
    this.bootSeq = 0;

    this.streams = Object.create(null);   // relPath -> WriteStream
    this.counters = Object.create(null);
    this.timer = null;
    this.stats = { written: 0, dropped: 0 };
  }

  setMask(mask) {
    this.mask = mask | 0;
    refreshFlags(this.mask);
    if (this.mask === 0) this._closeAll();
  }
  getMask() { return this.mask; }
  setSampleRate(n) { this.sampleRate = Math.max(1, n | 0); }

  // ── Context ───────────────────────────────────────────────────────────
  bind(ctx) { this.ctx = ctx || ORPHAN; return this.ctx; }
  bindBoard(board) { this.ctx.board = board; this.ctx.turnLock = NO_POSITION; }

  _boardTurn() {
    const b = this.ctx.board;
    if (b === null || b === undefined) return NO_POSITION;
    const gs = b.gameState;
    return (gs.fullMoveCount - 1) * 2 + (gs.activeColor === 'black' ? 1 : 0);
  }
  get turn() { return this.ctx.turnLock !== NO_POSITION ? this.ctx.turnLock : this._boardTurn(); }
  lockTurn(board) {
    if (board !== undefined && board !== null) this.ctx.board = board;
    this.ctx.turnLock = this._boardTurn();
    return this.ctx.turnLock;
  }
  unlockTurn() { this.ctx.turnLock = NO_POSITION; }

  // ── Filesystem ────────────────────────────────────────────────────────
  _session() {
    if (this.sessionDir !== null) return this.sessionDir;
    this.sessionDir = path.join(LOG_ROOT, stamp());
    fs.mkdirSync(this.sessionDir, { recursive: true });
    this.timer = setInterval(() => this._flushAll(), 5000);
    if (this.timer && this.timer.unref) this.timer.unref();
    return this.sessionDir;
  }

  /** Relative directory for category records right now: boot or the game. */
  _recordDir() {
    if (this.gameDir !== null) return this.gameDir;
    const d = path.join(this._session(), BOOT_DIR);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  _stream(dir, file) {
    const rel = path.join(dir, file);
    let s = this.streams[rel];
    if (s) return s;
    s = fs.createWriteStream(rel, { flags: 'a', highWaterMark: 1 << 16 });
    this.streams[rel] = s;
    return s;
  }

  _closeGameStreams() {
    if (this.gameDir === null) return;
    for (const rel of Object.keys(this.streams)) {
      if (rel.startsWith(this.gameDir)) { this.streams[rel].end(); delete this.streams[rel]; }
    }
    this.gameDir = null;
  }

  _closeAll() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const k in this.streams) this.streams[k].end();
    this.streams = Object.create(null);
    this.sessionDir = null;
    this.gameDir = null;
    this.gameIndex = 0;
    this.gameRecords = 0;
  }

  // ── Core write ────────────────────────────────────────────────────────
  _emit(cat, label, fields) {
    const inGame = this.gameDir !== null;
    const seq = inGame ? ++this.seq : ++this.bootSeq;
    let line = `{"seq":${seq},"t":${this.turn},"eng":${JSON.stringify(this.ctx.eng)},` +
               `${JSON.stringify(labelKeyFor(cat))}:${JSON.stringify(label)}`;
    if (fields) for (const k in fields) line += `,${JSON.stringify(k)}:${field(fields[k])}`;
    line += '}\n';
    this._stream(this._recordDir(), `${cat}.ndjson`).write(line);
    if (inGame) this.gameRecords++;
    this.stats.written++;
  }

  event(cat, label, fields) {
    if ((this.mask & CAT_BIT[cat]) === 0) return;
    this._emit(cat, label, fields);
  }

  trace(cat, label, fields) {
    if ((this.mask & CAT_BIT[cat]) === 0) return;
    const n = (this.counters[cat] = (this.counters[cat] ?? 0) + 1);
    if (n % this.sampleRate !== 0) { this.stats.dropped++; return; }
    this._emit(cat, label, fields);
  }

  /** Plain text → <session>/session.log. Spans games and engine instances. */
  write(text) {
    if ((this.mask & LOG_CATEGORY.SYSTEM) === 0) return;
    const tag = this.ctx.eng !== '-' ? `[${this.ctx.eng}] ` : '';
    this._stream(this._session(), 'session.log').write(
      `[${new Date().toISOString()}] ${tag}${text}\n`);
  }

  /** One-shot session-scoped record (engine instance registration). */
  sessionRecord(file, obj) {
    if (this.mask === 0) return;
    this._stream(this._session(), file).write(JSON.stringify(obj) + '\n');
  }

  startSession() {
    if (this.mask === 0) return;
    this._session();
    this.write(`[SESSION] start`);
  }

  /**
   * Rotate into a fresh game directory. Called ONLY by EngineSession, which
   * waits until every registered instance has issued `ucinewgame`. A rotation
   * into an already-empty game directory is a no-op, so a late-joining or
   * double-resetting instance cannot split one game across two directories.
   */
  startGame() {
    if (this.mask === 0) return 0;
    if (this.gameDir !== null && this.gameRecords === 0) return this.gameIndex;
    this._closeGameStreams();
    this.gameIndex++;
    this.gameDir = path.join(this._session(), `game-${this.gameIndex}`);
    fs.mkdirSync(this.gameDir, { recursive: true });
    this.gameRecords = 0;
    this.seq = 0;
    this.counters = Object.create(null);
    this.write(`[GAME] game-${this.gameIndex}`);
    return this.gameIndex;
  }

  getStats() {
    return { ...this.stats, session: this.sessionDir, game: this.gameDir,
             gameIndex: this.gameIndex, seq: this.seq, mask: this.mask };
  }

  _flushAll() { for (const k in this.streams) { const s = this.streams[k]; if (!s.destroyed) s.write(''); } }
  async flush() { this._flushAll(); await new Promise(r => setTimeout(r, 100)); }
  flushSync() {
    for (const k in this.streams) {
      try { const s = this.streams[k]; if (!s.destroyed) fs.fdatasyncSync(s.fd); } catch { /* best effort */ }
    }
  }
  close() { this._closeAll(); }
  clear() {
    this._closeAll();
    if (fs.existsSync(LOG_ROOT)) fs.rmSync(LOG_ROOT, { recursive: true, force: true });
    this.counters = Object.create(null);
    this.stats = { written: 0, dropped: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
class NoopLogger {
  setMask() {} getMask() { return 0; } setSampleRate() {}
  bind(c) { return c; } bindBoard() {} lockTurn() { return -1; } unlockTurn() {}
  get turn() { return -1; }
  event() {} trace() {} write() {} sessionRecord() {}
  startSession() {} startGame() { return 0; }
  getStats() { return { written: 0, dropped: 0, mask: 0 }; }
  async flush() {} flushSync() {} close() {} clear() {}
}

let _instance = __DEV__ ? new FileLogger() : new NoopLogger();
export function installNoopLogger() { _instance.close(); _instance = new NoopLogger(); refreshFlags(0); }
export function installRealLogger() { _instance.close(); _instance = new FileLogger(); }

const logger = new Proxy({}, {
  get(_, prop) { const v = _instance[prop]; return typeof v === 'function' ? v.bind(_instance) : v; },
});

export default logger;
export { LOG_CATEGORY, CAT, GAME_STAGE };