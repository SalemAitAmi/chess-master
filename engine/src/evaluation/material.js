/**
 * Material evaluation heuristic with Piece-Square Tables
 */

import { PIECES, PIECE_VALUES } from '../core/constants.js';
import { colorToIndex } from '../core/bitboard.js';
import { getPSTValue } from './pieceSquareTables.js';
import logger from '../logging/logger.js';

/**
 * Evaluate material balance and piece positioning
 * @param {Board} board - Current board state
 * @param {string} color - Color to evaluate for
 * @param {number} weight - Heuristic weight multiplier
 * @param {number} gamePhase - Game phase (0=endgame, 1=middlegame)
 * @returns {number} Material score in centipawns
 */
export function evaluateMaterial(board, color, weight = 1.0, gamePhase = 1) {
  const colorIdx = colorToIndex(color);
  const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
  const isWhite = color === 'white';
  
  let materialScore = 0;
  let pstScore = 0;
  const details = {
    material: {},
    pst: {}
  };
  
  for (let piece = PIECES.KING; piece <= PIECES.PAWN; piece++) {
    const pieceNames = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
    const pieceName = pieceNames[piece];
    
    // Count pieces
    const ourCount = board.bbPieces[colorIdx][piece].popCount();
    const theirCount = board.bbPieces[oppositeColorIdx][piece].popCount();
    const diff = ourCount - theirCount;
    const pieceMaterialScore = diff * PIECE_VALUES[piece];
    materialScore += pieceMaterialScore;
    
    // PST for our pieces
    let ourPST = 0;
    const ourPiecesBB = board.bbPieces[colorIdx][piece].clone();
    while (!ourPiecesBB.isEmpty()) {
      const sq = ourPiecesBB.popLSB();
      ourPST += getPSTValue(piece, sq, isWhite, gamePhase);
    }
    
    // PST for their pieces
    let theirPST = 0;
    const theirPiecesBB = board.bbPieces[oppositeColorIdx][piece].clone();
    while (!theirPiecesBB.isEmpty()) {
      const sq = theirPiecesBB.popLSB();
      theirPST += getPSTValue(piece, sq, !isWhite, gamePhase);
    }
    
    const piecePSTScore = ourPST - theirPST;
    pstScore += piecePSTScore;
    
    // Store details for logging
    if (diff !== 0 || piecePSTScore !== 0) {
      details.material[pieceName] = {
        ours: ourCount,
        theirs: theirCount,
        diff,
        value: pieceMaterialScore
      };
      details.pst[pieceName] = {
        ours: ourPST,
        theirs: theirPST,
        net: piecePSTScore
      };
    }
  }
  
  const totalScore = materialScore + pstScore;
  const weightedScore = Math.round(totalScore * weight);
  
  logger.heuristicCalc('Material+PST', color, weightedScore, {
    rawMaterial: materialScore,
    rawPST: pstScore,
    total: totalScore,
    weighted: weightedScore,
    gamePhase: gamePhase.toFixed(2),
    details
  });
  
  return weightedScore;
}