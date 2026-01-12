import { Player } from './Player';
import { PIECES, PIECE_NAMES } from '../constants/gameConstants';
import { getValidMoves, simulateMove, isInCheck } from '../utils/chessLogic';
import { indexToRowCol, colorToIndex, rowColToIndex } from '../utils/bitboard';
import { boardToFen } from '../utils/chessUtils';
import { Polyglot } from 'cm-polyglot/src/Polyglot.js';

// =============================================================================
// DIFFICULTY CONFIGURATION - REBALANCED
// =============================================================================

export const DIFFICULTY = {
  ROOKIE: 1,
  CASUAL: 2,
  STRATEGIC: 3,
  MASTER: 4
};

const DIFFICULTY_CONFIG = {
  [DIFFICULTY.ROOKIE]: {
    name: 'Rookie',
    minDepth: 2,
    maxDepth: 4,
    maxTime: 10000,
    useQuiescence: true,
    quiescenceDepth: 2,
    useMoveOrdering: true,
    useKillerMoves: false,
    useHistoryHeuristic: false,
    useNullMovePruning: false,
    useLateMovereduction: false,
    useOpeningBook: false,
    useTranspositionTable: false,
    useAspirationWindows: false,
    useThreatDetection: false,
    useCenterControl: true,
    usePawnStructure: false,
    useKingSafety: false,
    useDevelopment: true,
    usePawnPushBonus: true,
    useMobility: false,
    useEndgame: false,
    usePieceActivity: false,
    blunderChance: 0.08,
    mistakeChance: 0.12,
    moveSelectionPool: 5,
    moveSelectionTemperature: 0.6,
    thinkingDelay: [200, 500]
  },
  [DIFFICULTY.CASUAL]: {
    name: 'Casual',
    minDepth: 4,
    maxDepth: 6,
    maxTime: 10000,
    useQuiescence: true,
    quiescenceDepth: 4,
    useMoveOrdering: true,
    useKillerMoves: true,
    useHistoryHeuristic: true,
    useNullMovePruning: false,
    useLateMovereduction: false,
    useOpeningBook: true,
    useTranspositionTable: true,
    useAspirationWindows: false,
    useThreatDetection: true,
    useCenterControl: true,
    usePawnStructure: true,
    useKingSafety: true,
    useDevelopment: true,
    usePawnPushBonus: true,
    useMobility: true,
    useEndgame: true,
    usePieceActivity: true,
    blunderChance: 0.02,
    mistakeChance: 0.05,
    moveSelectionPool: 3,
    moveSelectionTemperature: 0.3,
    thinkingDelay: [300, 800]
  },
  [DIFFICULTY.STRATEGIC]: {
    name: 'Strategic',
    minDepth: 5,
    maxDepth: 7,
    maxTime: 12000,
    useQuiescence: true,
    quiescenceDepth: 6,
    useMoveOrdering: true,
    useKillerMoves: true,
    useHistoryHeuristic: true,
    useNullMovePruning: true,
    useLateMovereduction: true,
    useOpeningBook: true,
    useTranspositionTable: true,
    useAspirationWindows: true,
    useThreatDetection: true,
    useCenterControl: true,
    usePawnStructure: true,
    useKingSafety: true,
    useDevelopment: true,
    usePawnPushBonus: true,
    useMobility: true,
    useEndgame: true,
    usePieceActivity: true,
    blunderChance: 0.0,
    mistakeChance: 0.01,
    moveSelectionPool: 2,
    moveSelectionTemperature: 0.1,
    thinkingDelay: [500, 1200]
  },
  [DIFFICULTY.MASTER]: {
    name: 'Master',
    minDepth: 6,
    maxDepth: 8,
    maxTime: 12000,
    useQuiescence: true,
    quiescenceDepth: 8,
    useMoveOrdering: true,
    useKillerMoves: true,
    useHistoryHeuristic: true,
    useNullMovePruning: true,
    useLateMovereduction: true,
    useOpeningBook: true,
    useTranspositionTable: true,
    useAspirationWindows: true,
    useThreatDetection: true,
    useCenterControl: true,
    usePawnStructure: true,
    useKingSafety: true,
    useDevelopment: true,
    usePawnPushBonus: true,
    useMobility: true,
    useEndgame: true,
    usePieceActivity: true,
    blunderChance: 0.0,
    mistakeChance: 0.0,
    moveSelectionPool: 1,
    moveSelectionTemperature: 0.0,
    thinkingDelay: [600, 1500]
  }
};

// =============================================================================
// TRANSPOSITION TABLE
// =============================================================================

const TT_EXACT = 0;
const TT_LOWERBOUND = 1;
const TT_UPPERBOUND = 2;

class TranspositionTable {
  constructor(maxSize = 500000) {
    this.maxSize = maxSize;
    this.table = new Map();
    this.hits = 0;
    this.stores = 0;
    this.collisions = 0;
  }

  generateKey(board) {
    return board.gameState.zobrist_key;
  }

  probe(board, depth, alpha, beta) {
    const key = this.generateKey(board);
    const entry = this.table.get(key);
    
    if (!entry) return null;
    
    if (entry.depth >= depth) {
      this.hits++;
      
      if (entry.flag === TT_EXACT) {
        return { score: entry.score, move: entry.bestMove, type: 'exact' };
      } else if (entry.flag === TT_LOWERBOUND && entry.score >= beta) {
        return { score: entry.score, move: entry.bestMove, type: 'lowerbound' };
      } else if (entry.flag === TT_UPPERBOUND && entry.score <= alpha) {
        return { score: entry.score, move: entry.bestMove, type: 'upperbound' };
      }
    }
    
    if (entry.bestMove) {
      return { move: entry.bestMove, type: 'hashmove' };
    }
    
    return null;
  }

  store(board, depth, score, flag, bestMove) {
    const key = this.generateKey(board);
    
    const existing = this.table.get(key);
    if (existing && existing.depth > depth) {
      return;
    }
    
    if (existing) this.collisions++;
    
    if (this.table.size >= this.maxSize) {
      const keysToDelete = [];
      let count = 0;
      for (const k of this.table.keys()) {
        if (count++ > this.maxSize * 0.2) break;
        keysToDelete.push(k);
      }
      keysToDelete.forEach(k => this.table.delete(k));
    }
    
    this.table.set(key, {
      depth,
      score,
      flag,
      bestMove: bestMove ? { ...bestMove } : null
    });
    this.stores++;
  }

  clear() {
    this.table.clear();
    this.hits = 0;
    this.stores = 0;
    this.collisions = 0;
  }

  getStats() {
    return {
      size: this.table.size,
      hits: this.hits,
      stores: this.stores,
      collisions: this.collisions,
      hitRate: this.stores > 0 ? (this.hits / this.stores * 100).toFixed(1) + '%' : '0%'
    };
  }
}

// =============================================================================
// DECISION REPORT
// =============================================================================

class DecisionReport {
  constructor() {
    this.reset();
  }

  reset() {
    this.timestamp = new Date().toISOString();
    this.botColor = null;
    this.difficulty = null;
    this.fen = null;
    this.moveNumber = 0;
    this.halfMoveClock = 0;
    this.legalMoves = [];
    this.openingBookAttempt = { tried: false, found: false, move: null, integratedIntoSearch: false };
    this.searchStats = {
      positionsEvaluated: 0,
      maxDepthReached: 0,
      timeSpentMs: 0,
      nodesPerSecond: 0,
      transpositionTableHits: 0,
      transpositionTableStores: 0,
      transpositionTableHitRate: '0%',
      aspirationWindowReSearches: 0,
      quiescenceNodes: 0,
      cutoffs: 0,
      searchType: 'normal',
      completedDepth: 0,
      wasTimeout: false
    };
    this.moveEvaluations = [];
    this.selectedMove = null;
    this.selectedMoveScore = null;
    this.selectedMoveRank = null;
    this.imperfectionApplied = { type: null, originalMove: null, originalRank: null };
    this.finalMove = null;
    this.threatInfo = { threatsDetected: 0, hangingPieces: [], attackedPieces: [] };
    this.drawInfo = { 
      fiftyMoveCounter: 0, 
      repetitionCount: 0, 
      isDrawPosition: false,
      drawReason: null
    };
    this.contentionInfo = {
      isContentious: false,
      scoreGap: 0,
      topMovesScoreDiff: 0,
      alternativesConsidered: 0
    };
  }

  addMoveEvaluation(move, score, breakdown, rank = null) {
    this.moveEvaluations.push({
      move: this.formatMove(move),
      score,
      breakdown: { ...breakdown },
      rank
    });
  }

