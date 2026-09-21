/**
 * UCI protocol handler — the engine's sole public interface.
 *
 * ONE HANDLER PER ENGINE INSTANCE. The handler owns its SearchEngine (and
 * therefore its transposition table, killer table, history table and counter
 * moves) and its resolved config. Two engines in one session are two handlers
 * on two connections; they share nothing but the log session and game number,
 * which the EngineSession owns.
 *
 * Standard commands: uci, debug, isready, setoption, ucinewgame, position,
 * go, stop, quit.
 *
 * Extensions for interactive play:
 *   validate <move>        → valid true|false [reason]
 *   legalmoves [square]    → legalmoves <uci>...|none
 *   makemove <move>        → <gamestate block> | error <reason>
 *   undomove               → <gamestate block> | error <reason>
 *   gamestate              → <gamestate block>
 *   eval                   → eval <cp>
 *   setlog <mask>          → info string ...
 *   clearlogs              → info string ...
 *   showstage              → info string ...
 *   profiles               → info string profile <name> | <label> | <description>
 *   whoami                 → info string instance ... profile ... cfg ... tt ...
 */
import { Board } from '../core/board.js';
import { SearchEngine } from '../search/search.js';
import { SmpCoordinator } from '../search/smpCoordinator.js';
import { generateAllLegalMoves, isInCheck } from '../core/moveGeneration.js';
import { loadOpeningBook, lookupAllBookMoves, isBookLoaded, getBookStats } from '../book/openingBook.js';
import { squareToIndex } from '../core/bitboard.js';
import { PIECES, PIECE_VALUES, PIECE_CHARS, WHITE_IDX, BLACK_IDX, DEFAULT_CONFIG } from '../core/constants.js';
import { Evaluator } from '../evaluation/evaluate.js';
import { detectGameStage, getStagePriorities } from '../utils/gameStage.js';
import { listProfiles, resolveProfile } from '../config/profiles.js';
import logger, { LOG, CAT, LogContext } from '../logging/logger.js';
import { parseUCICommand } from './uciParser.js';
import { moveToSan } from './san.js';
import {
  OPTIONS, PROFILE_OPTION, findOption, formatOptionLines, readOptionValues,
} from '../config/optionSchema.js';

// ═══════════════════════════════════════════════════════════════════════════
// Module constants
// ═══════════════════════════════════════════════════════════════════════════
const __LOG__ = globalThis.__LOG__ ?? true;

const PROMO_MAP = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };
const HISTORY_WINDOW = 20;
const BLUNDER_CP = 200;

