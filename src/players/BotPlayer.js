import { Player } from './Player';
import { PIECES, PIECE_NAMES } from '../constants/gameConstants';
import { getValidMoves, simulateMove, isInCheck } from '../utils/chessLogic';
import { indexToRowCol, colorToIndex, rowColToIndex } from '../utils/bitboard';
import { boardToFen } from '../utils/chessUtils';
import { Polyglot } from 'cm-polyglot/src/Polyglot.js';

// =============================================================================
// DIFFICULTY CONFIGURATION
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
    maxTime: 15000,
    useQuiescence: false,
    quiescenceDepth: 0,
    useMoveOrdering: true,
    useKillerMoves: false,
    useHistoryHeuristic: false,
    useNullMovePruning: false,
    useLateMovereduction: false,
    useOpeningBook: false,
    useCenterControl: true,
    usePawnStructure: false,
    useKingSafety: false,
    useDevelopment: true,
    usePawnPushBonus: true,
    blunderChance: 0.10,
    mistakeChance: 0.15,
    moveSelectionPool: 6,
    thinkingDelay: [200, 500]
  },
  [DIFFICULTY.CASUAL]: {
    name: 'Casual',
    minDepth: 4,
    maxDepth: 6,
    maxTime: 15000,
    useQuiescence: true,
    quiescenceDepth: 3,
    useMoveOrdering: true,
    useKillerMoves: false,
    useHistoryHeuristic: false,
    useNullMovePruning: false,
    useLateMovereduction: false,
    useOpeningBook: true,
    useCenterControl: true,
    usePawnStructure: true,
    useKingSafety: false,
    useDevelopment: true,
    usePawnPushBonus: true,
    blunderChance: 0.03,
    mistakeChance: 0.08,
    moveSelectionPool: 4,
    thinkingDelay: [300, 800]
  },
  [DIFFICULTY.STRATEGIC]: {
    name: 'Strategic',
    minDepth: 6,
    maxDepth: 8,
    maxTime: 15000,
    useQuiescence: true,
    quiescenceDepth: 4,
    useMoveOrdering: true,
    useKillerMoves: true,
    useHistoryHeuristic: true,
    useNullMovePruning: false,
    useLateMovereduction: true,
    useOpeningBook: true,
    useCenterControl: true,
    usePawnStructure: true,
    useKingSafety: true,
    useDevelopment: true,
    usePawnPushBonus: true,
    blunderChance: 0.0,
    mistakeChance: 0.02,
    moveSelectionPool: 3,
    thinkingDelay: [500, 1500]
  },
  [DIFFICULTY.MASTER]: {
    name: 'Master',
    minDepth: 8,
    maxDepth: 10,
    maxTime: 15000,
    useQuiescence: true,
    quiescenceDepth: 6,
    useMoveOrdering: true,
    useKillerMoves: true,
    useHistoryHeuristic: true,
    useNullMovePruning: true,
    useLateMovereduction: true,
    useOpeningBook: true,
    useCenterControl: true,
    usePawnStructure: true,
    useKingSafety: true,
    useDevelopment: true,
    usePawnPushBonus: true,
    blunderChance: 0.0,
    mistakeChance: 0.0,
    moveSelectionPool: 1,
    thinkingDelay: [800, 2000]
  }
};