  formatMove(move) {
    if (!move) return null;
    const files = 'abcdefgh';
    const fromSquare = `${files[move.from[1]]}${8 - move.from[0]}`;
    const toSquare = `${files[move.to[1]]}${8 - move.to[0]}`;
    const pieceType = move.piece !== undefined ? PIECE_NAMES[move.piece] : 'Unknown';
    const capture = move.capturedPiece !== null && move.capturedPiece !== undefined 
      ? ` x ${PIECE_NAMES[move.capturedPiece]}` 
      : '';
    return {
      algebraic: `${fromSquare}${toSquare}`,
      from: fromSquare,
      to: toSquare,
      piece: pieceType,
      capture: capture,
      isPromotion: move.isPromotion || false,
      capturedPiece: move.capturedPiece !== null && move.capturedPiece !== undefined 
        ? PIECE_NAMES[move.capturedPiece] 
        : null
    };
  }

  generateReport() {
    const sortedMoves = [...this.moveEvaluations].sort((a, b) => b.score - a.score);
    sortedMoves.forEach((m, idx) => m.rank = idx);
    
    if (sortedMoves.length >= 2) {
      const topScore = sortedMoves[0].score;
      const secondScore = sortedMoves[1].score;
      this.contentionInfo.topMovesScoreDiff = topScore - secondScore;
      this.contentionInfo.isContentious = this.contentionInfo.topMovesScoreDiff < 30;
      this.contentionInfo.alternativesConsidered = sortedMoves.filter(m => 
        topScore - m.score < 50
      ).length;
    }
    
    if (this.selectedMoveRank !== null && this.selectedMoveRank > 0 && sortedMoves.length > 0) {
      this.contentionInfo.scoreGap = sortedMoves[0].score - (sortedMoves[this.selectedMoveRank]?.score || 0);
    }
    
    return {
      meta: {
        timestamp: this.timestamp,
        botColor: this.botColor,
        difficulty: this.difficulty,
        moveNumber: this.moveNumber,
        halfMoveClock: this.halfMoveClock,
        fen: this.fen
      },
      openingBook: this.openingBookAttempt,
      searchStats: this.searchStats,
      threatInfo: this.threatInfo,
      drawInfo: this.drawInfo,
      contentionInfo: this.contentionInfo,
      moveAnalysis: {
        totalLegalMoves: this.legalMoves.length,
        movesEvaluated: sortedMoves.length,
        topMoves: sortedMoves.slice(0, 10),
        allMoves: sortedMoves
      },
      decision: {
        selectedMove: this.selectedMove,
        selectedScore: this.selectedMoveScore,
        selectedRank: this.selectedMoveRank,
        imperfection: this.imperfectionApplied,
        finalMove: this.finalMove
      }
    };
  }

  toJSON() {
    return JSON.stringify(this.generateReport(), null, 2);
  }

  toText() {
    const report = this.generateReport();
    let text = '';
    
    text += '═'.repeat(80) + '\n';
    text += `BOT DECISION REPORT - Move #${report.meta.moveNumber}\n`;
    text += '═'.repeat(80) + '\n\n';
    
    text += `Timestamp: ${report.meta.timestamp}\n`;
    text += `Bot Color: ${report.meta.botColor}\n`;
    text += `Difficulty: ${report.meta.difficulty}\n`;
    text += `Half-Move Clock: ${report.meta.halfMoveClock}\n`;
    text += `FEN: ${report.meta.fen}\n\n`;
    
    text += '─'.repeat(40) + '\n';
    text += 'SEARCH STATISTICS\n';
    text += '─'.repeat(40) + '\n';
    text += `Search Type: ${report.searchStats.searchType}\n`;
    text += `Completed Depth: ${report.searchStats.completedDepth}\n`;
    text += `Was Timeout: ${report.searchStats.wasTimeout}\n`;
    text += `Positions Evaluated: ${report.searchStats.positionsEvaluated.toLocaleString()}\n`;
    text += `Time Spent: ${report.searchStats.timeSpentMs}ms\n`;
    text += '\n';
    
    text += '─'.repeat(40) + '\n';
    text += 'FINAL DECISION\n';
    text += '─'.repeat(40) + '\n';
    if (report.decision.selectedMove) {
      text += `Selected: ${report.decision.selectedMove.piece} ${report.decision.selectedMove.algebraic}\n`;
      text += `Score: ${report.decision.selectedScore}\n`;
      text += `Rank: ${report.decision.selectedRank}\n`;
    }
    
    text += '\n' + '═'.repeat(80) + '\n';
    
    return text;
  }
}

// Global report storage
let latestReport = null;
let reportHistory = [];
const MAX_REPORT_HISTORY = 2000;

// Abort signal for stopping search
let searchAbortController = null;

export function getLatestReport() {
  return latestReport;
}

export function getReportHistory() {
  return [...reportHistory];
}

export function clearReportHistory() {
  reportHistory = [];
  latestReport = null;
}

export function abortSearch() {
  if (searchAbortController) {
    searchAbortController.abort = true;
  }
}

export function downloadReport(format = 'json') {
  if (!latestReport) return null;
  
  const content = format === 'json' ? latestReport.toJSON() : latestReport.toText();
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `bot-decision-${latestReport.timestamp.replace(/[:.]/g, '-')}.${format === 'json' ? 'json' : 'txt'}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  return true;
}

export function downloadAllReports(format = 'json') {
  if (reportHistory.length === 0) return null;
  
  const sortedReports = [...reportHistory].sort((a, b) => {
    const aReport = a.generateReport();
    const bReport = b.generateReport();
    const timeCompare = new Date(aReport.meta.timestamp) - new Date(bReport.meta.timestamp);
    if (timeCompare !== 0) return timeCompare;
    return aReport.meta.moveNumber - bReport.meta.moveNumber;
  });
  
  let content;
  if (format === 'json') {
    content = JSON.stringify(sortedReports.map(r => r.generateReport()), null, 2);
  } else {
    content = sortedReports.map(r => r.toText()).join('\n\n');
  }
  
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `bot-decisions-all.${format === 'json' ? 'json' : 'txt'}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  return true;
}

// =============================================================================
// EVALUATION HEURISTICS - PROPERLY BALANCED
// =============================================================================

class EvaluationHeuristic {
  constructor(name, weight = 1.0) {
    this.name = name;
    this.weight = weight;
    this.enabled = true;
    this.lastScore = 0;
  }

  evaluate(board, color, context) {
    throw new Error('evaluate() must be implemented by subclass');
  }

  getLastScore() {
    return this.lastScore;
  }
}

/**
 * Material evaluation - THE PRIMARY HEURISTIC
 * Should contribute ~50-60% of evaluation in middlegame
 */
class MaterialHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('Material', weight);
    this.pieceValues = {
      [PIECES.PAWN]: 100,
      [PIECES.KNIGHT]: 320,
      [PIECES.BISHOP]: 330,
      [PIECES.ROOK]: 500,
      [PIECES.QUEEN]: 900,
      [PIECES.KING]: 0
    };
  }

  evaluate(board, color, context) {
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let score = 0;
    
    for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
      const ourCount = board.bbPieces[colorIdx][piece].popCount();
      const theirCount = board.bbPieces[oppositeColorIdx][piece].popCount();
      score += (ourCount - theirCount) * this.pieceValues[piece];
    }
    
    this.lastScore = score * this.weight;
    return this.lastScore;
  }
}

/**
 * Piece-Square Tables for positional evaluation
 */
class PieceActivityHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('PieceActivity', weight);
    
    // Piece-square tables (from white's perspective, index 0 = a1)
    this.pawnTable = [
       0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
       5,  5, 10, 25, 25, 10,  5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5, -5,-10,  0,  0,-10, -5,  5,
       5, 10, 10,-20,-20, 10, 10,  5,
       0,  0,  0,  0,  0,  0,  0,  0
    ];
    
    this.knightTable = [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50
    ];
    
    this.bishopTable = [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20
    ];
    
    this.rookTable = [
       0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       0,  0,  0,  5,  5,  0,  0,  0
    ];
    
    this.queenTable = [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20
    ];
    
    this.kingMiddlegameTable = [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20
    ];
    
    this.kingEndgameTable = [
      -50,-40,-30,-20,-20,-30,-40,-50,
      -30,-20,-10,  0,  0,-10,-20,-30,
      -30,-10, 20, 30, 30, 20,-10,-30,
      -30,-10, 30, 40, 40, 30,-10,-30,
      -30,-10, 30, 40, 40, 30,-10,-30,
      -30,-10, 20, 30, 30, 20,-10,-30,
      -30,-30,  0,  0,  0,  0,-30,-30,
      -50,-30,-30,-30,-30,-30,-30,-50
    ];
  }

  evaluate(board, color, context) {
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let score = 0;
    
    score += this.evaluatePiecePositions(board, color, colorIdx, context);
    score -= this.evaluatePiecePositions(board, color === 'white' ? 'black' : 'white', oppositeColorIdx, context);
    
    this.lastScore = score * this.weight * 0.15; // Scale down PST contribution
    return this.lastScore;
  }

  evaluatePiecePositions(board, color, colorIdx, context) {
    let score = 0;
    const isWhite = color === 'white';
    
    // Pawns
    const pawns = board.bbPieces[colorIdx][PIECES.PAWN].clone();
    while (!pawns.isEmpty()) {
      const sq = pawns.popLSB();
      const tableIdx = isWhite ? (7 - Math.floor(sq / 8)) * 8 + (sq % 8) : sq;
      score += this.pawnTable[tableIdx];
    }
    
    // Knights
    const knights = board.bbPieces[colorIdx][PIECES.KNIGHT].clone();
    while (!knights.isEmpty()) {
      const sq = knights.popLSB();
      const tableIdx = isWhite ? (7 - Math.floor(sq / 8)) * 8 + (sq % 8) : sq;
      score += this.knightTable[tableIdx];
    }
    
    // Bishops
    const bishops = board.bbPieces[colorIdx][PIECES.BISHOP].clone();
    while (!bishops.isEmpty()) {
      const sq = bishops.popLSB();
      const tableIdx = isWhite ? (7 - Math.floor(sq / 8)) * 8 + (sq % 8) : sq;
      score += this.bishopTable[tableIdx];
    }
    
    // Rooks
    const rooks = board.bbPieces[colorIdx][PIECES.ROOK].clone();
    while (!rooks.isEmpty()) {
      const sq = rooks.popLSB();
      const tableIdx = isWhite ? (7 - Math.floor(sq / 8)) * 8 + (sq % 8) : sq;
      score += this.rookTable[tableIdx];
    }
    
    // Queens
    const queens = board.bbPieces[colorIdx][PIECES.QUEEN].clone();
    while (!queens.isEmpty()) {
      const sq = queens.popLSB();
      const tableIdx = isWhite ? (7 - Math.floor(sq / 8)) * 8 + (sq % 8) : sq;
      score += this.queenTable[tableIdx];
    }
    
    // King
    const king = board.bbPieces[colorIdx][PIECES.KING].clone();
    if (!king.isEmpty()) {
      const sq = king.getLSB();
      const tableIdx = isWhite ? (7 - Math.floor(sq / 8)) * 8 + (sq % 8) : sq;
      const kingTable = context.endgameWeight > 0.5 ? this.kingEndgameTable : this.kingMiddlegameTable;
      score += kingTable[tableIdx];
    }
    
    return score;
  }
}

/**
 * Center control
 */
class CenterControlHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('CenterControl', weight);
    this.centerSquares = [
      rowColToIndex(3, 3), rowColToIndex(3, 4),
      rowColToIndex(4, 3), rowColToIndex(4, 4)
    ];
  }

  evaluate(board, color, context) {
    // Less important in endgame
    if (context.endgameWeight > 0.6) {
      this.lastScore = 0;
      return 0;
    }
    
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let score = 0;
    
    for (const sq of this.centerSquares) {
      if (board.bbSide[colorIdx].getBit(sq)) {
        const piece = board.pieceList[sq];
        if (piece === PIECES.PAWN) score += 20;
        else if (piece === PIECES.KNIGHT) score += 15;
        else if (piece === PIECES.BISHOP) score += 10;
      }
      if (board.bbSide[oppositeColorIdx].getBit(sq)) {
        const piece = board.pieceList[sq];
        if (piece === PIECES.PAWN) score -= 20;
        else if (piece === PIECES.KNIGHT) score -= 15;
        else if (piece === PIECES.BISHOP) score -= 10;
      }
    }
    
    this.lastScore = score * this.weight * 0.3;
    return this.lastScore;
  }
}

/**
 * Development heuristic
 */
class DevelopmentHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('Development', weight);
  }

  evaluate(board, color, context) {
    if (context.moveCount > 20) {
      this.lastScore = 0;
      return 0;
    }
    
    const colorIdx = colorToIndex(color);
    const backRank = color === 'white' ? 7 : 0;
    
    let score = 0;
    
    // Penalty for undeveloped minor pieces
    const knightStarts = color === 'white' 
      ? [rowColToIndex(7, 1), rowColToIndex(7, 6)]
      : [rowColToIndex(0, 1), rowColToIndex(0, 6)];
    
    for (const sq of knightStarts) {
      if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq)) {
        score -= 15;
      }
    }
    
    const bishopStarts = color === 'white'
      ? [rowColToIndex(7, 2), rowColToIndex(7, 5)]
      : [rowColToIndex(0, 2), rowColToIndex(0, 5)];
    
    for (const sq of bishopStarts) {
      if (board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) {
        score -= 15;
      }
    }
    
    // Castling bonus
    const kingBB = board.bbPieces[colorIdx][PIECES.KING];
    const kingSquare = kingBB.getLSB();
    if (kingSquare !== -1) {
      const [kingRow, kingCol] = indexToRowCol(kingSquare);
      if (kingRow === backRank && (kingCol === 6 || kingCol === 2)) {
        score += 25;
      }
    }
    
    const scaleFactor = Math.max(0, 1 - context.moveCount / 20);
    this.lastScore = score * this.weight * scaleFactor * 0.5;
    return this.lastScore;
  }
}

/**
 * Pawn structure
 */
class PawnStructureHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('PawnStructure', weight);
  }

  evaluate(board, color, context) {
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let score = 0;
    score += this.analyzePawnStructure(board, color, colorIdx, oppositeColorIdx);
    score -= this.analyzePawnStructure(board, color === 'white' ? 'black' : 'white', oppositeColorIdx, colorIdx);
    
    this.lastScore = score * this.weight * 0.3;
    return this.lastScore;
  }

  analyzePawnStructure(board, color, colorIdx, oppositeColorIdx) {
    let score = 0;
    const pawnBB = board.bbPieces[colorIdx][PIECES.PAWN].clone();
    const pawnFiles = new Array(8).fill(0);
    const pawnPositions = [];
    
    const tempBB = pawnBB.clone();
    while (!tempBB.isEmpty()) {
      const square = tempBB.popLSB();
      const [row, col] = indexToRowCol(square);
      pawnFiles[col]++;
      pawnPositions.push({ row, col, square });
    }
    
    for (const pawn of pawnPositions) {
      // Doubled pawns
      if (pawnFiles[pawn.col] > 1) score -= 10;
      
      // Isolated pawns
      const hasLeftNeighbor = pawn.col > 0 && pawnFiles[pawn.col - 1] > 0;
      const hasRightNeighbor = pawn.col < 7 && pawnFiles[pawn.col + 1] > 0;
      if (!hasLeftNeighbor && !hasRightNeighbor) {
        score -= 12;
      } else {
        score += 5; // Connected
      }
      
      // Passed pawns
      if (this.isPassedPawn(board, pawn, color, oppositeColorIdx)) {
        const advancement = color === 'white' ? 7 - pawn.row : pawn.row;
        score += [0, 10, 15, 25, 40, 60, 90, 0][advancement];
      }
    }
    
    return score;
  }

  isPassedPawn(board, pawn, color, oppositeColorIdx) {
    const direction = color === 'white' ? -1 : 1;
    const endRow = color === 'white' ? 0 : 7;
    
    for (let col = Math.max(0, pawn.col - 1); col <= Math.min(7, pawn.col + 1); col++) {
      let row = pawn.row + direction;
      while ((color === 'white' && row >= endRow) || (color === 'black' && row <= endRow)) {
        if (board.bbPieces[oppositeColorIdx][PIECES.PAWN].getBit(rowColToIndex(row, col))) {
          return false;
        }
        row += direction;
      }
    }
    return true;
  }
}

/**
 * King safety
 */
class KingSafetyHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('KingSafety', weight);
  }

  evaluate(board, color, context) {
    // Less important in endgame
    const safetyWeight = Math.max(0.2, 1 - context.endgameWeight);
    
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let score = 0;
    score += this.evaluateKingSafety(board, color, colorIdx);
    score -= this.evaluateKingSafety(board, color === 'white' ? 'black' : 'white', oppositeColorIdx);
    
    this.lastScore = score * this.weight * safetyWeight * 0.3;
    return this.lastScore;
  }

  evaluateKingSafety(board, color, colorIdx) {
    const kingBB = board.bbPieces[colorIdx][PIECES.KING];
    const kingSquare = kingBB.getLSB();
    if (kingSquare === -1) return 0;
    
    const [kingRow, kingCol] = indexToRowCol(kingSquare);
    let safety = 0;
    
    const backRank = color === 'white' ? 7 : 0;
    const pawnRank = color === 'white' ? 6 : 1;
    
    // Pawn shield
    if (kingRow === backRank && (kingCol <= 2 || kingCol >= 5)) {
      for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
        if (board.bbPieces[colorIdx][PIECES.PAWN].getBit(rowColToIndex(pawnRank, col))) {
          safety += 10;
        }
      }
    }
    
    return safety;
  }
}

