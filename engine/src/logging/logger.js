/**
 * Unified engine logger.
 *
 *   logs/<session-ISO>/
 *     session.log            plain text: server lifecycle, UCI echo (all engines)
 *     session.json           session metadata: sample rate (+lock), mask, game count
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
 *   {"seq":<n>,"g":<game>,"t":<halfmove>,"eng":"<instance>","msg":"<event>", ...}
 *   {"seq":<n>,"g":<game>,"t":<halfmove>,"eng":"<instance>","ti":<k>,"msg":"<trace>", ...}
 *   {"seq":<n>,"g":<game>,"t":<halfmove>,"eng":"<instance>","cmd":"<command>", ...}
 *
 *   seq  monotonic within a game, across ALL files and ALL engine instances.
 *        This is the operation sequence: sorting by it reconstructs the exact
 *        interleaving of UCI traffic, ordering, search and evaluation.
 *   t    real half-move index of the position: (fullMove-1)*2 + (black to move).
 *   eng  engine instance id. Lines from two instances share one game directory.
 *   ti   SAMPLED RECORDS ONLY: the per-category trace counter at emission.
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
 * ── SAMPLING ─────────────────────────────────────────────────────────────
 * `event()` records are complete. `trace()` records are sampled: per category,
 * every `sampleRate`-th call is written (the counter resets per game, like
 * `seq`). Each sampled record carries `ti`, so a reader knows EXACTLY how many
 * trace calls fell between two samples (ti[k] - ti[k-1] - 1) and can verify
 * the rate (ti % rate === 0) instead of trusting it.
 *
 * INVARIANT: the sample rate is fixed for the whole log session. It may be
 * changed freely until the first game of the session begins
 * (beginGameIfArmed); from then on setSampleRate() refuses any DIFFERENT value
 * until the session closes (setMask(0), clear(), process exit). The rate is
 * written to <session>/session.json and onto every `game-begin` record, so no
 * consumer has to guess it.
 *
 * Why the session and not the game: every pooled statistic the analyser
 * draws (leaf component distributions, ordering rates, per-stage correlations)
 * is pooled across the games of ONE session; two games sampled at different
 * densities would weight one of them N× in every pool, silently. And there is
 * exactly one logger per process, shared by every engine instance, so a
 * per-game rule would need every instance to agree at every reset barrier for
 * no analytical gain. A different resolution is a different session.
 *
 * ── GAME BOUNDARIES ──────────────────────────────────────────────────────
 * A game directory is created LAZILY, on the first search of the game.
 *
 *   EngineSession.noteNewGame()  → logger.armGame()
 *       every registered instance has issued `ucinewgame`; the NEXT game is
 *       armed. Current game streams are closed, so everything emitted from
 *       here on goes to boot/ (= "out of game").
 *
 *   UCIHandler.handleCommand('go') → logger.beginGameIfArmed()
 *       the armed game becomes real: game-N/ is created, `seq` restarts at 1.
 *
 * Rotating ON the barrier (the previous design) split it: the instance whose
 * `ucinewgame` completed the barrier had its `isready` — and the client's
 * follow-up `gamestate` — land as seq 1-2 of the new game, and a barrier whose
 * game was never played left behind a directory containing nothing but that
 * tail. Arming is idempotent and costs nothing when the game never starts.
 *
 * Every record carries `g`: the game index, or 0 when out of game. boot/ holds
 * g=0 records only; game-N/ holds g=N records only. `seq` is per-game and
 * restarts at 1; out-of-game records use a separate session-wide counter
 * (`bootSeq`), which therefore keeps climbing across the whole session — that
 * is intentional, and `g` is what separates the phases.
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
const DEFAULT_SAMPLE_RATE = 256;

export const LOG = {
  any: false, search: false, eval: false, moveOrder: false, tt: false, uci: false,
  book: false, heuristics: false, moves: false, pv: false, time: false, stage: false,
  smp: false,
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
  LOG.smp        = (mask & LOG_CATEGORY.SMP) !== 0;
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
    this.sampleRate = DEFAULT_SAMPLE_RATE;
    this.sampleLocked = false;
    this.ctx = ORPHAN;
    this.sessionDir = null;
    this.sessionStartedAt = null;
    this.gameIndex = 0;
    this.gameDir = null;
    this.gameRecords = 0;
    this.seq = 0;
    this.bootSeq = 0;
    this.pendingGame = 0;     // armed-but-not-started game index (0 = none)
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

  /**
   * Trace sample rate (1-in-N). See the SAMPLING section in the header.
   * @returns {boolean} false when the change was refused (locked for the
   *          session); the same value is always accepted as a no-op.
   */
  setSampleRate(n) {
    const v = Math.max(1, n | 0);
    if (v === this.sampleRate) return true;
    if (this.sampleLocked) return false;
    this.sampleRate = v;
    if (this.sessionDir !== null) this._writeSessionMeta();
    return true;
  }
  getSampleRate() { return this.sampleRate; }
  canSetSampleRate(n) { const v = Math.max(1, n | 0); return v === this.sampleRate || !this.sampleLocked; }
  isSampleRateLocked() { return this.sampleLocked; }

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
    this.sessionStartedAt = new Date().toISOString();
    this.timer = setInterval(() => this._flushAll(), 5000);
    if (this.timer && this.timer.unref) this.timer.unref();
    this._writeSessionMeta();
    return this.sessionDir;
  }

  /** <session>/session.json — the one place a consumer reads the sample rate from. */
  _writeSessionMeta() {
    if (this.sessionDir === null) return;
    const meta = {
      session: path.basename(this.sessionDir),
      startedAt: this.sessionStartedAt,
      updatedAt: new Date().toISOString(),
      mask: this.mask,
      sampleRate: this.sampleRate,
      sampleRateLocked: this.sampleLocked,
      games: this.gameIndex,
    };
    try { fs.writeFileSync(path.join(this.sessionDir, 'session.json'), JSON.stringify(meta, null, 2) + '\n'); }
    catch { /* best effort: the same values are on every game-begin record */ }
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
    this.sessionStartedAt = null;
    this.gameDir = null;
    this.gameIndex = 0;
    this.pendingGame = 0;
    this.gameRecords = 0;
    this.sampleLocked = false;          // session boundary: the rate is free again
  }

  // ── Core write ────────────────────────────────────────────────────────
  /** @param {number} ti  trace counter for sampled records; 0 for events */
  _emit(cat, label, fields, ti) {
    const inGame = this.gameDir !== null;
    const seq = inGame ? ++this.seq : ++this.bootSeq;
    let line = `{"seq":${seq},"g":${inGame ? this.gameIndex : 0},"t":${this.turn},` +
               `"eng":${JSON.stringify(this.ctx.eng)}` +
               (ti > 0 ? `,"ti":${ti}` : '') +
               `,${JSON.stringify(labelKeyFor(cat))}:${JSON.stringify(label)}`;
    if (fields) for (const k in fields) line += `,${JSON.stringify(k)}:${field(fields[k])}`;
    line += '}\n';
    this._stream(this._recordDir(), `${cat}.ndjson`).write(line);
    if (inGame) this.gameRecords++;
    this.stats.written++;
  }

  /**
   * Arm the next game. Called ONLY by EngineSession, once every registered
   * instance has issued `ucinewgame`. Closes the current game's streams, so
   * the remainder of the reset barrier is attributed to boot/ (out of game)
   * rather than to either the old or the new game.
   *
   * Idempotent: re-arming an already-armed game is a no-op.
   */
  armGame() {
    if (this.mask === 0) return this.gameIndex + 1;
    if (this.pendingGame !== 0) return this.pendingGame;
    this._closeGameStreams();
    this.pendingGame = this.gameIndex + 1;
    this.event(CAT.SYSTEM, 'game-armed', { game: this.pendingGame });
    this.write(`[GAME] game-${this.pendingGame} armed`);
    return this.pendingGame;
  }

  /**
   * Materialise the armed game. Called by UCIHandler on `go`, i.e. at the
   * first decision of the game — so an armed game that is never played leaves
   * no directory behind. The FIRST game of a session locks the sample rate.
   */
  beginGameIfArmed() {
    if (this.mask === 0 || this.pendingGame === 0) return this.gameIndex;
    this.gameIndex = this.pendingGame;
    this.pendingGame = 0;
    this.gameDir = path.join(this._session(), `game-${this.gameIndex}`);
    fs.mkdirSync(this.gameDir, { recursive: true });
    this.gameRecords = 0;
    this.seq = 0;
    this.counters = Object.create(null);
    if (!this.sampleLocked) {
      this.sampleLocked = true;
      this.write(`[SESSION] trace sample rate locked at 1/${this.sampleRate} for this session`);
    }
    this._writeSessionMeta();
    this.write(`[GAME] game-${this.gameIndex} begin`);
    this.event(CAT.SYSTEM, 'game-begin', { game: this.gameIndex, sampleRate: this.sampleRate, mask: this.mask });
    return this.gameIndex;
  }

  /** Back-compat alias. Arming is the only externally meaningful operation. */
  startGame() { return this.armGame(); }

  event(cat, label, fields) {
    if ((this.mask & CAT_BIT[cat]) === 0) return;
    this._emit(cat, label, fields, 0);
  }

  trace(cat, label, fields) {
    if ((this.mask & CAT_BIT[cat]) === 0) return;
    const n = (this.counters[cat] = (this.counters[cat] ?? 0) + 1);
    if (n % this.sampleRate !== 0) { this.stats.dropped++; return; }
    this._emit(cat, label, fields, n);
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

  getStats() {
    return { ...this.stats, session: this.sessionDir, game: this.gameDir,
             gameIndex: this.gameIndex, pendingGame: this.pendingGame,
             seq: this.seq, bootSeq: this.bootSeq, mask: this.mask,
             sampleRate: this.sampleRate, sampleRateLocked: this.sampleLocked };
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
  setMask() {} getMask() { return 0; }
  setSampleRate() { return true; } getSampleRate() { return 0; }
  canSetSampleRate() { return true; } isSampleRateLocked() { return false; }
  bind(c) { return c; } bindBoard() {} lockTurn() { return -1; } unlockTurn() {}
  get turn() { return -1; }
  event() {} trace() {} write() {} sessionRecord() {}
  startSession() {} startGame() { return 0; }
  armGame() { return 0; } beginGameIfArmed() { return 0; }
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