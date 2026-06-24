/**
 * UCI protocol handler - Extended for local play support
 */

import { Board } from '../core/board.js';
import { SearchEngine } from '../search/search.js';
import { generateAllLegalMoves, isInCheck } from '../core/moveGeneration.js';
import { loadOpeningBook, lookupAllBookMoves, isBookLoaded, getBookStats } from '../book/openingBook.js';
import { squareToIndex, indexToSquare } from '../core/bitboard.js';
import { PIECES, PIECE_VALUES, PIECE_CHARS, DEFAULT_CONFIG } from '../core/constants.js';
import logger, { LOG_CATEGORY } from '../logging/logger.js';
import { parseUCICommand } from './uciParser.js';
import { detectGameStage } from '../utils/gameStage.js';
import Evaluator from '../evaluation/evaluate.js';

export class UCIHandler {
  constructor() {
    this.board = new Board();
    this.engine = new SearchEngine(DEFAULT_CONFIG);
    this.evaluator = new Evaluator(DEFAULT_CONFIG); // Create evaluator instance
    this.debug = false;
    this.options = { ...DEFAULT_CONFIG };
    this.searching = false;

    // Move history for UI display (algebraic notation)
    this.moveHistory = [];
    // Captured pieces tracking
    this.capturedPieces = { white: [], black: [] };
    // Previous evaluation for blunder detection
    this.previousEval = 0;

    // Book loading
    this.bookReadyPromise = null;
    if (this.options.useOpeningBook) {
      this.bookReadyPromise = loadOpeningBook().then(bookInstance => {
        if (bookInstance) {
          const stats = getBookStats();
          logger.uci('info', stats, 'Opening book ready for handler');
        }
        return bookInstance;
      }).catch(err => {
        logger.uci('warn', { error: err.message }, 'Opening book load failed');
        return null;
      });
    }
  }