/**
 * Mobility
 */
class MobilityHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('Mobility', weight);
  }

  evaluate(board, color, context) {
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let ourMobility = 0;
    let theirMobility = 0;
    
    // Only count minor pieces and rooks for efficiency
    for (let pieceType of [PIECES.KNIGHT, PIECES.BISHOP, PIECES.ROOK]) {
      const ourPieces = board.bbPieces[colorIdx][pieceType].clone();
      while (!ourPieces.isEmpty()) {
        const sq = ourPieces.popLSB();
        const [row, col] = indexToRowCol(sq);
        ourMobility += getValidMoves(row, col, board, false).length;
      }
      
      const theirPieces = board.bbPieces[oppositeColorIdx][pieceType].clone();
      while (!theirPieces.isEmpty()) {
        const sq = theirPieces.popLSB();
        const [row, col] = indexToRowCol(sq);
        theirMobility += getValidMoves(row, col, board, false).length;
      }
    }
    
    this.lastScore = (ourMobility - theirMobility) * this.weight * 0.15;
    return this.lastScore;
  }
}

/**
 * Threat detection - PROPERLY SCALED
 */
class ThreatDetectionHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('ThreatDetection', weight);
    this.hangingPieces = [];
    this.attackedPieces = [];
    this.evaluatingColor = null;
  }

  evaluate(board, color, context) {
    this.hangingPieces = [];
    this.attackedPieces = [];
    this.evaluatingColor = color;
    
    const colorIdx = colorToIndex(color);
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const oppositeColorIdx = colorToIndex(oppositeColor);
    
    let score = 0;
    
    // Penalty for our hanging pieces (scaled down significantly)
    score -= this.evaluateHangingPieces(board, color, colorIdx, oppositeColorIdx) * 0.15;
    
    // Small bonus for attacking opponent's pieces
    score += this.evaluateHangingPieces(board, oppositeColor, oppositeColorIdx, colorIdx) * 0.05;
    
    this.lastScore = score * this.weight;
    return this.lastScore;
  }

  evaluateHangingPieces(board, color, colorIdx, attackerColorIdx) {
    let penalty = 0;
    const pieceValues = {
      [PIECES.PAWN]: 100,
      [PIECES.KNIGHT]: 320,
      [PIECES.BISHOP]: 330,
      [PIECES.ROOK]: 500,
      [PIECES.QUEEN]: 900
    };
    
    for (let pieceType of [PIECES.QUEEN, PIECES.ROOK, PIECES.BISHOP, PIECES.KNIGHT, PIECES.PAWN]) {
      const pieces = board.bbPieces[colorIdx][pieceType].clone();
      while (!pieces.isEmpty()) {
        const sq = pieces.popLSB();
        const [row, col] = indexToRowCol(sq);
        
        if (this.isSquareAttacked(board, row, col, attackerColorIdx)) {
          const isDefended = this.isSquareDefended(board, row, col, colorIdx);
          const squareName = `${String.fromCharCode('a'.charCodeAt(0) + col)}${8 - row}`;
          
          if (!isDefended) {
            penalty += pieceValues[pieceType];
            if (color === this.evaluatingColor) {
              this.hangingPieces.push(`${PIECE_NAMES[pieceType]} at ${squareName}`);
            }
          } else {
            if (color === this.evaluatingColor) {
              this.attackedPieces.push(`${PIECE_NAMES[pieceType]} at ${squareName}`);
            }
          }
        }
      }
    }
    
    return penalty;
  }

  isSquareAttacked(board, row, col, attackerColorIdx) {
    // Pawn attacks
    const pawnDir = attackerColorIdx === 0 ? 1 : -1;
    for (const dc of [-1, 1]) {
      const fromRow = row + pawnDir;
      const fromCol = col + dc;
      if (fromRow >= 0 && fromRow < 8 && fromCol >= 0 && fromCol < 8) {
        if (board.bbPieces[attackerColorIdx][PIECES.PAWN].getBit(rowColToIndex(fromRow, fromCol))) {
          return true;
        }
      }
    }
    
    // Knight attacks
    const knightMoves = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
    for (const [dr, dc] of knightMoves) {
      const fromRow = row + dr;
      const fromCol = col + dc;
      if (fromRow >= 0 && fromRow < 8 && fromCol >= 0 && fromCol < 8) {
        if (board.bbPieces[attackerColorIdx][PIECES.KNIGHT].getBit(rowColToIndex(fromRow, fromCol))) {
          return true;
        }
      }
    }
    
    // Sliding attacks (simplified)
    const diagonalDirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dr, dc] of diagonalDirs) {
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const checkSq = rowColToIndex(r, c);
        if (board.bbSide[0].getBit(checkSq) || board.bbSide[1].getBit(checkSq)) {
          if (board.bbPieces[attackerColorIdx][PIECES.BISHOP].getBit(checkSq) ||
              board.bbPieces[attackerColorIdx][PIECES.QUEEN].getBit(checkSq)) {
            return true;
          }
          break;
        }
        r += dr; c += dc;
      }
    }
    
    const straightDirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr, dc] of straightDirs) {
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const checkSq = rowColToIndex(r, c);
        if (board.bbSide[0].getBit(checkSq) || board.bbSide[1].getBit(checkSq)) {
          if (board.bbPieces[attackerColorIdx][PIECES.ROOK].getBit(checkSq) ||
              board.bbPieces[attackerColorIdx][PIECES.QUEEN].getBit(checkSq)) {
            return true;
          }
          break;
        }
        r += dr; c += dc;
      }
    }
    
    return false;
  }

  isSquareDefended(board, row, col, defenderColorIdx) {
    return this.isSquareAttacked(board, row, col, defenderColorIdx);
  }

  getThreats() {
    return { hanging: [...this.hangingPieces], attacked: [...this.attackedPieces] };
  }
}

/**
 * Endgame heuristic - SIGNIFICANTLY IMPROVED
 */
class EndgameHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('Endgame', weight);
  }

  evaluate(board, color, context) {
    if (context.endgameWeight < 0.3) {
      this.lastScore = 0;
      return 0;
    }
    
    const colorIdx = colorToIndex(color);
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const oppositeColorIdx = colorToIndex(oppositeColor);
    
    let score = 0;
    
    // King activity is CRUCIAL in endgame
    score += this.evaluateKingActivity(board, color, colorIdx, context) * 2;
    score -= this.evaluateKingActivity(board, oppositeColor, oppositeColorIdx, context) * 2;
    
    // Passed pawn advancement
    score += this.evaluatePassedPawns(board, color, colorIdx, oppositeColorIdx);
    score -= this.evaluatePassedPawns(board, oppositeColor, oppositeColorIdx, colorIdx);
    
    // Rook activity
    score += this.evaluateRookActivity(board, color, colorIdx);
    score -= this.evaluateRookActivity(board, oppositeColor, oppositeColorIdx);
    
    this.lastScore = score * this.weight * context.endgameWeight * 0.5;
    return this.lastScore;
  }

  evaluateKingActivity(board, color, colorIdx, context) {
    const kingBB = board.bbPieces[colorIdx][PIECES.KING];
    const kingSquare = kingBB.getLSB();
    if (kingSquare === -1) return 0;
    
    const [kingRow, kingCol] = indexToRowCol(kingSquare);
    let score = 0;
    
    // Centralization bonus
    const centerDist = Math.abs(kingRow - 3.5) + Math.abs(kingCol - 3.5);
    score += (7 - centerDist) * 8;
    
    // Proximity to enemy pawns (to help promote our pawns or stop theirs)
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    const enemyPawns = board.bbPieces[oppositeColorIdx][PIECES.PAWN].clone();
    while (!enemyPawns.isEmpty()) {
      const pawnSq = enemyPawns.popLSB();
      const [pawnRow, pawnCol] = indexToRowCol(pawnSq);
      const dist = Math.abs(kingRow - pawnRow) + Math.abs(kingCol - pawnCol);
      if (dist <= 3) score += (4 - dist) * 5; // Bonus for being close to enemy pawns
    }
    
    return score;
  }

  evaluatePassedPawns(board, color, colorIdx, oppositeColorIdx) {
    let score = 0;
    const pawnBB = board.bbPieces[colorIdx][PIECES.PAWN].clone();
    
    while (!pawnBB.isEmpty()) {
      const sq = pawnBB.popLSB();
      const [row, col] = indexToRowCol(sq);
      
      if (this.isPassedPawn(board, { row, col }, color, oppositeColorIdx)) {
        const advancement = color === 'white' ? 7 - row : row;
        // Quadratic bonus for advancement
        score += advancement * advancement * 5;
        
        // Extra bonus if king is supporting
        const kingBB = board.bbPieces[colorIdx][PIECES.KING];
        if (!kingBB.isEmpty()) {
          const kingSquare = kingBB.getLSB();
          const [kingRow, kingCol] = indexToRowCol(kingSquare);
          const kingDist = Math.abs(kingRow - row) + Math.abs(kingCol - col);
          if (kingDist <= 2) score += 20;
        }
      }
    }
    
    return score;
  }

  evaluateRookActivity(board, color, colorIdx) {
    let score = 0;
    const rookBB = board.bbPieces[colorIdx][PIECES.ROOK].clone();
    
    while (!rookBB.isEmpty()) {
      const sq = rookBB.popLSB();
      const [row, col] = indexToRowCol(sq);
      
      // Rook on 7th/2nd rank
      const seventhRank = color === 'white' ? 1 : 6;
      if (row === seventhRank) score += 30;
      
      // Rook behind passed pawn
      const pawnBB = board.bbPieces[colorIdx][PIECES.PAWN].clone();
      while (!pawnBB.isEmpty()) {
        const pawnSq = pawnBB.popLSB();
        const [pawnRow, pawnCol] = indexToRowCol(pawnSq);
        if (pawnCol === col) {
          if ((color === 'white' && row > pawnRow) || (color === 'black' && row < pawnRow)) {
            score += 15;
          }
        }
      }
    }
    
    return score;
  }

  isPassedPawn(board, pawn, color, oppositeColorIdx) {
    const direction = color === 'white' ? -1 : 1;
    const endRow = color === 'white' ? 0 : 7;
    
    for (let col = Math.max(0, pawn.col - 1); col <= Math.min(7, pawn.col + 1); col++) {
      let row = pawn.row + direction;
      while ((color === 'white' && row >= endRow) || (color === 'black' && row <= endRow)) {
        if (board.bbPieces[oppositeColorIdx][PIECES.PAWN].getBit(rowColToIndex(row, col))) {
          return false;
        }
        row += direction;
      }
    }
    return true;
  }
}

/**
 * Pawn push bonus for move ordering
 */
class PawnPushHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('PawnPush', weight);
  }

  evaluate() {
    this.lastScore = 0;
    return 0;
  }

  evaluatePawnPush(move, board, color) {
    if (move.piece !== PIECES.PAWN) return 0;
    if (Math.abs(move.to[0] - move.from[0]) !== 2) return 0;
    
    const col = move.from[1];
    let bonus = 8;
    if (col === 3 || col === 4) bonus += 10;
    if (col === 2 || col === 5) bonus += 5;
    
    return bonus;
  }
}

// =============================================================================
// MOVE ORDERING
// =============================================================================

const MOVE_PRIORITY = {
  HASH_MOVE: 30000,
  WINNING_CAPTURE_QUEEN: 25000,
  WINNING_CAPTURE_ROOK: 24000,
  WINNING_CAPTURE_MINOR: 23000,
  PROMOTION: 22000,
  KILLER_MOVE: 20000,
  EQUAL_CAPTURE: 15000,
  OPENING_BOOK: 14000,
  PAWN_DOUBLE_PUSH: 10000,
  LOSING_CAPTURE: 5000,
  HISTORY: 0
};

const MAX_OPENING_BOOK_MOVE = 15;

class MVVLVAOrdering {
  getScore(move) {
    if (move.capturedPiece === null) return 0;
    
    const victimValues = {
      [PIECES.QUEEN]: 900,
      [PIECES.ROOK]: 500,
      [PIECES.BISHOP]: 330,
      [PIECES.KNIGHT]: 320,
      [PIECES.PAWN]: 100
    };
    const attackerValues = {
      [PIECES.PAWN]: 100,
      [PIECES.KNIGHT]: 320,
      [PIECES.BISHOP]: 330,
      [PIECES.ROOK]: 500,
      [PIECES.QUEEN]: 900,
      [PIECES.KING]: 10000
    };
    
    const victimValue = victimValues[move.capturedPiece] || 0;
    const attackerValue = attackerValues[move.piece] || 0;
    
    // MVV-LVA: victim value * 10 - attacker value
    const mvvlva = victimValue * 10 - attackerValue;
    
    if (victimValue >= attackerValue) {
      // Winning or equal capture
      if (move.capturedPiece === PIECES.QUEEN) return MOVE_PRIORITY.WINNING_CAPTURE_QUEEN + mvvlva;
      if (move.capturedPiece === PIECES.ROOK) return MOVE_PRIORITY.WINNING_CAPTURE_ROOK + mvvlva;
      return MOVE_PRIORITY.WINNING_CAPTURE_MINOR + mvvlva;
    } else {
      return MOVE_PRIORITY.LOSING_CAPTURE + mvvlva;
    }
  }
}

class KillerMoveOrdering {
  constructor() {
    this.killerMoves = {};
  }

  getScore(move, ply) {
    const killers = this.killerMoves[ply] || [];
    for (let i = 0; i < killers.length; i++) {
      if (move.fromSquare === killers[i].fromSquare && move.toSquare === killers[i].toSquare) {
        return MOVE_PRIORITY.KILLER_MOVE - i * 100;
      }
    }
    return 0;
  }

  addKiller(move, ply) {
    if (move.capturedPiece !== null) return;
    if (!this.killerMoves[ply]) this.killerMoves[ply] = [];
    
    const dominated = this.killerMoves[ply].some(k => 
      k.fromSquare === move.fromSquare && k.toSquare === move.toSquare
    );
    if (dominated) return;
    
    this.killerMoves[ply].unshift({ fromSquare: move.fromSquare, toSquare: move.toSquare });
    if (this.killerMoves[ply].length > 2) this.killerMoves[ply].pop();
  }

  clear() {
    this.killerMoves = {};
  }
}

class HistoryHeuristic {
  constructor() {
    this.history = {};
  }

  getScore(move) {
    const key = `${move.fromSquare}-${move.toSquare}`;
    return Math.min(this.history[key] || 0, 8000); // Cap history bonus
  }

  update(move, depth) {
    if (move.capturedPiece !== null) return;
    const key = `${move.fromSquare}-${move.toSquare}`;
    this.history[key] = (this.history[key] || 0) + depth * depth;
  }

  clear() {
    this.history = {};
  }
}

// =============================================================================
// OPENING BOOK
// =============================================================================

let polyglotBook = null;
let bookLoadPromise = null;

async function loadOpeningBook() {
  if (polyglotBook) return polyglotBook;
  if (bookLoadPromise) return bookLoadPromise;
  
  bookLoadPromise = new Promise((resolve) => {
    try {
      const book = new Polyglot('/chess-master/baron30.bin');
      book.initialisation.then(() => {
        polyglotBook = book;
        resolve(book);
      }).catch(() => resolve(null));
    } catch {
      resolve(null);
    }
  });
  
  return bookLoadPromise;
}

// =============================================================================
// BOT PLAYER CLASS
// =============================================================================

export class BotPlayer extends Player {
  constructor(color, board, difficulty = DIFFICULTY.CASUAL, name = null) {
    const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG[DIFFICULTY.CASUAL];
    super(color, board, name || `${config.name} Bot (${color})`);
    
    this.difficulty = difficulty;
    this.config = { ...config };
    this.positionCount = 0;
    this.quiescenceCount = 0;
    this.searchStartTime = 0;
    this.maxDepthReached = 0;
    this.cutoffCount = 0;
    this.aspirationReSearches = 0;
    this.completedDepth = 0;
    this.wasTimeout = false;
    this.abortSearch = false;
    
    this.heuristics = this.initializeHeuristics();
    this.pawnPushHeuristic = new PawnPushHeuristic();
    this.threatDetection = this.config.useThreatDetection ? new ThreatDetectionHeuristic() : null;
    this.mvvlva = new MVVLVAOrdering();
    this.killerMoves = this.config.useKillerMoves ? new KillerMoveOrdering() : null;
    this.historyHeuristic = this.config.useHistoryHeuristic ? new HistoryHeuristic() : null;
    this.transpositionTable = this.config.useTranspositionTable ? new TranspositionTable() : null;
    
    this.hashMove = null;
    this.openingBookMove = null;
    this.bestMoveAtDepth = null;
    
    this.report = new DecisionReport();
    
    if (this.config.useOpeningBook) {
      loadOpeningBook();
    }
  }