// =============================================================================
// DECISION REPORT - Detailed logging for analysis
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
    this.legalMoves = [];
    this.openingBookAttempt = { tried: false, found: false, move: null, integratedIntoSearch: false };
    this.searchStats = {
      positionsEvaluated: 0,
      maxDepthReached: 0,
      timeSpentMs: 0,
      nodesPerSecond: 0
    };
    this.moveEvaluations = [];
    this.selectedMove = null;
    this.selectedMoveScore = null;
    this.imperfectionApplied = { type: null, originalMove: null };
    this.finalMove = null;
  }

  addMoveEvaluation(move, score, breakdown) {
    this.moveEvaluations.push({
      move: this.formatMove(move),
      score,
      breakdown: { ...breakdown }
    });
  }

  formatMove(move) {
    if (!move) return null;
    const files = 'abcdefgh';
    const fromSquare = `${files[move.from[1]]}${8 - move.from[0]}`;
    const toSquare = `${files[move.to[1]]}${8 - move.to[0]}`;
    const pieceType = move.piece !== undefined ? PIECE_NAMES[move.piece] : 'Unknown';
    const capture = move.capturedPiece ? ` x ${PIECE_NAMES[move.capturedPiece]}` : '';
    return {
      algebraic: `${fromSquare}${toSquare}`,
      from: fromSquare,
      to: toSquare,
      piece: pieceType,
      capture: capture,
      isPromotion: move.isPromotion || false
    };
  }

  generateReport() {
    // Sort moves by score (best first)
    const sortedMoves = [...this.moveEvaluations].sort((a, b) => b.score - a.score);
    
    const report = {
      meta: {
        timestamp: this.timestamp,
        botColor: this.botColor,
        difficulty: this.difficulty,
        moveNumber: this.moveNumber,
        fen: this.fen
      },
      openingBook: this.openingBookAttempt,
      searchStats: this.searchStats,
      moveAnalysis: {
        totalLegalMoves: this.legalMoves.length,
        movesEvaluated: sortedMoves.length,
        topMoves: sortedMoves.slice(0, 10),
        allMoves: sortedMoves
      },
      decision: {
        selectedMove: this.selectedMove,
        selectedScore: this.selectedMoveScore,
        imperfection: this.imperfectionApplied,
        finalMove: this.finalMove
      }
    };

    return report;
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
    text += `FEN: ${report.meta.fen}\n\n`;
    
    text += '─'.repeat(40) + '\n';
    text += 'OPENING BOOK\n';
    text += '─'.repeat(40) + '\n';
    text += `Attempted: ${report.openingBook.tried}\n`;
    text += `Found: ${report.openingBook.found}\n`;
    if (report.openingBook.move) {
      text += `Move: ${report.openingBook.move}\n`;
    }
    text += `Integrated Into Search: ${report.openingBook.integratedIntoSearch}\n`;
    text += '\n';
    
    text += '─'.repeat(40) + '\n';
    text += 'SEARCH STATISTICS\n';
    text += '─'.repeat(40) + '\n';
    text += `Positions Evaluated: ${report.searchStats.positionsEvaluated.toLocaleString()}\n`;
    text += `Max Depth Reached: ${report.searchStats.maxDepthReached}\n`;
    text += `Time Spent: ${report.searchStats.timeSpentMs}ms\n`;
    text += `Nodes/Second: ${report.searchStats.nodesPerSecond.toLocaleString()}\n\n`;
    
    text += '─'.repeat(40) + '\n';
    text += 'MOVE ANALYSIS\n';
    text += '─'.repeat(40) + '\n';
    text += `Legal Moves: ${report.moveAnalysis.totalLegalMoves}\n`;
    text += `Moves Evaluated: ${report.moveAnalysis.movesEvaluated}\n\n`;
    
    text += 'TOP 10 MOVES:\n';
    text += '─'.repeat(40) + '\n';
    
    for (let i = 0; i < Math.min(10, report.moveAnalysis.topMoves.length); i++) {
      const m = report.moveAnalysis.topMoves[i];
      text += `\n${i + 1}. ${m.move.piece} ${m.move.algebraic}${m.move.capture}\n`;
      text += `   Total Score: ${m.score}\n`;
      text += `   Breakdown:\n`;
      for (const [key, value] of Object.entries(m.breakdown)) {
        text += `     - ${key}: ${value}\n`;
      }
    }
    
    text += '\n' + '─'.repeat(40) + '\n';
    text += 'FINAL DECISION\n';
    text += '─'.repeat(40) + '\n';
    if (report.decision.selectedMove) {
      text += `Selected: ${report.decision.selectedMove.piece} ${report.decision.selectedMove.algebraic}\n`;
      text += `Score: ${report.decision.selectedScore}\n`;
    }
    if (report.decision.imperfection.type) {
      text += `Imperfection Applied: ${report.decision.imperfection.type}\n`;
      if (report.decision.imperfection.originalMove) {
        text += `Original Move: ${report.decision.imperfection.originalMove.algebraic}\n`;
      }
    }
    if (report.decision.finalMove) {
      text += `Final Move: ${report.decision.finalMove.piece} ${report.decision.finalMove.algebraic}\n`;
    }
    
    text += '\n' + '═'.repeat(80) + '\n';
    
    return text;
  }
}

// Global report storage for download
let latestReport = null;
let reportHistory = [];
const MAX_REPORT_HISTORY = 100;

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
  
  // Sort reports by move number (first to last)
  const sortedReports = [...reportHistory].sort((a, b) => {
    const aReport = a.generateReport();
    const bReport = b.generateReport();
    // First sort by timestamp, then by move number
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
// EVALUATION HEURISTICS
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
 * Material evaluation - counts piece values
 */
class MaterialHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('Material', weight);
  }

  evaluate(board, color, context) {
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let score = 0;
    const pieceValues = Player.PIECE_VALUES;
    
    for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
      const ourCount = board.bbPieces[colorIdx][piece].popCount();
      const theirCount = board.bbPieces[oppositeColorIdx][piece].popCount();
      score += (ourCount - theirCount) * pieceValues[piece];
    }
    
    this.lastScore = score * this.weight;
    return this.lastScore;
  }
}

