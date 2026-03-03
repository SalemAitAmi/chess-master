/**
 * Pawn push bonus evaluation - for move ordering
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex, indexToRowCol } from '../core/bitboard.js';
import logger from '../logging/logger.js';

export function evaluatePawnPush(move, board, color) {
  if (move.piece !== PIECES.PAWN) return 0;
  
  const fromRow = move.from[0];
  const toRow = move.to[0];
  const col = move.from[1];
  const colorIdx = colorToIndex(color);
  const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
  
  // Check if double push
  const isDoublePush = Math.abs(toRow - fromRow) === 2;
  if (!isDoublePush) return 0;
  
  let bonus = 15;
  
  // Central pawns bonus
  if (col === 3 || col === 4) bonus += 20;
  if (col === 2 || col === 5) bonus += 10;
  
  // Check if blocking bishop diagonal
  const bishopBB = board.bbPieces[colorIdx][PIECES.BISHOP].clone();
  while (!bishopBB.isEmpty()) {
    const bishopSquare = bishopBB.popLSB();
    const [bishopRow, bishopCol] = indexToRowCol(bishopSquare);
    const backRank = color === 'white' ? 7 : 0;
    
    if (bishopRow === backRank) {
      const pawnInFront = (color === 'white' && toRow === 5) || (color === 'black' && toRow === 2);
      if (pawnInFront && Math.abs(bishopCol - col) === 1) {
        bonus -= 10;
      }
    }
  }
  
  // Bonus for responding to center
  const opponentPawnBB = board.bbPieces[oppositeColorIdx][PIECES.PAWN];
  const centralSquares = [27, 28, 35, 36]; // d4, e4, d5, e5
  
  let opponentControlsCenter = false;
  for (const sq of centralSquares) {
    if (opponentPawnBB.getBit(sq)) {
      opponentControlsCenter = true;
      break;
    }
  }
  
  if (opponentControlsCenter && col >= 2 && col <= 5) {
    bonus += 15;
  }
  
  logger.heuristicCalc('PawnPush', color, bonus, { col, isDoublePush });
  
  return bonus;
}