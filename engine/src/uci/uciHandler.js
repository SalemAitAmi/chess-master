/**
 * UCI protocol handler — the engine's sole public interface.
 *
 * Standard commands: uci, debug, isready, setoption, ucinewgame, position,
 * go, stop, quit.
 *
 * Extensions for interactive play (documented in UCI-Protocol-Specification.txt):
 *   validate <move>        → valid true|false [reason]
 *   legalmoves [square]    → legalmoves <uci>...|none
 *   makemove <move>        → <gamestate block> | error <reason>
 *   undomove               → <gamestate block> | error <reason>
 *   gamestate              → <gamestate block>
 *   eval                   → eval <cp>
 *   setlog <mask>          → info string ...
 *   clearlogs              → info string ...
 *   showstage              → info string ...
 *
 * Layout: imports → module constants → class (fields grouped in constructor,
 * methods grouped by concern).
 */
import { Board } from '../core/board.js';
import { SearchEngine } from '../search/search.js';
import { SmpCoordinator } from '../search/smpCoordinator.js';
import { generateAllLegalMoves, isInCheck } from '../core/moveGeneration.js';
import { loadOpeningBook, lookupAllBookMoves, isBookLoaded, getBookStats } from '../book/openingBook.js';
import { squareToIndex } from '../core/bitboard.js';
import { PIECES, PIECE_VALUES, PIECE_CHARS, WHITE_IDX, BLACK_IDX, DEFAULT_CONFIG } from '../core/constants.js';
import { TranspositionTable } from '../tables/transposition.js';
import { Evaluator } from '../evaluation/evaluate.js';
import { detectGameStage, getStagePriorities } from '../utils/gameStage.js';
import logger, { LOG, CAT } from '../logging/logger.js';
import { parseUCICommand } from './uciParser.js';
import { moveToSan } from './san.js';

// ═══════════════════════════════════════════════════════════════════════════
// Module constants
// ═══════════════════════════════════════════════════════════════════════════
const __LOG__ = globalThis.__LOG__ ?? true;

const PROMO_MAP = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };
const HISTORY_WINDOW = 20;
const BLUNDER_CP = 200;

const UCI_OPTIONS = [
  'option name Hash type spin default 64 min 1 max 1024',
  'option name Threads type spin default 1 min 1 max 64',
  'option name OwnBook type check default true',
  'option name MoveTime type spin default 30000 min 10 max 600000',
  'option name Contempt type spin default 50 min 0 max 200',
  'option name RepetitionMargin type spin default 90 min 0 max 500',
  'option name UseMaterial type check default true',
  'option name UseCenterControl type check default true',
  'option name UseDevelopment type check default true',
  'option name UsePawnStructure type check default true',
  'option name UseKingSafety type check default true',
  'option name UsePawnPush type check default true',
  'option name UseQuiescence type check default true',
  'option name UseKillerMoves type check default true',
  'option name UseHistoryHeuristic type check default true',
  'option name UseTranspositionTable type check default true',
  'option name UseNullMovePruning type check default true',
  'option name UseLateMovereduction type check default true',
  'option name UseSoftPinOrdering type check default true',
  'option name LogMask type spin default 0 min 0 max 4095',
];

// ═══════════════════════════════════════════════════════════════════════════
export class UCIHandler {
  constructor(config = {}) {
    // ── Configuration ──
    this.config = { ...DEFAULT_CONFIG, ...config };

    // ── Engine components ──
    this.board = new Board();
    this.engine = new SearchEngine(this.config);
    this.smp = new SmpCoordinator(this.config);
    // Separate evaluator for the `eval` command and blunder detection, so a
    // concurrent search can't see a half-reconfigured instance.
    this.evaluator = new Evaluator(this.config);

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
    const cmd = parseUCICommand(line);
    if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'cmd', { type: cmd.type, raw: line });

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