  initializeHeuristics() {
    const heuristics = [new MaterialHeuristic()];
    
    if (this.config.usePieceActivity) {
      heuristics.push(new PieceActivityHeuristic());
    }
    if (this.config.useCenterControl) {
      heuristics.push(new CenterControlHeuristic());
    }
    if (this.config.useDevelopment) {
      heuristics.push(new DevelopmentHeuristic());
    }
    if (this.config.usePawnStructure) {
      heuristics.push(new PawnStructureHeuristic());
    }
    if (this.config.useKingSafety) {
      heuristics.push(new KingSafetyHeuristic());
    }
    if (this.config.useMobility) {
      heuristics.push(new MobilityHeuristic());
    }
    if (this.config.useEndgame) {
      heuristics.push(new EndgameHeuristic());
    }
    
    return heuristics;
  }

  getEvaluationContext(board) {
    const whiteIdx = colorToIndex('white');
    const blackIdx = colorToIndex('black');
    
    let phase = 0;
    const phaseWeights = { [PIECES.KNIGHT]: 1, [PIECES.BISHOP]: 1, [PIECES.ROOK]: 2, [PIECES.QUEEN]: 4 };
    
    for (const pieceType of [PIECES.KNIGHT, PIECES.BISHOP, PIECES.ROOK, PIECES.QUEEN]) {
      const count = board.bbPieces[whiteIdx][pieceType].popCount() +
                   board.bbPieces[blackIdx][pieceType].popCount();
      phase += count * phaseWeights[pieceType];
    }
    
    const maxPhase = 24;
    const endgameWeight = Math.max(0, 1 - phase / maxPhase);
    const moveCount = board.history.moves.length;
    
    return { phase, endgameWeight, moveCount };
  }

  evaluate(board, color = this.color) {
    const context = this.getEvaluationContext(board);
    let score = 0;
    
    for (const heuristic of this.heuristics) {
      if (heuristic.enabled) {
        score += heuristic.evaluate(board, color, context);
      }
    }
    
    if (this.threatDetection) {
      this.threatDetection.evaluatingColor = color;
      score += this.threatDetection.evaluate(board, color, context);
    }
    
    return score;
  }

  evaluateWithBreakdown(board, color = this.color) {
    const context = this.getEvaluationContext(board);
    let totalScore = 0;
    const breakdown = {};
    
    for (const heuristic of this.heuristics) {
      if (heuristic.enabled) {
        const score = heuristic.evaluate(board, color, context);
        totalScore += score;
        breakdown[heuristic.name] = score;
      }
    }
    
    if (this.threatDetection) {
      this.threatDetection.evaluatingColor = color;
      const threatScore = this.threatDetection.evaluate(board, color, context);
      totalScore += threatScore;
      breakdown['ThreatDetection'] = threatScore;
    }
    
    return { score: totalScore, breakdown };
  }

  getLegalMovesForColor(board, color) {
    const colorIdx = colorToIndex(color);
    const moves = [];
    
    for (let pieceType = PIECES.KING; pieceType <= PIECES.PAWN; pieceType++) {
      const pieceBB = board.bbPieces[colorIdx][pieceType].clone();
      
      while (!pieceBB.isEmpty()) {
        const fromSquare = pieceBB.popLSB();
        const [fromRow, fromCol] = indexToRowCol(fromSquare);
        
        const pieceMoves = getValidMoves(fromRow, fromCol, board, true);
        
        for (const [toRow, toCol] of pieceMoves) {
          const { board: simBoard } = simulateMove(fromRow, fromCol, toRow, toCol, board);
          
          if (!isInCheck(simBoard, color)) {
            const toSquare = rowColToIndex(toRow, toCol);
            const capturedPiece = board.pieceList[toSquare];
            moves.push({
              from: [fromRow, fromCol],
              to: [toRow, toCol],
              fromSquare,
              toSquare,
              piece: pieceType,
              capturedPiece: capturedPiece !== PIECES.NONE ? capturedPiece : null,
              isPromotion: pieceType === PIECES.PAWN && 
                ((color === 'white' && toRow === 0) || (color === 'black' && toRow === 7))
            });
          }
        }
      }
    }
    
    return moves;
  }

  isHashMove(move) {
    if (!this.hashMove) return false;
    return move.fromSquare === this.hashMove.fromSquare && move.toSquare === this.hashMove.toSquare;
  }

  isOpeningBookMove(move) {
    if (!this.openingBookMove) return false;
    return move.fromSquare === this.openingBookMove.fromSquare && move.toSquare === this.openingBookMove.toSquare;
  }