/**
 * Center control - bonus for controlling central squares
 */
class CenterControlHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('CenterControl', weight);
    // Central squares: d4, e4, d5, e5 (most important)
    // Extended center: c3-f3 to c6-f6
    this.centerSquares = [
      rowColToIndex(3, 3), rowColToIndex(3, 4), // d5, e5
      rowColToIndex(4, 3), rowColToIndex(4, 4)  // d4, e4
    ];
    this.extendedCenter = [];
    for (let row = 2; row <= 5; row++) {
      for (let col = 2; col <= 5; col++) {
        const sq = rowColToIndex(row, col);
        if (!this.centerSquares.includes(sq)) {
          this.extendedCenter.push(sq);
        }
      }
    }
  }

  evaluate(board, color, context) {
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let score = 0;
    
    // Bonus for pieces in center
    for (const sq of this.centerSquares) {
      if (board.bbSide[colorIdx].getBit(sq)) {
        const piece = board.pieceList[sq];
        // Pawns in center are very valuable
        if (piece === PIECES.PAWN) score += 30;
        else if (piece === PIECES.KNIGHT) score += 20;
        else if (piece === PIECES.BISHOP) score += 15;
        else score += 10;
      }
      if (board.bbSide[oppositeColorIdx].getBit(sq)) {
        const piece = board.pieceList[sq];
        if (piece === PIECES.PAWN) score -= 30;
        else if (piece === PIECES.KNIGHT) score -= 20;
        else if (piece === PIECES.BISHOP) score -= 15;
        else score -= 10;
      }
    }
    
    // Smaller bonus for extended center
    for (const sq of this.extendedCenter) {
      if (board.bbSide[colorIdx].getBit(sq)) {
        score += 5;
      }
      if (board.bbSide[oppositeColorIdx].getBit(sq)) {
        score -= 5;
      }
    }
    
    this.lastScore = score * this.weight;
    return this.lastScore;
  }
}

/**
 * Development - encourages piece development in opening
 */
class DevelopmentHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('Development', weight);
  }

  evaluate(board, color, context) {
    // Only significant in opening
    if (context.moveCount > 20) {
      this.lastScore = 0;
      return 0;
    }
    
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    let score = 0;
    score += this.evaluateDevelopment(board, color, colorIdx, context);
    score -= this.evaluateDevelopment(board, color === 'white' ? 'black' : 'white', oppositeColorIdx, context);
    
    this.lastScore = score * this.weight;
    return this.lastScore;
  }

  evaluateDevelopment(board, color, colorIdx, context) {
    let score = 0;
    const backRank = color === 'white' ? 7 : 0;
    
    // Penalty for knights on starting squares
    const knightStarts = color === 'white' 
      ? [rowColToIndex(7, 1), rowColToIndex(7, 6)]  // b1, g1
      : [rowColToIndex(0, 1), rowColToIndex(0, 6)]; // b8, g8
    
    for (const sq of knightStarts) {
      if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq)) {
        score -= 25;
      }
    }
    
    // Penalty for bishops on starting squares
    const bishopStarts = color === 'white'
      ? [rowColToIndex(7, 2), rowColToIndex(7, 5)]  // c1, f1
      : [rowColToIndex(0, 2), rowColToIndex(0, 5)]; // c8, f8
    
    for (const sq of bishopStarts) {
      if (board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) {
        score -= 25;
      }
    }
    
    // Bonus for castled king (or penalty for unmoved king in opening)
    const kingBB = board.bbPieces[colorIdx][PIECES.KING];
    const kingSquare = kingBB.getLSB();
    if (kingSquare !== -1) {
      const [kingRow, kingCol] = indexToRowCol(kingSquare);
      if (kingRow === backRank) {
        if (kingCol === 6 || kingCol === 2) {
          score += 40; // Castled
        } else if (kingCol === 4) {
          score -= 15; // Still on starting square
        }
      }
    }
    
    // Penalty for queen out too early
    const queenBB = board.bbPieces[colorIdx][PIECES.QUEEN];
    if (!queenBB.isEmpty()) {
      const queenSquare = queenBB.getLSB();
      const [queenRow] = indexToRowCol(queenSquare);
      const queenStartRow = color === 'white' ? 7 : 0;
      if (queenRow !== queenStartRow && context.moveCount < 8) {
        // Check if minor pieces are still undeveloped
        let undevelopedMinors = 0;
        for (const sq of [...knightStarts, ...bishopStarts]) {
          if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq) ||
              board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) {
            undevelopedMinors++;
          }
        }
        if (undevelopedMinors >= 2) {
          score -= 30; // Queen out before developing pieces
        }
      }
    }
    
    return score;
  }
}