// ═══════════════════════════════════════════════════════════════════════════
export class UCIHandler {
  /**
   * @param {object} config  Flat engine config (from resolveProfile().config).
   * @param {object} opts    { instanceId, session, logCtx, profile }
   *                         `session` is an EngineSession; the default is a
   *                         standalone stub that rotates the log game on every
   *                         `ucinewgame`, which is the single-engine behaviour
   *                         tests rely on.
   */
  constructor(config = {}, opts = {}) {
    // ── Identity ──
    this.instanceId = opts.instanceId ?? 'e0';
    this.profile = opts.profile ?? null;
    this.session = opts.session ?? {
      noteNewGame: () => (__LOG__ ? logger.armGame() : 0),
      describe: () => 'standalone',
    };
    this.logCtx = opts.logCtx ?? new LogContext(this.instanceId);

    // ── Configuration ──
    this.config = { ...DEFAULT_CONFIG, ...config };

    // ── Engine components (private to this instance) ──
    this.board = new Board();
    this.engine = new SearchEngine(this.config);
    this.smp = new SmpCoordinator(this.config);
    // Separate evaluator for `eval` and blunder detection, so a concurrent
    // search can never see a half-reconfigured instance.
    this.evaluator = new Evaluator(this.config);

    if (__LOG__) { logger.bind(this.logCtx); logger.bindBoard(this.board); }

    // ── Protocol state ──
    this.debug = false;
    this.searching = false;

    // ── Game bookkeeping ──
    /** @type {{uci:string,san:string,piece:number,captured:number|null,color:string}[]} */
    this.moveHistory = [];
    this.initialCounts = this._snapshotCounts();
    this.previousEval = 0;

    // ── Book ──
    this.bookReadyPromise = null;
    if (this.config.useOpeningBook) this._beginBookLoad();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Dispatch
  // ═══════════════════════════════════════════════════════════════════════
  async handleCommand(line) {
    // Re-bind on every command: EngineInstance.dispatch does this too, but a
    // standalone handler (tests) has no dispatcher.
    if (__LOG__) logger.bind(this.logCtx);

    const cmd = parseUCICommand(line);
    // `go` is the first decision of a game: materialise the armed game
    // directory here, so this very command lands inside it rather than in the
    // out-of-game area.
    if (__LOG__ && cmd.type === 'go') logger.beginGameIfArmed();
    if (__LOG__ && LOG.uci) logger.event(CAT.UCI, cmd.type, { raw: line });

    switch (cmd.type) {
      case 'uci':        return this.uci();
      case 'debug':      return this.setDebug(cmd.on);
      case 'isready':    return this.isReady();
      case 'setoption':  return this.setOption(cmd.name, cmd.value);
      case 'ucinewgame': return this.newGame();
      case 'position':   return this.position(cmd.fen, cmd.moves);
      case 'go':         return await this.go(cmd);
      case 'stop':       return this.stop();
      case 'quit':       return this.quit();
      case 'validate':   return this.validateMove(cmd.move);
      case 'legalmoves': return this.getLegalMoves(cmd.square);
      case 'makemove':   return this.makeMove(cmd.move);
      case 'undomove':   return this.undoMove();
      case 'gamestate':  return this.getGameState();
      case 'eval':       return `eval ${this._evalScore()}`;
      case 'setlog':     return this.setLogMask(cmd.mask);
      case 'clearlogs':  return this.clearLogs();
      case 'showstage':  return this.showStage();
      case 'profiles':   return this.showProfiles();
      case 'whoami':     return this.whoami();
      case 'options':    return this.showOptions();
      default:
        if (__LOG__ && LOG.uci) {
          logger.event(CAT.UCI, 'unknown', { raw: line, command: cmd.command ?? '' });
        }
        return `info string Unknown command: ${cmd.command !== undefined ? cmd.command : ''}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Standard UCI
  // ═══════════════════════════════════════════════════════════════════════
  uci() {
    return [
      'id name ChessMaster Engine 1.0',
      'id author Chess Master',
      '',
      ...formatOptionLines(listProfiles().map(p => p.name)),
      '',
      'uciok',
    ].join('\n');
  }

  setDebug(on) { this.debug = on; return null; }
  isReady()    { return 'readyok'; }

  /**
   * Registry-driven. Every advertised option is handled, and every handled
   * option is advertised, because both come from optionSchema.OPTIONS.
   *
   * Unknown names are reported, never silently swallowed: a typo in an
   * experiment spec must not quietly produce a control run.
   */
  setOption(name, value) {
    const opt = findOption(name);
    if (opt === null) {
      if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'unknown-option', { name, value });
      return `info string unknown option ${name}`;
    }
    const asBool = () => value === 'true' || value === '1' || value === true;
    const asInt  = () => {
      const n = parseInt(value, 10);
      return Number.isFinite(n) ? n : null;
    };
    const clamp = (n) => {
      if (opt.min !== undefined && n < opt.min) return opt.min;
      if (opt.max !== undefined && n > opt.max) return opt.max;
      return n;
    };

    let changed = true;
    switch (opt.apply) {
      case 'profile':
        changed = this._applyProfile(value);
        break;
      case 'threads': {
        const n = asInt();
        changed = n !== null ? this._setThreads(clamp(n)) : false;
        break;
      }
      case 'weight': {
        const n = asInt();
        changed = n !== null ? this._setWeight(opt.key, clamp(n) / (opt.scale ?? 1)) : false;
        break;
      }
      case 'logmask': {
        const n = asInt();
        changed = false;
        if (n !== null && n >= 0 && logger.getMask() !== n) { logger.setMask(n); changed = true; }
        break;
      }
      case 'logsample': {
        const n = asInt();
        changed = false;
        if (n !== null && n >= 1) { logger.setSampleRate(n); changed = true; }
        break;
      }
      default: {
        if (opt.type === 'check') changed = this._set(opt.key, asBool());
        else {
          const n = asInt();
          changed = n !== null ? this._set(opt.key, clamp(n)) : false;
        }
      }
    }
    if (changed && __LOG__ && LOG.uci) {
      logger.event(CAT.UCI, 'option', { name: opt.uci, value, key: opt.key ?? opt.apply });
    }
    return null;
  }

  /** Current value of every option — lets a client resync after reconnect. */
  showOptions() {
    return readOptionValues(this.config, logger.getMask())
      .map(o => `info string option ${o.uci} ${o.value}`)
      .join('\n');
  }

  newGame() {
    this.board = new Board();
    if (__LOG__) logger.bindBoard(this.board);
    this.moveHistory = [];
    this.initialCounts = this._snapshotCounts();
    this.previousEval = 0;
    if (this.engine.tt !== null) this.engine.tt.clear();
    // Log rotation is SESSION-owned: with N instances, `ucinewgame` arrives
    // N times per game and must rotate exactly once.
    this.session.noteNewGame(this.instanceId);
    return null;
  }

  position(fen, moves) {
    this.board = fen ? Board.fromFen(fen) : new Board();
    if (__LOG__) logger.bindBoard(this.board);
    this.moveHistory = [];
    // Baseline for captured-piece derivation is whatever the supplied position
    // contains — mid-game FENs report captures relative to that position.
    this.initialCounts = this._snapshotCounts();
    this.previousEval = 0;

    for (const moveStr of moves) {
      if (this._applyMove(moveStr) === null) {
        if (__LOG__ && LOG.uci) {
          logger.event(CAT.UCI, 'illegal-move', { raw: moveStr, fen: this.board.toFen() });
        }
        break;
      }
    }
    return null;
  }

  async go(options) {
    if (this.searching) return null;
    this.searching = true;
    const responses = [];

    try {
      const legalMoves = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
      if (legalMoves.length === 0) return 'bestmove (none)';

      const bookHints = await this._bookHintsFor(legalMoves, responses);
      if (__LOG__) logger.bind(this.logCtx);   // re-bind after the await
      this._noteSmpIntent(responses);

      // `movetime` overrides the configured ceiling for this search only.
      // TODO: wtime/btime/movestogo are parsed but not used — there is no clock
      // manager yet. `infinite` and `nodes` are accepted and ignored.
      const savedMaxTime = this.engine.config.maxSearchTime;
      if (options.movetime) this.engine.config.maxSearchTime = options.movetime;

      let result;
      try {
        result = this.engine.search(this.board, options.depth || this.config.maxDepth, { bookHints });
      } finally {
        this.engine.config.maxSearchTime = savedMaxTime;
      }

      this._formatSearchResult(result, bookHints, responses);
    } catch (err) {
      logger.event(CAT.UCI, 'error', { error: err.message, stack: err.stack });
      responses.push(`info string Error: ${err.message}`);
      responses.push('bestmove (none)');
    } finally {
      this.searching = false;
    }

    return responses.join('\n');
  }

  stop() { this.engine.stop(); this.smp.stop(); this.searching = false; return null; }
  quit() { this.smp.terminate(); return 'quit'; }

  setLogMask(mask) { logger.setMask(mask); return `info string Log mask set to ${mask}`; }
  clearLogs() { logger.clear(); return 'info string Logs cleared'; }

  showStage() {
    const s = detectGameStage(this.board);
    return [
      `info string Stage: ${s.stage}`,
      `info string Move: ${s.fullMoveNumber} (ply ${s.halfMoveCount})`,
      `info string Phase: ${(s.phasePercent * 100).toFixed(1)}%`,
      `info string Priorities: ${getStagePriorities(s.stage).join(', ')}`,
    ].join('\n');
  }

  showProfiles() {
    return listProfiles()
      .map(p => `info string profile ${p.name} | ${p.label} | ${p.description}`)
      .join('\n');
  }

  whoami() {
    const tt = this.engine.tt;
    return [
      `info string instance ${this.instanceId}`,
      `info string profile ${this.profile !== null ? this.profile.name : 'adhoc'}`,
      `info string cfg ${this.profile !== null ? this.profile.hash : 'n/a'}`,
      `info string tt ${tt === null ? 'none' : `${tt.size} entries`}`,
      `info string session ${this.session.describe()}`,
    ].join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Interactive extensions
  // ═══════════════════════════════════════════════════════════════════════
  validateMove(moveStr) {
    if (!moveStr || moveStr.length < 4) return 'valid false invalid_format';

    const from = squareToIndex(moveStr.slice(0, 2));
    const to   = squareToIndex(moveStr.slice(2, 4));
    if (from === -1 || to === -1) return 'valid false invalid_squares';

    const promoChar = moveStr.length > 4 ? moveStr[4].toLowerCase() : null;
    if (promoChar !== null && !(promoChar in PROMO_MAP)) return 'valid false invalid_promotion';
    const wanted = promoChar !== null ? PROMO_MAP[promoChar] : null;

    const candidates = this._candidates(from, to);
    if (candidates.length === 0) {
      const piece = this.board.pieceList[from];
      if (piece === PIECES.NONE) return 'valid false no_piece';
      const owner = this.board.bbSide[WHITE_IDX].getBit(from) ? 'white' : 'black';
      if (owner !== this.board.gameState.activeColor) return 'valid false wrong_color';
      return 'valid false illegal_move';
    }

    // Move generation emits one entry per promotion piece and no bare variant,
    // so isPromotion is uniform across candidates for a given from/to.
    if (!candidates[0].isPromotion) {
      return promoChar !== null ? 'valid false unexpected_promotion' : 'valid true';
    }
    if (wanted === null) return 'valid true needs_promotion';
    return candidates.some(m => m.promotionPiece === wanted)
      ? 'valid true' : 'valid false invalid_promotion';
  }

  getLegalMoves(square = null) {
    const legal = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
    let filtered = legal;

    if (square) {
      const from = squareToIndex(square);
      if (from === -1) return 'legalmoves none invalid_square';
      filtered = legal.filter(m => m.fromSquare === from);
    }

    if (filtered.length === 0) return 'legalmoves none';
    return 'legalmoves ' + filtered.map(m => m.algebraic).join(' ');
  }

  makeMove(moveStr) {
    const validation = this.validateMove(moveStr);
    if (validation !== 'valid true') {
      const reason = validation.startsWith('valid true ')
        ? validation.slice('valid true '.length)
        : validation.slice('valid false '.length);
      return `error ${reason}`;
    }
    return this._applyMove(moveStr) !== null ? this.getGameState() : 'error illegal_move';
  }

  undoMove() {
    if (this.board.plyCount === 0) return 'error no_moves_to_undo';
    this.board.undoMove();
    this.moveHistory.pop();
    return this.getGameState();
  }

  getGameState() {
    const gs = this.board.gameState;
    const legalMoves = generateAllLegalMoves(this.board, gs.activeColor);
    const inCheck = isInCheck(this.board, gs.activeColor);

    let status = 'ongoing';
    let winner = 'none';

    if (legalMoves.length === 0) {
      if (inCheck) { status = 'checkmate'; winner = gs.activeColor === 'white' ? 'black' : 'white'; }
      else         { status = 'stalemate'; winner = 'draw'; }
    } else if (gs.halfMoveClock >= 100)        { status = 'fifty_move';            winner = 'draw'; }
    else if (this.board.isRepetition(3))       { status = 'threefold';             winner = 'draw'; }
    else if (this._isInsufficientMaterial())   { status = 'insufficient_material'; winner = 'draw'; }

    const material = this._countMaterial();
    const currentEval = this._evalScore();
    const lastMove = this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1] : null;

    const evalDiff = currentEval - this.previousEval;
    const isBlunder = lastMove !== null &&
      ((lastMove.color === 'white' && evalDiff < -BLUNDER_CP) ||
       (lastMove.color === 'black' && evalDiff >  BLUNDER_CP));

    const lines = [
      `fen ${this.board.toFen()}`,
      `turn ${gs.activeColor}`,
      `fullmove ${gs.fullMoveCount}`,
      `halfmove ${gs.halfMoveClock}`,
      `status ${status}`,
      `winner ${winner}`,
      `incheck ${inCheck}`,
      `legalmovecount ${legalMoves.length}`,
      `eval ${currentEval}`,
      `material_white ${material.white}`,
      `material_black ${material.black}`,
      `material_diff ${material.white - material.black}`,
      `captured_white ${this._capturedString(WHITE_IDX)}`,
      `captured_black ${this._capturedString(BLACK_IDX)}`,
      `movecount ${this.moveHistory.length}`,
      `canundo ${this.board.plyCount > 0}`,
      `blunder ${isBlunder}`,
      `repetitions ${this.board.countRepetitions()}`,
    ];

    if (lastMove !== null) {
      lines.push(`lastmove ${lastMove.uci}`);
      lines.push(`lastmovesan ${lastMove.san}`);
      lines.push(`lastpiece ${PIECE_CHARS[lastMove.piece]}`);
      lines.push(`lastcaptured ${lastMove.captured !== null ? PIECE_CHARS[lastMove.captured] : 'none'}`);
    }

    const window = this.moveHistory.slice(-HISTORY_WINDOW);
    lines.push(`history ${window.map(m => m.san).join(' ') || 'none'}`);
    lines.push(`historyuci ${window.map(m => m.uci).join(' ') || 'none'}`);

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Configuration internals
  // ═══════════════════════════════════════════════════════════════════════
  /**
   * Flat config key. A no-op set is NOT an event: the client pushes its whole
   * settings blob on every connect, and logging + rebuilding for ~43 unchanged
   * options per socket is what made boot/ start at seq 85 and rebuilt the
   * Evaluator dozens of times during a handshake.
   */
  _set(key, value) {
    if (this.config[key] === value) return false;
    this.config[key] = value;
    this.engine.setOption(key, value);
    this.evaluator = new Evaluator(this.config);
    return true;
  }

  _setWeight(name, value) {
    if (this.config.weights?.[name] === value) return false;
    this.config.weights = { ...this.config.weights, [name]: value };
    this.engine.setOption('weights', this.config.weights);
    this.evaluator = new Evaluator(this.config);
    return true;
  }

  _setThreads(n) {
    if (this.config.threads === n) return false;
    const applied = this.smp.setThreadCount(n);
    this.config.threads = applied;
    this.engine.setOption('threads', applied);
    return true;
  }

  /**
   * Swap the entire config set. Rebuilds the search engine, which means a FRESH
   * transposition table and fresh heuristic tables — comparing profiles with a
   * warm table from the previous profile would contaminate the measurement.
   */
  _applyProfile(name) {
    let resolved;
    try {
      resolved = resolveProfile(name);
    } catch (err) {
      if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'profile-error', { raw: name, error: err.message });
      return false;
    }
    // Already in force: a rebuild would throw away a warm TT and warm
    // killer/history tables for nothing. The client re-pushes its whole
    // settings blob on every connect, so this fires constantly.
    if (this.profile !== null && this.profile.hash === resolved.hash &&
        this.profile.name === resolved.name) {
      return false;
    }
    this.profile = resolved;
    this.config = { ...resolved.config };
    this.engine = new SearchEngine(this.config);
    this.evaluator = new Evaluator(this.config);
    this.smp = new SmpCoordinator(this.config);
    if (__LOG__) {
      logger.sessionRecord('instances.ndjson', {
        session: this.session.describe(), eng: this.instanceId,
        profile: resolved.name, label: resolved.label, description: resolved.description,
        configHash: resolved.hash,
        tt: this.engine.tt === null ? 'none' : `${this.engine.tt.size}@${resolved.hash}`,
        config: resolved.config,
      });
      logger.write(`[INSTANCE] ${this.instanceId} profile→${resolved.name} cfg=${resolved.hash}`);
    }
    return true;
  }

  _beginBookLoad() {
    this.bookReadyPromise = loadOpeningBook()
      .then(b => {
        if (b !== null && __LOG__ && LOG.book) {
          const stats = getBookStats();
          logger.event(CAT.BOOK, 'book-ready', { positions: stats.positions });
        }
        return b;
      })
      .catch(err => {
        if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'book-error', { error: err.message });
        return null;
      });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Search internals
  // ═══════════════════════════════════════════════════════════════════════
  async _bookHintsFor(legalMoves, responses) {
    if (!this.config.useOpeningBook) return null;
    if (this.bookReadyPromise !== null) await this.bookReadyPromise;
    if (!isBookLoaded()) return null;
    const hints = lookupAllBookMoves(this.board, legalMoves);
    if (hints !== null) responses.push(`info string Book: ${hints.size} hint(s)`);
    return hints;
  }

  /** Threads > 1 is accepted and recorded, but the search stays single-threaded. */
  _noteSmpIntent(responses) {
    if (!this.smp.isMultiThreaded()) return;
    responses.push(`info string SMP requested (${this.smp.describe()}) — running single-threaded`);
  }

  _formatSearchResult(result, bookHints, responses) {
    let best = result.bestMove;
    if (best === null) {
      // A deadline abort during the very first iteration can leave no root
      // move. Answering `(none)` claims the position is terminal, which the
      // client reads as a desync. Fall back to the first legal move and say so.
      const legal = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
      if (legal.length > 0) {
        best = legal[0];
        responses.push(`info string search produced no move (aborted after ` +
                       `${result.time}ms); playing first legal move`);
        logger.event(CAT.UCI, 'no-root-move', {
          ms: result.time, depth: result.depth, fen: this.board.toFen(),
        });
      }
    }
    const bestAlg = best !== null ? best.algebraic : '(none)';
    if (bookHints !== null && best !== null) {
      const verdict = bookHints.has(bestAlg) ? 'confirmed' : 'OVERRIDDEN';
      responses.push(`info string Book ${verdict} (${bestAlg} cp=${result.score})`);
    }
    const pvStr = result.pv.length > 0 ? result.pv.map(m => m.algebraic).join(' ') : '';
    responses.push(
      `info depth ${result.depth} seldepth ${result.seldepth} nodes ${result.nodes} ` +
      `time ${result.time} score cp ${result.score} pv ${pvStr}`
    );
    responses.push(`bestmove ${bestAlg}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Move internals
  // ═══════════════════════════════════════════════════════════════════════
  _candidates(from, to) {
    return generateAllLegalMoves(this.board, this.board.gameState.activeColor)
      .filter(m => m.fromSquare === from && m.toSquare === to);
  }

  /** Apply a UCI move string. Returns the move object, or null if illegal. */
  _applyMove(moveStr) {
    const from = squareToIndex(moveStr.slice(0, 2));
    const to   = squareToIndex(moveStr.slice(2, 4));
    if (from === -1 || to === -1) return null;

    const promoChar = moveStr.length > 4 ? moveStr[4].toLowerCase() : null;
    const wanted = promoChar !== null ? PROMO_MAP[promoChar] : null;

    const legal = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
    const candidates = legal.filter(m => m.fromSquare === from && m.toSquare === to);
    if (candidates.length === 0) return null;

    let move;
    if (wanted !== null) {
      move = candidates.find(m => m.promotionPiece === wanted);
    } else {
      move = candidates.find(m => !m.isPromotion);
      if (move === undefined) move = candidates.find(m => m.promotionPiece === PIECES.QUEEN);
    }
    if (move === undefined) return null;

    // SAN must be computed BEFORE the move (it needs the sibling move list for
    // disambiguation); moveToSan make/unmakes internally for the +/# suffix.
    const san = moveToSan(this.board, move, legal);
    const movingColor = this.board.gameState.activeColor;

    this.previousEval = this._evalScore();
    this.board.makeMove(move.fromSquare, move.toSquare, move.promotionPiece);

    this.moveHistory.push({
      uci: move.algebraic, san,
      piece: move.piece, captured: move.capturedPiece, color: movingColor,
    });
    return move;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // State-derivation internals
  // ═══════════════════════════════════════════════════════════════════════
  _snapshotCounts() {
    const counts = [new Int8Array(6), new Int8Array(6)];
    for (const idx of [WHITE_IDX, BLACK_IDX]) {
      for (let p = PIECES.KING; p <= PIECES.PAWN; p++) {
        counts[idx][p] = this.board.bbPieces[idx][p].popCount();
      }
    }
    return counts;
  }

  /**
   * Captured pieces DERIVED from the board: initial count minus current count.
   * Derivation cannot drift, survives `undomove` for free, and is correct for
   * positions loaded mid-game from a FEN.
   */
  _capturedList(colorIdx) {
    const init = this.initialCounts[colorIdx];
    const bb = this.board.bbPieces[colorIdx];
    const out = [];

    // A promoted pawn shows up as a missing pawn plus a gained piece. Net
    // promotions must be subtracted from the pawn deficit.
    let promoted = 0;
    for (let p = PIECES.QUEEN; p <= PIECES.KNIGHT; p++) {
      const gain = bb[p].popCount() - init[p];
      if (gain > 0) promoted += gain;
    }

    for (let p = PIECES.QUEEN; p <= PIECES.KNIGHT; p++) {
      let missing = init[p] - bb[p].popCount();
      while (missing-- > 0) out.push(p);
    }

    let missingPawns = init[PIECES.PAWN] - bb[PIECES.PAWN].popCount() - promoted;
    while (missingPawns-- > 0) out.push(PIECES.PAWN);

    return out;
  }

  _capturedString(colorIdx) {
    const list = this._capturedList(colorIdx);
    return list.length === 0 ? 'none' : list.map(p => PIECE_CHARS[p].toLowerCase()).join('');
  }

  _evalScore() {
    // Always from white's perspective so successive values are comparable
    // (blunder detection diffs them across a turn change).
    return this.evaluator.evaluate(this.board, 'white').score;
  }

  _isInsufficientMaterial() {
    for (const idx of [WHITE_IDX, BLACK_IDX]) {
      if (this.board.bbPieces[idx][PIECES.PAWN].popCount()  > 0) return false;
      if (this.board.bbPieces[idx][PIECES.ROOK].popCount()  > 0) return false;
      if (this.board.bbPieces[idx][PIECES.QUEEN].popCount() > 0) return false;
    }
    const minors = idx => this.board.bbPieces[idx][PIECES.BISHOP].popCount() +
                          this.board.bbPieces[idx][PIECES.KNIGHT].popCount();
    return minors(WHITE_IDX) <= 1 && minors(BLACK_IDX) <= 1;
  }

  _countMaterial() {
    const total = idx => {
      let sum = 0;
      for (let p = PIECES.QUEEN; p <= PIECES.PAWN; p++) {
        sum += this.board.bbPieces[idx][p].popCount() * PIECE_VALUES[p];
      }
      return sum;
    };
    return { white: total(WHITE_IDX), black: total(BLACK_IDX) };
  }
}

export default UCIHandler;