  orderMoves(moves, ply) {
    const scored = moves.map(move => {
      let score = 0;
      
      if (this.isHashMove(move)) score += MOVE_PRIORITY.HASH_MOVE;
      if (this.isOpeningBookMove(move)) score += MOVE_PRIORITY.OPENING_BOOK;
      
      score += this.mvvlva.getScore(move);
      
      if (this.killerMoves) score += this.killerMoves.getScore(move, ply);
      if (this.historyHeuristic) score += this.historyHeuristic.getScore(move);
      
      if (move.isPromotion) score += MOVE_PRIORITY.PROMOTION;
      
      if (this.config.usePawnPushBonus && move.piece === PIECES.PAWN) {
        const pushBonus = this.pawnPushHeuristic.evaluatePawnPush(move, this.board, this.color);
        if (pushBonus > 0) score += MOVE_PRIORITY.PAWN_DOUBLE_PUSH + pushBonus;
      }
      
      return { move, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.move);
  }

  quiescence(board, alpha, beta, color, depth = 0) {
    this.positionCount++;
    this.quiescenceCount++;
    
    if (this.abortSearch || depth >= this.config.quiescenceDepth) {
      return this.evaluate(board, this.color);
    }
    
    const standPat = this.evaluate(board, this.color);
    
    if (color === this.color) {
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;
    } else {
      if (standPat <= alpha) return alpha;
      if (standPat < beta) beta = standPat;
    }
    
    const oppositeColor = color === 'white' ? 'black' : 'white';
    
    let moves = this.getLegalMovesForColor(board, color).filter(m => 
      m.capturedPiece !== null || m.isPromotion
    );
    
    if (moves.length === 0) return standPat;
    
    // Sort by MVV-LVA
    moves.sort((a, b) => this.mvvlva.getScore(b) - this.mvvlva.getScore(a));
    
    for (const move of moves) {
      // Skip clearly bad captures
      if (move.capturedPiece !== null && !move.isPromotion) {
        const see = this.mvvlva.getScore(move);
        if (see < MOVE_PRIORITY.EQUAL_CAPTURE - 5000) continue;
      }
      
      const { board: newBoard } = simulateMove(move.from[0], move.from[1], move.to[0], move.to[1], board);
      const score = this.quiescence(newBoard, alpha, beta, oppositeColor, depth + 1);
      
      if (color === this.color) {
        if (score > alpha) alpha = score;
        if (alpha >= beta) { this.cutoffCount++; break; }
      } else {
        if (score < beta) beta = score;
        if (beta <= alpha) { this.cutoffCount++; break; }
      }
    }
    
    return color === this.color ? alpha : beta;
  }

  minimax(board, depth, alpha, beta, color, ply = 0) {
    this.positionCount++;
    this.maxDepthReached = Math.max(this.maxDepthReached, ply);
    
    // Check abort
    if (this.abortSearch) {
      return { score: this.evaluate(board, this.color), move: null, aborted: true };
    }
    
    // TT lookup
    if (this.transpositionTable) {
      const ttResult = this.transpositionTable.probe(board, depth, alpha, beta);
      if (ttResult) {
        if (ttResult.type === 'exact' || ttResult.type === 'lowerbound' || ttResult.type === 'upperbound') {
          return { score: ttResult.score, move: ttResult.move };
        }
        if (ttResult.move) this.hashMove = ttResult.move;
      }
    }
    
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const moves = this.getLegalMovesForColor(board, color);
    
    // Terminal
    if (moves.length === 0) {
      if (isInCheck(board, color)) {
        const mateScore = 20000 - ply;
        return { score: color === this.color ? -mateScore : mateScore, move: null };
      }
      return { score: 0, move: null };
    }
    
    // Check timeout (but complete current depth if possible)
    const timeElapsed = Date.now() - this.searchStartTime;
    if (timeElapsed > this.config.maxTime * 0.95 && ply > 0) {
      this.wasTimeout = true;
      return { score: this.evaluate(board, this.color), move: null, timeout: true };
    }
    
    if (depth === 0) {
      const score = this.config.useQuiescence
        ? this.quiescence(board, alpha, beta, color)
        : this.evaluate(board, this.color);
      return { score, move: null };
    }
    
    const orderedMoves = this.orderMoves(moves, ply);
    
    let bestMove = orderedMoves[0];
    let bestScore = color === this.color ? -Infinity : Infinity;
    const isMaximizing = color === this.color;
    let ttFlag = TT_UPPERBOUND;
    
    for (let i = 0; i < orderedMoves.length; i++) {
      const move = orderedMoves[i];
      
      let searchDepth = depth - 1;
      
      // LMR
      if (this.config.useLateMovereduction && i > 3 && depth >= 3 && 
          move.capturedPiece === null && !move.isPromotion && !isInCheck(board, color)) {
        searchDepth = Math.max(1, depth - 2);
      }
      
      const { board: newBoard } = simulateMove(move.from[0], move.from[1], move.to[0], move.to[1], board);
      
      let result;
      if (i === 0) {
        result = this.minimax(newBoard, searchDepth, alpha, beta, oppositeColor, ply + 1);
      } else {
        // Null window search
        result = this.minimax(newBoard, searchDepth, 
          isMaximizing ? alpha : beta - 1, 
          isMaximizing ? alpha + 1 : beta, 
          oppositeColor, ply + 1);
        
        // Re-search if needed
        if (!result.timeout && !result.aborted &&
            ((isMaximizing && result.score > alpha && result.score < beta) ||
             (!isMaximizing && result.score < beta && result.score > alpha))) {
          result = this.minimax(newBoard, searchDepth, alpha, beta, oppositeColor, ply + 1);
        }
      }
      
      if (result.timeout || result.aborted) {
        if (this.transpositionTable && bestMove) {
          this.transpositionTable.store(board, depth, bestScore, ttFlag, bestMove);
        }
        return { score: bestScore, move: bestMove, timeout: result.timeout, aborted: result.aborted };
      }
      
      if (isMaximizing) {
        if (result.score > bestScore) {
          bestScore = result.score;
          bestMove = move;
        }
        if (bestScore > alpha) {
          alpha = bestScore;
          ttFlag = TT_EXACT;
        }
        if (alpha >= beta) {
          ttFlag = TT_LOWERBOUND;
          if (this.killerMoves) this.killerMoves.addKiller(move, ply);
          if (this.historyHeuristic && move.capturedPiece === null) this.historyHeuristic.update(move, depth);
          this.cutoffCount++;
          break;
        }
      } else {
        if (result.score < bestScore) {
          bestScore = result.score;
          bestMove = move;
        }
        if (bestScore < beta) {
          beta = bestScore;
          ttFlag = TT_EXACT;
        }
        if (beta <= alpha) {
          ttFlag = TT_UPPERBOUND;
          if (this.killerMoves) this.killerMoves.addKiller(move, ply);
          if (this.historyHeuristic && move.capturedPiece === null) this.historyHeuristic.update(move, depth);
          this.cutoffCount++;
          break;
        }
      }
    }
    
    if (this.transpositionTable) {
      this.transpositionTable.store(board, depth, bestScore, ttFlag, bestMove);
    }
    
    this.hashMove = null;
    return { score: bestScore, move: bestMove };
  }

  iterativeDeepening(board) {
    let bestMove = null;
    let bestScore = -Infinity;
    
    const legalMoves = this.getLegalMovesForColor(board, this.color);
    if (legalMoves.length === 0) return { score: 0, move: null };
    
    // Always have a fallback
    bestMove = this.orderMoves(legalMoves, 0)[0];
    this.bestMoveAtDepth = bestMove;
    
    for (let depth = this.config.minDepth; depth <= this.config.maxDepth; depth++) {
      const timeElapsed = Date.now() - this.searchStartTime;
      
      // Check if we have enough time for another iteration
      if (timeElapsed > this.config.maxTime * 0.6 && depth > this.config.minDepth) {
        break;
      }
      
      if (this.abortSearch) break;
      
      let result;
      
      if (this.config.useAspirationWindows && depth > this.config.minDepth && 
          Math.abs(bestScore) < 15000) {
        const window = 50;
        result = this.minimax(board, depth, bestScore - window, bestScore + window, this.color);
        
        if (!result.timeout && !result.aborted && 
            (result.score <= bestScore - window || result.score >= bestScore + window)) {
          this.aspirationReSearches++;
          result = this.minimax(board, depth, -Infinity, Infinity, this.color);
        }
      } else {
        result = this.minimax(board, depth, -Infinity, Infinity, this.color);
      }
      
      if (result.move && !result.aborted) {
        bestMove = result.move;
        bestScore = result.score;
        this.bestMoveAtDepth = bestMove;
        this.completedDepth = depth;
      }
      
      if (result.timeout || result.aborted || Math.abs(result.score) > 15000) break;
    }
    
    return { score: bestScore, move: bestMove || this.bestMoveAtDepth };
  }

  async lookupOpeningBookMove(board, moves) {
    const moveNumber = Math.floor(board.history.moves.length / 2) + 1;
    if (moveNumber > MAX_OPENING_BOOK_MOVE) return null;
    if (!this.config.useOpeningBook || !polyglotBook) return null;
    
    this.report.openingBookAttempt.tried = true;
    
    try {
      const fen = boardToFen(board);
      const bookMoves = await polyglotBook.getMovesFromFen(fen);
      
      if (!bookMoves || bookMoves.length === 0) return null;
      
      const totalProb = bookMoves.reduce((sum, m) => sum + parseFloat(m.probability), 0);
      let random = Math.random() * totalProb;
      
      for (const bookMove of bookMoves) {
        random -= parseFloat(bookMove.probability);
        if (random <= 0) {
          const legalMove = moves.find(m => {
            const fromFile = String.fromCharCode('a'.charCodeAt(0) + m.from[1]);
            const fromRank = 8 - m.from[0];
            const toFile = String.fromCharCode('a'.charCodeAt(0) + m.to[1]);
            const toRank = 8 - m.to[0];
            return bookMove.from === `${fromFile}${fromRank}` && bookMove.to === `${toFile}${toRank}`;
          });
          
          if (legalMove) {
            this.report.openingBookAttempt.found = true;
            this.report.openingBookAttempt.move = `${bookMove.from}-${bookMove.to}`;
            return legalMove;
          }
        }
      }
    } catch {
      // Silent fail
    }
    
    return null;
  }

  checkDrawConditions(board) {
    const drawInfo = {
      fiftyMoveCounter: board.gameState.half_move_clock,
      repetitionCount: this.countRepetitions(board),
      isDrawPosition: false,
      drawReason: null
    };
    
    if (drawInfo.fiftyMoveCounter >= 100) {
      drawInfo.isDrawPosition = true;
      drawInfo.drawReason = '50-move rule';
    }
    
    if (drawInfo.repetitionCount >= 3) {
      drawInfo.isDrawPosition = true;
      drawInfo.drawReason = 'Threefold repetition';
    }
    
    if (this.hasInsufficientMaterial(board)) {
      drawInfo.isDrawPosition = true;
      drawInfo.drawReason = 'Insufficient material';
    }
    
    return drawInfo;
  }

  countRepetitions(board) {
    const currentZobrist = board.gameState.zobrist_key;
    let count = 1;
    
    for (let i = 0; i < board.history.states.length; i++) {
      if (board.history.states[i].zobrist_key === currentZobrist) {
        count++;
      }
    }
    
    return count;
  }

  hasInsufficientMaterial(board) {
    const whiteIdx = colorToIndex('white');
    const blackIdx = colorToIndex('black');
    
    // Any pawns, queens, or rooks = sufficient
    if (board.bbPieces[whiteIdx][PIECES.PAWN].popCount() > 0 ||
        board.bbPieces[blackIdx][PIECES.PAWN].popCount() > 0 ||
        board.bbPieces[whiteIdx][PIECES.QUEEN].popCount() > 0 ||
        board.bbPieces[blackIdx][PIECES.QUEEN].popCount() > 0 ||
        board.bbPieces[whiteIdx][PIECES.ROOK].popCount() > 0 ||
        board.bbPieces[blackIdx][PIECES.ROOK].popCount() > 0) {
      return false;
    }
    
    const whiteMinors = board.bbPieces[whiteIdx][PIECES.BISHOP].popCount() + 
                       board.bbPieces[whiteIdx][PIECES.KNIGHT].popCount();
    const blackMinors = board.bbPieces[blackIdx][PIECES.BISHOP].popCount() + 
                       board.bbPieces[blackIdx][PIECES.KNIGHT].popCount();
    
    // K vs K
    if (whiteMinors === 0 && blackMinors === 0) return true;
    
    // K+minor vs K
    if ((whiteMinors === 1 && blackMinors === 0) || (whiteMinors === 0 && blackMinors === 1)) {
      return true;
    }
    
    return false;
  }

  async makeMove() {
    this.report.reset();
    this.report.botColor = this.color;
    this.report.difficulty = this.config.name;
    this.report.fen = boardToFen(this.board);
    this.report.moveNumber = Math.floor(this.board.history.moves.length / 2) + 1;
    this.report.halfMoveClock = this.board.gameState.half_move_clock;
    
    // Check draw conditions
    const drawInfo = this.checkDrawConditions(this.board);
    this.report.drawInfo = drawInfo;
    
    // If it's a draw, signal it
    if (drawInfo.isDrawPosition) {
      console.log(`Draw detected: ${drawInfo.drawReason}`);
      // Could return a special signal here, but for now just note it
    }
    
    const [minDelay, maxDelay] = this.config.thinkingDelay;
    const thinkingTime = minDelay + Math.random() * (maxDelay - minDelay);
    await new Promise(resolve => setTimeout(resolve, thinkingTime));
    
    const moves = this.getLegalMovesForColor(this.board, this.color);
    this.report.legalMoves = moves.map(m => this.report.formatMove(m));
    
    if (moves.length === 0) return null;
    
    // Single move - forced
    if (moves.length === 1) {
      this.report.searchStats.searchType = 'forced';
      this.report.selectedMove = this.report.formatMove(moves[0]);
      this.report.selectedMoveRank = 0;
      this.report.finalMove = this.report.formatMove(moves[0]);
      this.storeReport();
      return { from: moves[0].from, to: moves[0].to };
    }
    
    // Opening book
    const bookMove = await this.lookupOpeningBookMove(this.board, moves);
    if (bookMove) {
      this.openingBookMove = bookMove;
      this.report.openingBookAttempt.integratedIntoSearch = true;
    } else {
      this.openingBookMove = null;
    }
    
    // Reset search state
    this.positionCount = 0;
    this.quiescenceCount = 0;
    this.maxDepthReached = 0;
    this.cutoffCount = 0;
    this.aspirationReSearches = 0;
    this.completedDepth = 0;
    this.wasTimeout = false;
    this.abortSearch = false;
    this.searchStartTime = Date.now();
    this.hashMove = null;
    this.bestMoveAtDepth = null;
    
    // Set up abort controller
    searchAbortController = { abort: false };
    const checkAbort = () => {
      if (searchAbortController.abort) {
        this.abortSearch = true;
      }
    };
    const abortCheckInterval = setInterval(checkAbort, 50);
    
    if (this.killerMoves) this.killerMoves.clear();
    if (this.historyHeuristic) this.historyHeuristic.clear();
    
    // Evaluate all moves for report
    const moveEvaluations = [];
    for (const move of moves) {
      const { board: simBoard } = simulateMove(move.from[0], move.from[1], move.to[0], move.to[1], this.board);
      const { score, breakdown } = this.evaluateWithBreakdown(simBoard, this.color);
      moveEvaluations.push({ move, score, breakdown });
      this.report.addMoveEvaluation(move, score, breakdown);
    }
    
    // Search
    const result = this.iterativeDeepening(this.board);
    
    clearInterval(abortCheckInterval);
    
    const timeElapsed = Date.now() - this.searchStartTime;
    const ttStats = this.transpositionTable ? this.transpositionTable.getStats() : { hits: 0, stores: 0, hitRate: '0%' };
    
    this.report.searchStats = {
      positionsEvaluated: this.positionCount,
      maxDepthReached: this.maxDepthReached,
      completedDepth: this.completedDepth,
      wasTimeout: this.wasTimeout,
      timeSpentMs: timeElapsed,
      nodesPerSecond: timeElapsed > 0 ? Math.round(this.positionCount / (timeElapsed / 1000)) : 0,
      transpositionTableHits: ttStats.hits,
      transpositionTableStores: ttStats.stores,
      transpositionTableHitRate: ttStats.hitRate,
      aspirationWindowReSearches: this.aspirationReSearches,
      quiescenceNodes: this.quiescenceCount,
      cutoffs: this.cutoffCount,
      searchType: 'normal'
    };
    
    if (this.threatDetection) {
      const threats = this.threatDetection.getThreats();
      this.report.threatInfo = {
        threatsDetected: threats.hanging.length + threats.attacked.length,
        hangingPieces: threats.hanging,
        attackedPieces: threats.attacked
      };
    }
    
    // Use the move from search - for Master, this should always be the best move
    let selectedMove = result.move;
    
    // Find rank of selected move
    const rankedMoves = moveEvaluations.sort((a, b) => b.score - a.score);
    let selectedRank = 0;
    
    if (selectedMove) {
      selectedRank = rankedMoves.findIndex(m => 
        m.move.fromSquare === selectedMove.fromSquare && m.move.toSquare === selectedMove.toSquare
      );
      if (selectedRank === -1) selectedRank = 0;
    }
    
    this.report.selectedMove = this.report.formatMove(selectedMove);
    this.report.selectedMoveScore = result.score;
    this.report.selectedMoveRank = selectedRank;
    
    // NO imperfection for Master
    if (this.difficulty !== DIFFICULTY.MASTER && 
        (this.config.blunderChance > 0 || this.config.mistakeChance > 0)) {
      // Apply imperfection for lower difficulties
      if (Math.random() < this.config.blunderChance && rankedMoves.length > 3) {
        const idx = Math.floor(Math.random() * Math.min(10, rankedMoves.length));
        selectedMove = rankedMoves[idx].move;
        selectedRank = idx;
        this.report.imperfectionApplied = { type: 'blunder', originalMove: this.report.selectedMove, originalRank: 0 };
      } else if (Math.random() < this.config.mistakeChance && rankedMoves.length > 1) {
        const poolSize = Math.min(this.config.moveSelectionPool, rankedMoves.length);
        const idx = Math.floor(Math.random() * poolSize);
        if (idx > 0) {
          selectedMove = rankedMoves[idx].move;
          selectedRank = idx;
          this.report.imperfectionApplied = { type: 'suboptimal', originalMove: this.report.selectedMove, originalRank: 0 };
        }
      }
    }
    
    if (!selectedMove) {
      selectedMove = rankedMoves[0].move;
      selectedRank = 0;
    }
    
    this.report.finalMove = this.report.formatMove(selectedMove);
    this.storeReport();
    this.openingBookMove = null;
    
    return { from: selectedMove.from, to: selectedMove.to };
  }

  storeReport() {
    const reportCopy = new DecisionReport();
    Object.assign(reportCopy, this.report);
    reportCopy.moveEvaluations = [...this.report.moveEvaluations];
    reportCopy.openingBookAttempt = { ...this.report.openingBookAttempt };
    reportCopy.searchStats = { ...this.report.searchStats };
    reportCopy.imperfectionApplied = { ...this.report.imperfectionApplied };
    reportCopy.threatInfo = { ...this.report.threatInfo };
    reportCopy.drawInfo = { ...this.report.drawInfo };
    reportCopy.contentionInfo = { ...this.report.contentionInfo };
    
    latestReport = reportCopy;
    reportHistory.push(reportCopy);
    if (reportHistory.length > MAX_REPORT_HISTORY) reportHistory.shift();
  }

  setDifficulty(difficulty) {
    this.difficulty = difficulty;
    this.config = { ...DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG[DIFFICULTY.CASUAL] };
    this.heuristics = this.initializeHeuristics();
    this.killerMoves = this.config.useKillerMoves ? new KillerMoveOrdering() : null;
    this.historyHeuristic = this.config.useHistoryHeuristic ? new HistoryHeuristic() : null;
    this.transpositionTable = this.config.useTranspositionTable ? new TranspositionTable() : null;
    this.threatDetection = this.config.useThreatDetection ? new ThreatDetectionHeuristic() : null;
  }

  getConfig() {
    return { ...this.config };
  }

  configure(options) {
    this.config = { ...this.config, ...options };
  }
}

export function createBotPlayer(color, board, difficulty = 'casual', name = null) {
  let difficultyLevel;
  
  if (typeof difficulty === 'string') {
    switch (difficulty.toLowerCase()) {
      case 'rookie': difficultyLevel = DIFFICULTY.ROOKIE; break;
      case 'casual': difficultyLevel = DIFFICULTY.CASUAL; break;
      case 'strategic': difficultyLevel = DIFFICULTY.STRATEGIC; break;
      case 'master': difficultyLevel = DIFFICULTY.MASTER; break;
      default: difficultyLevel = DIFFICULTY.CASUAL;
    }
  } else {
    difficultyLevel = difficulty;
  }
  
  return new BotPlayer(color, board, difficultyLevel, name);
}

export default BotPlayer;