/**
 * Pawn structure - doubled, isolated, passed pawns
 */
class PawnStructureHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('PawnStructure', weight);
    this.passedPawnBonus = [0, 10, 15, 25, 40, 60, 90, 0];
    this.isolatedPawnPenalty = 15;
    this.doubledPawnPenalty = 12;
    this.connectedPawnBonus = 8;
  }

  evaluate(board, color, context) {
    const colorIdx = colorToIndex(color);
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const oppositeColorIdx = colorToIndex(oppositeColor);
    
    let score = 0;
    score += this.analyzePawnStructure(board, color, colorIdx, oppositeColorIdx);
    score -= this.analyzePawnStructure(board, oppositeColor, oppositeColorIdx, colorIdx);
    
    this.lastScore = score * this.weight;
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
      // Doubled pawns penalty
      if (pawnFiles[pawn.col] > 1) {
        score -= this.doubledPawnPenalty;
      }
      
      // Isolated pawns penalty
      const hasLeftNeighbor = pawn.col > 0 && pawnFiles[pawn.col - 1] > 0;
      const hasRightNeighbor = pawn.col < 7 && pawnFiles[pawn.col + 1] > 0;
      if (!hasLeftNeighbor && !hasRightNeighbor) {
        score -= this.isolatedPawnPenalty;
      } else {
        // Connected pawn bonus
        score += this.connectedPawnBonus;
      }
      
      // Passed pawn bonus
      if (this.isPassedPawn(board, pawn, color, oppositeColorIdx)) {
        const advancement = color === 'white' ? 7 - pawn.row : pawn.row;
        score += this.passedPawnBonus[advancement];
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
        const checkSquare = rowColToIndex(row, col);
        if (board.bbPieces[oppositeColorIdx][PIECES.PAWN].getBit(checkSquare)) {
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
    this.pawnShieldBonus = 12;
    this.openFileNearKingPenalty = 25;
  }

  evaluate(board, color, context) {
    // Less important in endgame
    const safetyWeight = Math.max(0.2, 1 - context.endgameWeight);
    
    const colorIdx = colorToIndex(color);
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const oppositeColorIdx = colorToIndex(oppositeColor);
    
    let score = 0;
    score += this.evaluateKingSafety(board, color, colorIdx) * safetyWeight;
    score -= this.evaluateKingSafety(board, oppositeColor, oppositeColorIdx) * safetyWeight;
    
    this.lastScore = score * this.weight;
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
    
    // Pawn shield bonus
    if (kingRow === backRank && (kingCol <= 2 || kingCol >= 5)) {
      for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
        const shieldSquare = rowColToIndex(pawnRank, col);
        if (board.bbPieces[colorIdx][PIECES.PAWN].getBit(shieldSquare)) {
          safety += this.pawnShieldBonus;
        }
      }
    }
    
    // Open file penalty
    for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
      let hasPawn = false;
      for (let row = 0; row < 8; row++) {
        const square = rowColToIndex(row, col);
        if (board.bbPieces[colorIdx][PIECES.PAWN].getBit(square)) {
          hasPawn = true;
          break;
        }
      }
      if (!hasPawn) {
        safety -= this.openFileNearKingPenalty;
      }
    }
    
    return safety;
  }
}

/**
 * Pawn push bonus - encourages double pawn pushes in appropriate situations
 */
class PawnPushHeuristic extends EvaluationHeuristic {
  constructor(weight = 1.0) {
    super('PawnPush', weight);
  }

  evaluate(board, color, context) {
    // This heuristic is applied during move ordering/selection, not static eval
    this.lastScore = 0;
    return 0;
  }