  async handleCommand(line) {
    const cmd = parseUCICommand(line);
    logger.uci('debug', { command: cmd.type, raw: line }, `UCI: ${cmd.type}`);

    switch (cmd.type) {
      case 'uci':
        return this.uci();
      case 'debug':
        return this.setDebug(cmd.on);
      case 'isready':
        return this.isReady();
      case 'setoption':
        return this.setOption(cmd.name, cmd.value);
      case 'ucinewgame':
        return this.newGame();
      case 'position':
        return this.position(cmd.fen, cmd.moves);
      case 'go':
        return await this.go(cmd);
      case 'stop':
        return this.stop();
      case 'quit':
        return this.quit();
        
      // Extended commands for local play
      case 'validate':
        return this.validateMove(cmd.move);
      case 'legalmoves':
        return this.getLegalMoves(cmd.square);
      case 'makemove':
        return this.makeMove(cmd.move);
      case 'undomove':
        return this.undoMove();
      case 'gamestate':
        return this.getGameState();
      case 'eval':
        return this.getEvaluation();
        
      // Existing custom extensions
      case 'setlog':
        return this.setLogMask(cmd.mask);
      case 'clearlogs':
        return this.clearLogs();
      case 'showstage':
        return this.showStage();
      case 'showdecision':
        return this.showLastDecision();
      case 'logstage':
        return this.setStageLogging(cmd.stage, cmd.enabled);
      default:
        logger.uci('warn', { command: cmd }, 'Unknown command');
        return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTENDED UCI COMMANDS FOR LOCAL PLAY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate a move without applying it
   * Command: validate e2e4
   * Response: valid true|false [reason]
   */
  validateMove(moveStr) {
    if (!moveStr || moveStr.length < 4) {
      return 'valid false invalid_format';
    }

    const from = squareToIndex(moveStr.slice(0, 2));
    const to = squareToIndex(moveStr.slice(2, 4));
    
    if (from === -1 || to === -1) {
      return 'valid false invalid_squares';
    }

    const legalMoves = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
    
    let promoChar = moveStr.length > 4 ? moveStr[4].toLowerCase() : null;
    const promoMap = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };
    
    const isLegal = legalMoves.some(m => {
      if (m.fromSquare !== from || m.toSquare !== to) return false;
      if (m.promotion) {
        return promoChar && promoMap[promoChar] === m.promotion;
      }
      return !promoChar;
    });

    if (isLegal) {
      // Check if this is a promotion move requiring piece selection
      const movingPiece = this.board.pieceList[from];
      const toRank = to >> 3;
      const needsPromotion = movingPiece === PIECES.PAWN && 
        ((this.board.gameState.activeColor === 'white' && toRank === 7) ||
         (this.board.gameState.activeColor === 'black' && toRank === 0));
      
      if (needsPromotion && !promoChar) {
        return 'valid true needs_promotion';
      }
      return 'valid true';
    }

    // Provide reason for invalid move
    const piece = this.board.pieceList[from];
    if (piece === PIECES.NONE) {
      return 'valid false no_piece';
    }
    
    const pieceColor = this.board.bbSide[0].getBit(from) ? 'white' : 'black';
    if (pieceColor !== this.board.gameState.activeColor) {
      return 'valid false wrong_color';
    }

    // Check if move would leave king in check
    return 'valid false illegal_move';
  }

  /**
   * Get all legal moves, optionally filtered by source square
   * Command: legalmoves [e2]
   * Response: legalmoves e2e3 e2e4 ... (or) legalmoves none
   */
  getLegalMoves(square = null) {
    const legalMoves = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
    
    let filteredMoves = legalMoves;
    if (square) {
      const fromIdx = squareToIndex(square);
      if (fromIdx === -1) {
        return 'legalmoves none invalid_square';
      }
      filteredMoves = legalMoves.filter(m => m.fromSquare === fromIdx);
    }

    if (filteredMoves.length === 0) {
      return 'legalmoves none';
    }

    const moveStrings = filteredMoves.map(m => m.algebraic);

    return 'legalmoves ' + moveStrings.join(' ');
  }

  /**
   * Apply a move and return the new game state
   * Command: makemove e2e4
   * Response: Multi-line game state (see getGameState)
   */
  makeMove(moveStr) {
    // First validate
    const validation = this.validateMove(moveStr);
    if (!validation.startsWith('valid true')) {
      return validation;
    }

    const from = squareToIndex(moveStr.slice(0, 2));
    const to = squareToIndex(moveStr.slice(2, 4));
    let promotion = null;

    if (moveStr.length > 4) {
      const promoChar = moveStr[4].toLowerCase();
      const promoMap = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };
      promotion = promoMap[promoChar];
    }

    // Track captured piece before move
    const capturedPiece = this.board.pieceList[to];
    const capturedColor = capturedPiece !== PIECES.NONE 
      ? (this.board.bbSide[0].getBit(to) ? 'white' : 'black')
      : null;

    // Store previous eval for blunder detection
    this.previousEval = this._getEvalScore();

    // Apply the move
    const movingPiece = this.board.pieceList[from];
    const movingColor = this.board.gameState.activeColor;
    
    this.board.makeMove(from, to, promotion);

    // Track captured piece
    if (capturedPiece !== PIECES.NONE) {
      this.capturedPieces[capturedColor].push(capturedPiece);
    }

    // Handle en passant capture tracking
    const lastUndo = this.board._undo[this.board._undoPly - 1];
    if (lastUndo && lastUndo.epCaptureSquare !== -1) {
      const epColor = movingColor === 'white' ? 'black' : 'white';
      this.capturedPieces[epColor].push(PIECES.PAWN);
    }

    // Add to move history
    this.moveHistory.push({
      move: moveStr,
      piece: movingPiece,
      captured: capturedPiece !== PIECES.NONE ? capturedPiece : null,
      color: movingColor
    });

    // Return full game state
    return this.getGameState();
  }

  /**
   * Undo the last move
   * Command: undomove
   * Response: Game state or error
   */
  undoMove() {
    if (this.board._undoPly === 0) {
      return 'error no_moves_to_undo';
    }

    // Get undo info before undoing
    const lastUndo = this.board._undo[this.board._undoPly - 1];
    
    // Restore captured pieces tracking
    if (lastUndo.capturedPiece !== PIECES.NONE) {
      const capturedColor = this.board.gameState.activeColor; // Current color made the capture
      const idx = this.capturedPieces[capturedColor].lastIndexOf(lastUndo.capturedPiece);
      if (idx !== -1) {
        this.capturedPieces[capturedColor].splice(idx, 1);
      }
    }

    // Handle en passant capture undo
    if (lastUndo.epCaptureSquare !== -1) {
      const capturedColor = this.board.gameState.activeColor === 'white' ? 'black' : 'white';
      const idx = this.capturedPieces[capturedColor].lastIndexOf(PIECES.PAWN);
      if (idx !== -1) {
        this.capturedPieces[capturedColor].splice(idx, 1);
      }
    }

    this.board.undoMove();
    this.moveHistory.pop();

    return this.getGameState();
  }

