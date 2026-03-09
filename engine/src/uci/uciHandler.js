/**
 * UCI protocol handler
 */

import { Board } from '../core/board.js';
import { SearchEngine } from '../search/search.js';
import { generateAllLegalMoves } from '../core/moveGeneration.js';
import { loadOpeningBook, lookupAllBookMoves, isBookLoaded, getBookStats } from '../book/openingBook.js';
import { squareToIndex } from '../core/bitboard.js';
import { PIECES, DEFAULT_CONFIG } from '../core/constants.js';
import logger, { LOG_CATEGORY } from '../logging/logger.js';
import { parseUCICommand } from './uciParser.js';
import { detectGameStage } from '../utils/gameStage.js';

export class UCIHandler {
  constructor() {
    this.board = new Board();
    this.engine = new SearchEngine(DEFAULT_CONFIG);
    this.debug = false;
    this.options = { ...DEFAULT_CONFIG };
    this.searching = false;

    // Book loading is handled by the module-level singleton in openingBook.js.
    // We store the ready promise so we can await it before lookups.
    this.bookReadyPromise = null;
    if (this.options.useOpeningBook) {
      this.bookReadyPromise = loadOpeningBook().then(bookInstance => {
        if (bookInstance) {
          const stats = getBookStats();
          logger.uci('info', stats, 'Opening book ready for handler');
        } else {
          logger.uci('warn', {}, 'Opening book not available for handler');
        }
        return bookInstance;
      }).catch(err => {
        logger.uci('warn', { error: err.message }, 'Opening book load failed in handler');
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
        break;
      case 'usecentercontrol':
        this.engine.setOption('useCenterControl', boolValue);
        break;
      case 'usedevelopment':
        this.engine.setOption('useDevelopment', boolValue);
        break;
      case 'usepawnstructure':
        this.engine.setOption('usePawnStructure', boolValue);
        break;
      case 'usekingsafety':
        this.engine.setOption('useKingSafety', boolValue);
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
    if (this.engine.tt) {
      this.engine.tt.clear();
    }

    // Start new game in logger
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

    this.board.makeMove(from, to, promotion);
  }

  async go(options) {
    if (this.searching) return null;
    this.searching = true;
    const responses = [];

    try {
      const legalMoves = generateAllLegalMoves(this.board, this.board.gameState.activeColor);
      if (legalMoves.length === 0) return 'bestmove (none)';

      // ── Gather book hints — passed to search, NOT returned directly ──
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

      // ── Search runs unconditionally. Book hints bias ordering only. ──
      const result = this.engine.search(this.board, depth, { bookHints });

      // Report book agreement — this is the diagnostic you wanted:
      // did search confirm or override the book's suggestion?
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