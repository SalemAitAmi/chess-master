import { Board } from './core/board.js';
import { SearchEngine } from './search/search.js';
import { generateAllLegalMoves, isInCheck, hasLegalMoves } from './core/moveGeneration.js';
import { loadOpeningBook, lookupBookMove } from './book/openingBook.js';
import { DEFAULT_CONFIG, PIECES } from './core/constants.js';
import logger, { LOG_CATEGORY } from './logging/logger.js';

export class Engine {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.board  = new Board();
    this.search = new SearchEngine(this.config);
    if (this.config.useOpeningBook) loadOpeningBook();
  }

  setPosition(fen) { this.board = Board.fromFen(fen); }
  getPosition()    { return this.board.toFen(); }

  async findBestMove(depth = null) {
    const gameOver = this.isGameOver();
    if (gameOver.over) return null;
    const color = this.board.gameState.activeColor;
    const moves = generateAllLegalMoves(this.board, color);
    if (moves.length === 0) return null;
    if (this.config.useOpeningBook) {
      const bookMove = await lookupBookMove(this.board, moves);
      if (bookMove) return { move: bookMove, source: 'book' };
    }
    const searchDepth = depth || this.config.maxDepth;
    const result = this.search.search(this.board, searchDepth);
    return { move:result.bestMove, score:result.score, depth:result.depth,
             nodes:result.nodes, time:result.time, pv:result.pv, source:'search' };
  }

  makeMove(from, to, promo = null) { return this.board.makeMove(from, to, promo); }
  undoMove()                        { return this.board.undoMove(); }

  isGameOver() {
    const color = this.board.gameState.activeColor;
    if (!hasLegalMoves(this.board, color)) {
      if (isInCheck(this.board, color))
        return { over:true, result:'checkmate', winner: color==='white'?'black':'white' };
      return { over:true, result:'stalemate', winner:null };
    }
    if (this.board.gameState.halfMoveClock >= 100)
      return { over:true, result:'fifty-move', winner:null };
    if (this.board.isRepetition(3))
      return { over:true, result:'threefold', winner:null };
    if (this._isInsufficientMaterial())
      return { over:true, result:'insufficient_material', winner:null };
    return { over:false };
  }

  _isInsufficientMaterial() {
    const b = this.board;
    for (let idx=0;idx<2;idx++) {
      if (b.bbPieces[idx][PIECES.PAWN].popCount()>0)  return false;
      if (b.bbPieces[idx][PIECES.ROOK].popCount()>0)  return false;
      if (b.bbPieces[idx][PIECES.QUEEN].popCount()>0) return false;
    }
    const wM = b.bbPieces[0][PIECES.BISHOP].popCount()+b.bbPieces[0][PIECES.KNIGHT].popCount();
    const bM = b.bbPieces[1][PIECES.BISHOP].popCount()+b.bbPieces[1][PIECES.KNIGHT].popCount();
    return wM <= 1 && bM <= 1;
  }

  setOption(name, value) { this.config[name]=value; this.search.setOption(name,value); }
  setLogCategories(mask) { logger.setEnabledCategories(mask); }
  stop() { this.search.stop(); }
}

export { LOG_CATEGORY } from './logging/logger.js';
export default Engine;