  /**
   * Get comprehensive game state for UI
   * Command: gamestate
   * Response: Multi-line key-value pairs
   */
  getGameState() {
    const gs = this.board.gameState;
    const legalMoves = generateAllLegalMoves(this.board, gs.activeColor);
    
    // Check detection using imported isInCheck
    const inCheck = isInCheck(this.board, gs.activeColor);
    
    // Game over detection
    let gameStatus = 'ongoing';
    let winner = null;
    
    if (legalMoves.length === 0) {
      if (inCheck) {
        gameStatus = 'checkmate';
        winner = gs.activeColor === 'white' ? 'black' : 'white';
      } else {
        gameStatus = 'stalemate';
        winner = 'draw';
      }
    } else if (gs.halfMoveClock >= 100) {
      gameStatus = 'fifty_move';
      winner = 'draw';
    } else if (this.board.isRepetition(3)) {
      gameStatus = 'threefold';
      winner = 'draw';
    } else if (this._isInsufficientMaterial()) {
      gameStatus = 'insufficient_material';
      winner = 'draw';
    }

    // Material counts
    const material = this._countMaterial();
    
    // Current evaluation
    const currentEval = this._getEvalScore();
    
    // Blunder detection (significant eval swing against the moving side)
    const evalDiff = currentEval - this.previousEval;
    const lastMoveColor = gs.activeColor === 'white' ? 'black' : 'white';
    const isBlunder = this.moveHistory.length > 0 && 
      ((lastMoveColor === 'white' && evalDiff < -200) ||
       (lastMoveColor === 'black' && evalDiff > 200));

    // Last move info
    const lastMove = this.moveHistory.length > 0 
      ? this.moveHistory[this.moveHistory.length - 1]
      : null;

    const response = [
      `fen ${this.board.toFen()}`,
      `turn ${gs.activeColor}`,
      `fullmove ${gs.fullMoveCount}`,
      `halfmove ${gs.halfMoveClock}`,
      `status ${gameStatus}`,
      `winner ${winner || 'none'}`,
      `incheck ${inCheck}`,
      `legalmovecount ${legalMoves.length}`,
      `eval ${currentEval}`,
      `material_white ${material.white}`,
      `material_black ${material.black}`,
      `material_diff ${material.white - material.black}`,
      `captured_white ${this._formatCapturedPieces('white')}`,
      `captured_black ${this._formatCapturedPieces('black')}`,
      `movecount ${this.moveHistory.length}`,
      `canundo ${this.board._undoPly > 0}`,
      `blunder ${isBlunder}`,
    ];

    if (lastMove) {
      response.push(`lastmove ${lastMove.move}`);
      response.push(`lastpiece ${PIECE_CHARS[lastMove.piece]}`);
      response.push(`lastcaptured ${lastMove.captured !== null ? PIECE_CHARS[lastMove.captured] : 'none'}`);
    }

    // Move history (last 20 moves for display)
    const historySlice = this.moveHistory.slice(-20);
    response.push(`history ${historySlice.map(m => m.move).join(' ') || 'none'}`);

    return response.join('\n');
  }