      default:
        if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'warn', { command: cmd.command, msg: 'Unknown command' });
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
      ...UCI_OPTIONS,
      '',
      'uciok',
    ].join('\n');
  }

  setDebug(on) { this.debug = on; return null; }
  isReady()    { return 'readyok'; }

  setOption(name, value) {
    const boolValue = value === 'true';
    const intValue = parseInt(value, 10);

    switch (name.toLowerCase()) {
      case 'hash':
        this._set('hashSizeMB', intValue);
        break;
      case 'threads':
        this._setThreads(intValue);
        break;
      case 'ownbook':
        this.config.useOpeningBook = boolValue;
        if (boolValue && this.bookReadyPromise === null) this._beginBookLoad();
        break;
      case 'movetime':
        this._set('maxSearchTime', intValue);
        break;
      case 'contempt':
        this._set('drawContemptMax', intValue);
        break;
      case 'repetitionmargin':
        this._set('repetitionMargin', intValue);
        break;
      case 'logmask':
        if (Number.isFinite(intValue)) logger.setMask(intValue);
        break;
      default: {
        // Map `UseFooBar` → config key `useFooBar` generically.
        const key = name.charAt(0).toLowerCase() + name.slice(1);
        if (key in this.config) this._set(key, boolValue);
        else if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'unknown-option', { name });
      }
    }
    return null;
  }

  newGame() {
    this.board = new Board();
    this.moveHistory = [];
    this.initialCounts = this._snapshotCounts();
    this.previousEval = 0;
    if (this.engine.tt !== null) this.engine.tt.clear();
    if (__LOG__) logger.startGame();
    return null;
  }

  position(fen, moves) {
    this.board = fen ? Board.fromFen(fen) : new Board();
    this.moveHistory = [];
    // Baseline for captured-piece derivation is whatever the supplied position
    // contains — mid-game FENs report captures relative to that position.
    this.initialCounts = this._snapshotCounts();
    this.previousEval = 0;

    for (const moveStr of moves) {
      if (this._applyMove(moveStr) === null) {
        if (__LOG__ && LOG.uci) logger.event(CAT.UCI, 'illegal-move', { moveStr, fen: this.board.toFen() });
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
      this._noteSmpIntent(responses);

      // `movetime` overrides the configured ceiling for this search only.
      // TODO: wtime/btime/movestogo are parsed but not used — there is no
      // clock manager yet. `infinite` and `nodes` are likewise accepted and
      // ignored; the depth/time ceiling always applies.
      const savedMaxTime = this.engine.config.maxSearchTime;
      if (options.movetime) this.engine.config.maxSearchTime = options.movetime;

      let result;
      try {
        // Single-threaded pipeline. SMP planning is deliberately not invoked here
        // (see smpCoordinator.js for the transition plan).
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
      // Every failure becomes `error <reason>`. The client distinguishes a
      // gamestate block from an error by this prefix.
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
    // No captured-piece bookkeeping: captures are derived from the board.
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

  _set(key, value) {
    this.config[key] = value;
    this.engine.setOption(key, value);
    this.evaluator = new Evaluator(this.config);
  }

  _setThreads(n) {
    const applied = this.smp.setThreadCount(n);
    this.config.threads = applied;
    this.engine.setOption('threads', applied);
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
        if (__LOG__ && LOG.uci) {
          logger.event(CAT.UCI, 'warn', { error: err.message, msg: 'Opening book load failed' });
        }
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
    const bestAlg = result.bestMove !== null ? result.bestMove.algebraic : '(none)';
    if (bookHints !== null && result.bestMove !== null) {
      const verdict = bookHints.has(bestAlg) ? 'confirmed' : 'OVERRIDDEN';
      responses.push(`info string Book ${verdict} (${bestAlg} cp=${result.score})`);
    }
    const pvStr = result.pv.length > 0 ? result.pv.map(m => m.algebraic).join(' ') : '';
    responses.push(
      `info depth ${result.depth} nodes ${result.nodes} time ${result.time} ` +
      `score cp ${result.score} pv ${pvStr}`
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

  /**
   * Apply a UCI move string. Returns the move object, or null if illegal.
   * Single implementation shared by `makemove` and `position ... moves`.
   */
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

    // SAN must be computed BEFORE the move (needs the sibling move list for
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