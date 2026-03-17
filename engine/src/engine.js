/**
 * Main engine orchestrator
 */

import { Board } from './core/board.js';
import { SearchEngine } from './search/search.js';
import { generateAllLegalMoves, isInCheck, hasLegalMoves } from './core/moveGeneration.js';
import { loadOpeningBook, lookupBookMove } from './book/openingBook.js';
import { DEFAULT_CONFIG } from './core/constants.js';
import logger, { LOG_CATEGORY } from './logging/logger.js';

export class Engine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.board = new Board();
    this.search = new SearchEngine(this.config);
    
    if (this.config.useOpeningBook) {
      loadOpeningBook();
    }
  }

  setPosition(fen) {
    this.board = Board.fromFen(fen);
  }

  getPosition() {
    return this.board.toFen();
  }

  async findBestMove(depth = null) {
    const color = this.board.gameState.activeColor;
    const moves = generateAllLegalMoves(this.board, color);
    
    if (moves.length === 0) {
      return null;
    }
    
    // Check opening book
    if (this.config.useOpeningBook) {
      const bookMove = await lookupBookMove(this.board, moves);
      if (bookMove) {
        return {
          move: bookMove,
          source: 'book'
        };
      }
    }
    
    // Search
    const searchDepth = depth || this.config.maxDepth;
    const result = this.search.search(this.board, searchDepth);
    
    return {
      move: result.bestMove,
      score: result.score,
      depth: result.depth,
      nodes: result.nodes,
      time: result.time,
      pv: result.pv,
      source: 'search'
    };
  }

  makeMove(fromSquare, toSquare, promotion = null) {
    return this.board.makeMove(fromSquare, toSquare, promotion);
  }

  undoMove() {
    return this.board.undoMove();
  }

  isGameOver() {
    const color = this.board.gameState.activeColor;

    if (!hasLegalMoves(this.board, color)) {
      if (isInCheck(this.board, color)) {
        return { over: true, result: 'checkmate', winner: color === 'white' ? 'black' : 'white' };
      }
      return { over: true, result: 'stalemate', winner: null };
    }

    if (this.board.gameState.halfMoveClock >= 100) {
      return { over: true, result: 'fifty-move', winner: null };
    }

    // Threefold — was missing. The board tracks this correctly via the
    // Zobrist undo stack (see board.countRepetitions), but nobody asked.
    // The search uses isRepetition(2) internally to score repeating lines
    // as draws, but game-termination needs the full threefold.
    if (this.board.isRepetition(3)) {
      return { over: true, result: 'threefold', winner: null };
    }

    return { over: false };
  }

  setOption(name, value) {
    this.config[name] = value;
    this.search.setOption(name, value);
  }

  setLogCategories(mask) {
    logger.setEnabledCategories(mask);
  }

  stop() {
    this.search.stop();
  }
}

export { LOG_CATEGORY } from './logging/logger.js';
export default Engine;