  /**
   * Evaluate if a double pawn push is preferable
   * @param {Object} move - The move object with from/to
   * @param {Board} board - Current board state
   * @param {string} color - The color making the move
   * @returns {number} - Bonus score for this pawn push
   */
  evaluatePawnPush(move, board, color) {
    if (move.piece !== PIECES.PAWN) return 0;
    
    const fromRow = move.from[0];
    const toRow = move.to[0];
    const col = move.from[1];
    const colorIdx = colorToIndex(color);
    const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
    
    // Check if this is a double push
    const isDoublePush = Math.abs(toRow - fromRow) === 2;
    if (!isDoublePush) return 0;
    
    let bonus = 15; // Base bonus for double push - it's generally good
    
    // Extra bonus for central pawns (d and e files)
    if (col === 3 || col === 4) {
      bonus += 20;
    }
    
    // Extra bonus for pawns attacking the center
    if (col === 2 || col === 5) {
      bonus += 10;
    }
    
    // Check if the push would block a diagonal for our bishops
    const bishopBB = board.bbPieces[colorIdx][PIECES.BISHOP].clone();
    while (!bishopBB.isEmpty()) {
      const bishopSquare = bishopBB.popLSB();
      const [bishopRow, bishopCol] = indexToRowCol(bishopSquare);
      
      // Check if pawn would be directly in front of an undeveloped bishop
      const backRank = color === 'white' ? 7 : 0;
      if (bishopRow === backRank) {
        // Bishop is still on back rank
        const pawnInFront = (color === 'white' && toRow === 5) || (color === 'black' && toRow === 2);
        if (pawnInFront && Math.abs(bishopCol - col) === 1) {
          bonus -= 10; // Slight penalty for blocking undeveloped bishop's diagonal
        }
      }
    }
    
    // Check if the push would block our own pieces' movement significantly
    // E.g., blocking a knight's best outpost
    // This is a simplified check - in reality we'd want more sophisticated analysis
    
    // Bonus for responding to King's Gambit (1.e4 e5 2.f4)
    // If opponent pushed f-pawn, responding with d5 or exf4 is often good
    const epSquare = board.gameState.en_passant_sq;
    if (epSquare !== -1) {
      // There's an en passant opportunity - the opponent just made a double push
      // Our double push might be a good response
      bonus += 5;
    }
    
    // Check if we're answering opponent's center push
    const opponentPawnBB = board.bbPieces[oppositeColorIdx][PIECES.PAWN];
    const centralSquares = [
      rowColToIndex(3, 3), rowColToIndex(3, 4), // d5, e5
      rowColToIndex(4, 3), rowColToIndex(4, 4)  // d4, e4
    ];
    
    let opponentControlsCenter = false;
    for (const sq of centralSquares) {
      if (opponentPawnBB.getBit(sq)) {
        opponentControlsCenter = true;
        break;
      }
    }
    
    // If opponent controls center, our central pawn push is more valuable
    if (opponentControlsCenter && (col >= 2 && col <= 5)) {
      bonus += 15;
    }
    
    return bonus;
  }
}

// =============================================================================
// MOVE ORDERING
// =============================================================================

// Priority levels for move ordering
const MOVE_PRIORITY = {
  PROMOTION: 15000,         // Promotion is almost always best
  WINNING_CAPTURE: 12000,   // Captures winning material
  KILLER_MOVE: 10000,       // Killer moves from search
  EQUAL_CAPTURE: 9000,      // Equal value captures
  OPENING_BOOK: 8500,       // Opening book moves - good but below tactics
  PAWN_DOUBLE_PUSH: 8000,   // Good double pawn pushes
  LOSING_CAPTURE: 7000,     // Captures losing material
  HISTORY: 0                // Added to base
};

// Maximum move number to query opening book (15 full moves = 30 half-moves)
const MAX_OPENING_BOOK_MOVE = 15;

class MVVLVAOrdering {
  getScore(move) {
    if (!move.capturedPiece) return 0;
    const victimValue = Player.PIECE_VALUES[move.capturedPiece] || 0;
    const attackerValue = Player.PIECE_VALUES[move.piece] || 0;
    
    // MVV-LVA: prioritize capturing valuable pieces with less valuable pieces
    const captureScore = victimValue * 10 - attackerValue;
    
    if (captureScore > 0) {
      return MOVE_PRIORITY.WINNING_CAPTURE + captureScore;
    } else if (captureScore === 0) {
      return MOVE_PRIORITY.EQUAL_CAPTURE;
    } else {
      return MOVE_PRIORITY.LOSING_CAPTURE + captureScore;
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
      const killer = killers[i];
      if (move.fromSquare === killer.fromSquare && move.toSquare === killer.toSquare) {
        return MOVE_PRIORITY.KILLER_MOVE - i * 100;
      }
    }
    return 0;
  }

  addKiller(move, ply) {
    if (move.capturedPiece) return;
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
    return this.history[key] || 0;
  }

  update(move, depth) {
    if (move.capturedPiece) return;
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
    this.searchStartTime = 0;
    this.maxDepthReached = 0;
    
    this.heuristics = this.initializeHeuristics();
    this.pawnPushHeuristic = new PawnPushHeuristic();
    this.mvvlva = new MVVLVAOrdering();
    this.killerMoves = this.config.useKillerMoves ? new KillerMoveOrdering() : null;
    this.historyHeuristic = this.config.useHistoryHeuristic ? new HistoryHeuristic() : null;
    
    // Opening book move to prioritize
    this.openingBookMove = null;
    
    this.report = new DecisionReport();
    
    if (this.config.useOpeningBook) {
      loadOpeningBook();
    }
  }