  /**
   * Get static evaluation
   * Command: eval
   * Response: eval <centipawns>
   */
  getEvaluation() {
    const score = this._getEvalScore();
    return `eval ${score}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get evaluation score using the Evaluator instance
   */
  _getEvalScore() {
    // Evaluate from white's perspective for consistency
    const result = this.evaluator.evaluate(this.board, 'white');
    return result.score;
  }

  _isInsufficientMaterial() {
    const w = 0, b = 1;
    
    // Any pawn/rook/queen = sufficient
    for (const idx of [w, b]) {
      if (this.board.bbPieces[idx][PIECES.PAWN].popCount() > 0) return false;
      if (this.board.bbPieces[idx][PIECES.ROOK].popCount() > 0) return false;
      if (this.board.bbPieces[idx][PIECES.QUEEN].popCount() > 0) return false;
    }
    
    const wMinor = this.board.bbPieces[w][PIECES.BISHOP].popCount() + 
                   this.board.bbPieces[w][PIECES.KNIGHT].popCount();
    const bMinor = this.board.bbPieces[b][PIECES.BISHOP].popCount() + 
                   this.board.bbPieces[b][PIECES.KNIGHT].popCount();
    
    return wMinor <= 1 && bMinor <= 1;
  }

  _countMaterial() {
    const count = { white: 0, black: 0 };
    
    for (const [color, idx] of [['white', 0], ['black', 1]]) {
      for (const [piece, value] of Object.entries(PIECE_VALUES)) {
        const pieceType = parseInt(piece);
        if (pieceType !== PIECES.KING) {
          count[color] += this.board.bbPieces[idx][pieceType].popCount() * value;
        }
      }
    }
    
    return count;
  }

  _formatCapturedPieces(color) {
    const pieces = this.capturedPieces[color];
    if (pieces.length === 0) return 'none';
    return pieces.map(p => PIECE_CHARS[p].toLowerCase()).join('');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXISTING UCI METHODS (unchanged)
  // ═══════════════════════════════════════════════════════════════════════════

  uci() {
    const response = [
      'id name ChessMaster Engine 1.0',
      'id author Chess Master',
      '',
      'option name Hash type spin default 64 min 1 max 1024',
      'option name OwnBook type check default true',
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
      'option name LogMask type spin default 0 min 0 max 1023',
      '',
      'uciok'
    ];

    logger.uci('info', {}, 'UCI initialized');
    return response.join('\n');
  }

  setDebug(on) {
    this.debug = on;
    logger.uci('info', { debug: on }, `Debug mode ${on ? 'enabled' : 'disabled'}`);
    return null;
  }

  isReady() {
    logger.uci('debug', {}, 'Ready check');
    return 'readyok';
  }

  setOption(name, value) {
    logger.uci('info', { name, value }, `Setting option: ${name}=${value}`);

    const boolValue = value === 'true';
    const intValue = parseInt(value);

    switch (name.toLowerCase()) {
      case 'hash':
        if (this.engine.tt) {
          this.engine.tt = new (this.engine.tt.constructor)(intValue);
        }
        break;
      case 'ownbook':
        this.options.useOpeningBook = boolValue;
        break;
      case 'usematerial':
        this.engine.setOption('useMaterial', boolValue);
        this.evaluator.setHeuristic('material', boolValue);
        break;
      case 'usecentercontrol':
        this.engine.setOption('useCenterControl', boolValue);
        this.evaluator.setHeuristic('centerControl', boolValue);
        break;
      case 'usedevelopment':
        this.engine.setOption('useDevelopment', boolValue);
        this.evaluator.setHeuristic('development', boolValue);
        break;
      case 'usepawnstructure':
        this.engine.setOption('usePawnStructure', boolValue);
        this.evaluator.setHeuristic('pawnStructure', boolValue);
        break;
      case 'usekingsafety':
        this.engine.setOption('useKingSafety', boolValue);
        this.evaluator.setHeuristic('kingSafety', boolValue);
        break;
      case 'usepawnpush':
        this.engine.setOption('usePawnPush', boolValue);
        break;
      case 'usequiescence':
        this.engine.setOption('useQuiescence', boolValue);
        break;
      case 'usekillermoves':
        this.engine.setOption('useKillerMoves', boolValue);
        break;
      case 'usehistoryheuristic':
        this.engine.setOption('useHistoryHeuristic', boolValue);
        break;
      case 'usetranspositiontable':
        this.engine.setOption('useTranspositionTable', boolValue);
        break;
      case 'usenullmovepruning':
        this.engine.setOption('useNullMovePruning', boolValue);
        break;
      case 'uselatemovereduction':
        this.engine.setOption('useLateMovereduction', boolValue);
        break;
      case 'logmask':
        logger.setEnabledCategories(intValue);
        break;
    }

    return null;
  }

  newGame() {
    this.board = new Board();
    this.moveHistory = [];
    this.capturedPieces = { white: [], black: [] };
    this.previousEval = 0;
    
    if (this.engine.tt) {
      this.engine.tt.clear();
    }

    logger.startNewGame();
    logger.uci('info', {}, 'New game started');
    return null;
  }

  position(fen, moves) {
    if (fen) {
      this.board = Board.fromFen(fen);
    } else {
      this.board = new Board();
    }

    // Reset tracking when position is set externally
    this.moveHistory = [];
    this.capturedPieces = { white: [], black: [] };

    for (const moveStr of moves) {
      this.applyMove(moveStr);
    }

    logger.uci('debug', { fen: this.board.toFen(), moveCount: moves.length }, 'Position set');
    return null;
  }

  applyMove(moveStr) {
    const from = squareToIndex(moveStr.slice(0, 2));
    const to = squareToIndex(moveStr.slice(2, 4));
    let promotion = null;

    if (moveStr.length > 4) {
      const promoChar = moveStr[4].toLowerCase();
      const promoMap = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };
      promotion = promoMap[promoChar];
    }

    // Track capture before move
    const capturedPiece = this.board.pieceList[to];
    if (capturedPiece !== PIECES.NONE) {
      const capturedColor = this.board.bbSide[0].getBit(to) ? 'white' : 'black';
      this.capturedPieces[capturedColor].push(capturedPiece);
    }

    const movingPiece = this.board.pieceList[from];
    const movingColor = this.board.gameState.activeColor;

    this.board.makeMove(from, to, promotion);

    this.moveHistory.push({
      move: moveStr,
      piece: movingPiece,
      captured: capturedPiece !== PIECES.NONE ? capturedPiece : null,
      color: movingColor
    });
  }

  async go(options) {
    if (this.searching) return null;
    this.searching = true;
    const responses = [];

    try {
      const legalMoves = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
      if (legalMoves.length === 0) return 'bestmove (none)';

      let bookHints = null;
      if (this.options.useOpeningBook) {
        if (this.bookReadyPromise) await this.bookReadyPromise;
        if (isBookLoaded()) {
          bookHints = lookupAllBookMoves(this.board, legalMoves);
          if (bookHints) {
            responses.push(`info string Book: ${bookHints.size} hint(s)`);
          }
        }
      }

      const depth = options.depth || this.options.maxDepth;
      const result = this.engine.search(this.board, depth, { bookHints });

      if (bookHints && result.bestMove) {
        const agreed = bookHints.has(result.bestMove.algebraic);
        responses.push(`info string Book ${agreed ? 'confirmed' : 'OVERRIDDEN'} ` +
                      `(${result.bestMove.algebraic} cp=${result.score})`);
      }

      const pvStr = result.pv?.map(m => m.algebraic).join(' ') || '';
      responses.push(
        `info depth ${result.depth} nodes ${result.nodes} time ${result.time} ` +
        `score cp ${result.score} pv ${pvStr}`
      );
      responses.push(`bestmove ${result.bestMove?.algebraic ?? '(none)'}`);

    } catch (err) {
      logger.uci('error', { error: err.message, stack: err.stack }, 'Search error');
      responses.push(`info string Error: ${err.message}`);
      responses.push('bestmove (none)');
    } finally {
      this.searching = false;
    }

    return responses.join('\n');
  }

  stop() {
    this.engine.stop();
    this.searching = false;
    logger.uci('info', {}, 'Search stopped');
    return null;
  }

  quit() {
    logger.uci('info', {}, 'Quitting');
    return 'quit';
  }

  setLogMask(mask) {
    logger.setEnabledCategories(mask);
    return `info string Log mask set to ${mask}`;
  }

  clearLogs() {
    logger.clearLogs();
    return 'info string Logs cleared';
  }

  showStage() {
    const stageInfo = detectGameStage(this.board);
    const response = [
      `info string Stage: ${stageInfo.stage}`,
      `info string Move: ${stageInfo.fullMoveNumber}`,
      `info string Phase: ${(stageInfo.phasePercent * 100).toFixed(1)}%`,
      `info string Priorities: ${stageInfo.priorities.join(', ')}`
    ];
    return response.join('\n');
  }

  showLastDecision() {
    return 'info string Last decision info not available';
  }

  setStageLogging(stage, enabled) {
    logger.uci('info', { stage, enabled }, `Stage logging ${enabled ? 'enabled' : 'disabled'} for ${stage}`);
    return `info string Stage logging updated for ${stage}`;
  }
}

export default UCIHandler;