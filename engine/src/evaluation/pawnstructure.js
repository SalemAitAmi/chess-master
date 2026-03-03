/**
 * Pawn structure evaluation heuristic
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex, indexToRowCol } from '../core/bitboard.js';
import logger from '../logging/logger.js';

const PASSED_PAWN_BONUS = [0, 10, 15, 25, 40, 60, 90, 0];
const ISOLATED_PAWN_PENALTY = 15;
const DOUBLED_PAWN_PENALTY = 12;
const CONNECTED_PAWN_BONUS = 8;

export function evaluatePawnStructure(board, color, weight = 1.0) {
  const colorIdx = colorToIndex(color);
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const oppositeColorIdx = colorToIndex(oppositeColor);
  
  let score = 0;
  score += analyzePawnStructure(board, color, colorIdx, oppositeColorIdx);
  score -= analyzePawnStructure(board, oppositeColor, oppositeColorIdx, colorIdx);
  
  const weightedScore = Math.round(score * weight);
  
  logger.heuristicCalc('PawnStructure', color, weightedScore, {});
  
  return weightedScore;
}

function analyzePawnStructure(board, color, colorIdx, oppositeColorIdx) {
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
    if (pawnFiles[pawn.col] > 1) {
      score -= DOUBLED_PAWN_PENALTY;
    }
    
    // Isolated pawns
    const hasLeftNeighbor = pawn.col > 0 && pawnFiles[pawn.col - 1] > 0;
    const hasRightNeighbor = pawn.col < 7 && pawnFiles[pawn.col + 1] > 0;
    if (!hasLeftNeighbor && !hasRightNeighbor) {
      score -= ISOLATED_PAWN_PENALTY;
    } else {
      score += CONNECTED_PAWN_BONUS;
    }
    
    // Passed pawns
    if (isPassedPawn(board, pawn, color, oppositeColorIdx)) {
      const advancement = color === 'white' ? 7 - pawn.row : pawn.row;
      score += PASSED_PAWN_BONUS[advancement];
    }
  }
  
  return score;
}

function isPassedPawn(board, pawn, color, oppositeColorIdx) {
  const direction = color === 'white' ? -1 : 1;
  const endRow = color === 'white' ? 0 : 7;
  
  for (let col = Math.max(0, pawn.col - 1); col <= Math.min(7, pawn.col + 1); col++) {
    let row = pawn.row + direction;
    while ((color === 'white' && row >= endRow) || (color === 'black' && row <= endRow)) {
      const rank = 7 - row;
      const checkSquare = rank * 8 + col;
      if (board.bbPieces[oppositeColorIdx][PIECES.PAWN].getBit(checkSquare)) {
        return false;
      }
      row += direction;
    }
  }
  
  return true;
}