  initializeHeuristics() {
    const heuristics = [new MaterialHeuristic()];
    
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
            moves.push({
              from: [fromRow, fromCol],
              to: [toRow, toCol],
              fromSquare,
              toSquare,
              piece: pieceType,
              capturedPiece: board.pieceList[toSquare] !== PIECES.NONE ? board.pieceList[toSquare] : null,
              isPromotion: pieceType === PIECES.PAWN && 
                ((color === 'white' && toRow === 0) || (color === 'black' && toRow === 7))
            });
          }
        }
      }
    }
    
    return moves;
  }

  /**
   * Check if a move matches the opening book move
   */
  isOpeningBookMove(move) {
    if (!this.openingBookMove) return false;
    return move.fromSquare === this.openingBookMove.fromSquare && 
           move.toSquare === this.openingBookMove.toSquare;
  }

  orderMoves(moves, ply) {
    const scored = moves.map(move => {
      let score = 0;
      
      // Opening book moves get highest priority
      if (this.isOpeningBookMove(move)) {
        score += MOVE_PRIORITY.OPENING_BOOK;
      }
      
      // Capture scoring (MVV-LVA)
      score += this.mvvlva.getScore(move);
      
      // Killer moves
      if (this.killerMoves) {
        score += this.killerMoves.getScore(move, ply);
      }
      
      // History heuristic
      if (this.historyHeuristic) {
        score += this.historyHeuristic.getScore(move);
      }
      
      // Promotion bonus
      if (move.isPromotion) {
        score += MOVE_PRIORITY.PROMOTION;
      }
      
      // Pawn double push bonus
      if (this.config.usePawnPushBonus && move.piece === PIECES.PAWN) {
        const pushBonus = this.pawnPushHeuristic.evaluatePawnPush(move, this.board, this.color);
        if (pushBonus > 0) {
          score += MOVE_PRIORITY.PAWN_DOUBLE_PUSH + pushBonus;
        }
      }
      
      return { move, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.move);
  }

  quiescence(board, alpha, beta, color, depth = 0) {
    this.positionCount++;
    
    if (depth >= this.config.quiescenceDepth) {
      return this.evaluate(board, color);
    }
    
    const standPat = this.evaluate(board, color);
    
    if (color === this.color) {
      if (standPat >= beta) return beta;
      alpha = Math.max(alpha, standPat);
    } else {
      if (standPat <= alpha) return alpha;
      beta = Math.min(beta, standPat);
    }
    
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const moves = this.getLegalMovesForColor(board, color).filter(m => m.capturedPiece);
    
    if (moves.length === 0) return standPat;
    
    moves.sort((a, b) => {
      const aScore = Player.PIECE_VALUES[a.capturedPiece] - Player.PIECE_VALUES[a.piece] / 10;
      const bScore = Player.PIECE_VALUES[b.capturedPiece] - Player.PIECE_VALUES[b.piece] / 10;
      return bScore - aScore;
    });
    
    for (const capture of moves) {
      const { board: newBoard } = simulateMove(
        capture.from[0], capture.from[1],
        capture.to[0], capture.to[1],
        board
      );
      
      const score = this.quiescence(newBoard, alpha, beta, oppositeColor, depth + 1);
      
      if (color === this.color) {
        alpha = Math.max(alpha, score);
        if (alpha >= beta) break;
      } else {
        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
    }
    
    return color === this.color ? alpha : beta;
  }

  minimax(board, depth, alpha, beta, color, ply = 0) {
    this.positionCount++;
    this.maxDepthReached = Math.max(this.maxDepthReached, ply);
    
    const oppositeColor = color === 'white' ? 'black' : 'white';
    const moves = this.getLegalMovesForColor(board, color);
    
    // Check for terminal positions first (before timeout check)
    if (moves.length === 0) {
      if (isInCheck(board, color)) {
        const mateScore = 20000 - ply;
        return { score: color === this.color ? -mateScore : mateScore, move: null };
      }
      return { score: 0, move: null }; // Stalemate
    }
    
    // Check timeout - but at root (ply=0) we must return a move
    if (Date.now() - this.searchStartTime > this.config.maxTime) {
      if (ply === 0) {
        // At root, we MUST return a move - use the first ordered move with quick eval
        const orderedMoves = this.orderMoves(moves, 0);
        const firstMove = orderedMoves[0];
        const { board: simBoard } = simulateMove(
          firstMove.from[0], firstMove.from[1],
          firstMove.to[0], firstMove.to[1],
          board
        );
        return { 
          score: this.evaluate(simBoard, this.color), 
          move: firstMove, 
          timeout: true 
        };
      }
      return { score: this.evaluate(board, this.color), move: null, timeout: true };
    }
    
    if (depth === 0) {
      const score = this.config.useQuiescence
        ? this.quiescence(board, alpha, beta, color)
        : this.evaluate(board, color);
      return { score, move: null };
    }
    
    const orderedMoves = this.orderMoves(moves, ply);
    
    // Initialize bestMove to first move - ensures we always have a move at root
    let bestMove = ply === 0 ? orderedMoves[0] : null;
    let bestScore = color === this.color ? -Infinity : Infinity;
    const isMaximizing = color === this.color;
    
    for (let i = 0; i < orderedMoves.length; i++) {
      const move = orderedMoves[i];
      
      let searchDepth = depth - 1;
      if (this.config.useLateMovereduction && i > 3 && depth >= 3 && !move.capturedPiece && !move.isPromotion) {
        searchDepth = depth - 2;
      }
      
      const { board: newBoard } = simulateMove(move.from[0], move.from[1], move.to[0], move.to[1], board);
      const result = this.minimax(newBoard, searchDepth, alpha, beta, oppositeColor, ply + 1);
      
      if (result.timeout) {
        // On timeout, return whatever best move we've found so far
        // At root level, bestMove is guaranteed non-null due to initialization above
        return { score: bestScore, move: bestMove, timeout: true };
      }
      
      if (isMaximizing) {
        if (result.score > bestScore) {
          bestScore = result.score;
          bestMove = move;
        }
        alpha = Math.max(alpha, bestScore);
        if (alpha >= beta) {
          if (this.killerMoves) this.killerMoves.addKiller(move, ply);
          if (this.historyHeuristic && !move.capturedPiece) this.historyHeuristic.update(move, depth);
          break;
        }
      } else {
        if (result.score < bestScore) {
          bestScore = result.score;
          bestMove = move;
        }
        beta = Math.min(beta, bestScore);
        if (beta <= alpha) {
          if (this.killerMoves) this.killerMoves.addKiller(move, ply);
          if (this.historyHeuristic && !move.capturedPiece) this.historyHeuristic.update(move, depth);
          break;
        }
      }
    }
    
    return { score: bestScore, move: bestMove };
  }

  iterativeDeepening(board) {
    let bestMove = null;
    let bestScore = this.color === 'white' ? -Infinity : Infinity;
    
    // Get legal moves for fallback - we need at least one move
    const legalMoves = this.getLegalMovesForColor(board, this.color);
    if (legalMoves.length === 0) {
      return { score: 0, move: null };
    }
    
    // Start from minDepth and go up to maxDepth
    for (let depth = this.config.minDepth; depth <= this.config.maxDepth; depth++) {
      if (Date.now() - this.searchStartTime > this.config.maxTime * 0.7) break;
      
      const result = this.minimax(board, depth, -Infinity, Infinity, this.color);
      
      // Always update best move if we found one, even on timeout
      if (result.move) {
        bestMove = result.move;
        bestScore = result.score;
        
        if (Math.abs(result.score) > 15000) break; // Mate found
      }
      
      if (result.timeout) break;
    }
    
    // If search didn't find a move (very rare - extreme time pressure), 
    // fall back to first legal move rather than random
    if (!bestMove && legalMoves.length > 0) {
      // Use the ordered moves from our move ordering heuristics
      const orderedMoves = this.orderMoves(legalMoves, 0);
      bestMove = orderedMoves[0];
      // Quick evaluation for the score
      const { board: simBoard } = simulateMove(
        bestMove.from[0], bestMove.from[1], 
        bestMove.to[0], bestMove.to[1], 
        board
      );
      bestScore = this.evaluate(simBoard, this.color);
    }
    
    return { score: bestScore, move: bestMove };
  }

  async lookupOpeningBookMove(board, moves) {
    // Don't query opening book after 15 full moves
    const moveNumber = Math.floor(board.history.moves.length / 2) + 1;
    if (moveNumber > MAX_OPENING_BOOK_MOVE) {
      return null;
    }
    
    if (!this.config.useOpeningBook || !polyglotBook) {
      return null;
    }
    
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
      // Silently fail
    }
    
    return null;
  }

  applyImperfection(moves, bestMove) {
    if (moves.length <= 1) return bestMove;
    
    if (Math.random() < this.config.blunderChance) {
      const randomMove = moves[Math.floor(Math.random() * moves.length)];
      this.report.imperfectionApplied = {
        type: 'blunder',
        originalMove: this.report.formatMove(bestMove)
      };
      return randomMove;
    }
    
    if (Math.random() < this.config.mistakeChance) {
      const poolSize = Math.min(this.config.moveSelectionPool, moves.length);
      const rankedMoves = moves.map(move => {
        const { board: simBoard } = simulateMove(move.from[0], move.from[1], move.to[0], move.to[1], this.board);
        return { move, score: this.evaluate(simBoard, this.color) };
      });
      rankedMoves.sort((a, b) => b.score - a.score);
      
      const selectedIdx = Math.floor(Math.random() * poolSize);
      if (selectedIdx > 0) {
        this.report.imperfectionApplied = {
          type: 'suboptimal',
          originalMove: this.report.formatMove(bestMove)
        };
        return rankedMoves[selectedIdx].move;
      }
    }
    
    return bestMove;
  }

  async makeMove() {
    // Reset report for this decision
    this.report.reset();
    this.report.botColor = this.color;
    this.report.difficulty = this.config.name;
    this.report.fen = boardToFen(this.board);
    this.report.moveNumber = Math.floor(this.board.history.moves.length / 2) + 1;
    
    const [minDelay, maxDelay] = this.config.thinkingDelay;
    const thinkingTime = minDelay + Math.random() * (maxDelay - minDelay);
    await new Promise(resolve => setTimeout(resolve, thinkingTime));
    
    // Get legal moves from current board state
    const moves = this.getLegalMovesForColor(this.board, this.color);
    this.report.legalMoves = moves.map(m => this.report.formatMove(m));
    
    if (moves.length === 0) return null;
    if (moves.length === 1) {
      this.report.selectedMove = this.report.formatMove(moves[0]);
      this.report.finalMove = this.report.formatMove(moves[0]);
      this.storeReport();
      return { from: moves[0].from, to: moves[0].to };
    }
    
    // Look up opening book move (but don't use it directly)
    const bookMove = await this.lookupOpeningBookMove(this.board, moves);
    if (bookMove) {
      // Store for move ordering priority
      this.openingBookMove = bookMove;
      this.report.openingBookAttempt.integratedIntoSearch = true;
    } else {
      this.openingBookMove = null;
    }
    
    // Reset search state
    this.positionCount = 0;
    this.maxDepthReached = 0;
    this.searchStartTime = Date.now();
    if (this.killerMoves) this.killerMoves.clear();
    if (this.historyHeuristic) this.historyHeuristic.clear();
    
    // Evaluate all moves for the report
    for (const move of moves) {
      const { board: simBoard } = simulateMove(move.from[0], move.from[1], move.to[0], move.to[1], this.board);
      const { score, breakdown } = this.evaluateWithBreakdown(simBoard, this.color);
      this.report.addMoveEvaluation(move, score, breakdown);
    }
    
    // Perform search
    const result = this.iterativeDeepening(this.board);
    
    const timeElapsed = Date.now() - this.searchStartTime;
    this.report.searchStats = {
      positionsEvaluated: this.positionCount,
      maxDepthReached: this.maxDepthReached,
      timeSpentMs: timeElapsed,
      nodesPerSecond: timeElapsed > 0 ? Math.round(this.positionCount / (timeElapsed / 1000)) : 0
    };
    
    let selectedMove = result.move;
    this.report.selectedMove = this.report.formatMove(selectedMove);
    this.report.selectedMoveScore = result.score;
    
    // Apply imperfection (only if we have a valid move from search)
    if (selectedMove && (this.config.blunderChance > 0 || this.config.mistakeChance > 0)) {
      selectedMove = this.applyImperfection(moves, selectedMove);
    }
    
    // Fallback - should never happen now, but keep as safety net
    if (!selectedMove) {
      console.warn('BotPlayer: Search returned no move, using first ordered move as fallback');
      const orderedMoves = this.orderMoves(moves, 0);
      selectedMove = orderedMoves[0];
    }
    
    this.report.finalMove = this.report.formatMove(selectedMove);
    
    // Store report
    this.storeReport();
    
    // Clear opening book move for next turn
    this.openingBookMove = null;
    
    return { from: selectedMove.from, to: selectedMove.to };
  }

  storeReport() {
    // Create a copy of the report to store
    const reportCopy = new DecisionReport();
    Object.assign(reportCopy, this.report);
    reportCopy.moveEvaluations = [...this.report.moveEvaluations];
    reportCopy.openingBookAttempt = { ...this.report.openingBookAttempt };
    reportCopy.searchStats = { ...this.report.searchStats };
    reportCopy.imperfectionApplied = { ...this.report.imperfectionApplied };
    
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
